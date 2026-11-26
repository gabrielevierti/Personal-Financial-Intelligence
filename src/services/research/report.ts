/**
 * Report "Company Intelligence": 13 sezioni. I numeri e gli scenari sono calcolati da PFI;
 * il modello locale scrive solo i commenti, separando fatti, interpretazioni e ipotesi.
 * Ogni report può essere salvato come istantanea riproducibile (dati, fonti, ipotesi, data).
 */
import { db } from '../../database/db';
import { uid } from '../../utils/id';
import type { AiClient } from '../ai/client';
import { BASE_RULES, limitContext } from '../ai/context';
import { parseJsonLoose } from '../ai/client';
import { cagr, findAnomalies, multiples, pricePerformance, yearMetrics, type DcfInputs, type YearMetrics } from './metrics';
import type { CompanyData } from './registry';
import { buildScenarios, fairValueRange, type Scenario } from './scenarios';
import type { PricePoint } from './types';

export type ClaimType = 'fatto' | 'interpretazione' | 'ipotesi';
export interface Claim {
  text: string;
  type: ClaimType;
}

export interface ReportSection {
  id: string;
  title: string;
  facts: Array<{ label: string; value: string; source?: string }>;
  narrative?: string;
  claims?: Claim[];
}

export interface CompanyReport {
  id: string;
  symbol: string;
  name: string;
  createdAt: string;
  currency: string;
  price: number | null;
  priceAsOf: string | null;
  sections: ReportSection[];
  scenarios: Scenario[];
  fairValue: { low: number; high: number } | null;
  assumptions: DcfInputs;
  assumptionNotes: string[];
  sources: string[];
  ai: { generated: boolean; model?: string; error?: string };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 'n.d.' : `${(v * 100).toFixed(1)}%`);
const x = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 'n.d.' : `${v.toFixed(1)}x`);
const big = (v: number | null | undefined, c: string) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n.d.';
  const a = Math.abs(v);
  return a >= 1e9 ? `${(v / 1e9).toFixed(2)} Mld ${c}` : a >= 1e6 ? `${(v / 1e6).toFixed(1)} Mln ${c}` : `${v.toFixed(0)} ${c}`;
};
const pr = (v: number | null | undefined, c: string) => (v === null || v === undefined || !Number.isFinite(v) ? 'n.d.' : `${v.toFixed(2)} ${c}`);

export const SECTION_TITLES = [
  'Sintesi',
  'Profilo aziendale',
  'Andamento del titolo',
  'Crescita',
  'Redditività',
  'Flussi di cassa',
  'Solidità patrimoniale e debito',
  'Multipli di valutazione',
  'Valutazione intrinseca e scenari',
  'Analisti',
  'Rischi',
  'Analisi SWOT',
  'Conclusione',
] as const;

/** Parte deterministica del report: dati, metriche, scenari. */
export function buildReport(d: CompanyData, prices: PricePoint[], assumptions: DcfInputs, assumptionNotes: string[]): CompanyReport {
  const years = d.statements;
  const m: YearMetrics[] = yearMetrics(years);
  const y0 = years[0];
  const m0 = m[0];
  const cur = y0?.currency ?? d.profile?.currency ?? d.quote?.currency ?? '';
  const priceCur = d.profile?.currency ?? cur;
  const price = d.quote?.price ?? (prices.length ? prices[prices.length - 1].close : null);
  const shares = d.profile?.sharesOutstanding?.value ?? y0?.sharesDiluted ?? null;
  const mult = multiples({ price, shares, marketCap: d.profile?.marketCap?.value ?? null }, y0);
  const perf = pricePerformance(prices);
  const anomalies = findAnomalies(m);
  const span = Math.min(5, years.length - 1);
  const scenarios = buildScenarios(assumptions, price);
  const src = (s?: string) => s;
  const statementSrc = y0?.prov.source;
  const fact = (label: string, value: string, source?: string) => ({ label, value, source: src(source) });

  const sections: ReportSection[] = SECTION_TITLES.map((title, i) => ({ id: `s${i + 1}`, title, facts: [] }));
  const S = (i: number) => sections[i - 1];

  S(1).facts.push(fact('Prezzo', pr(price, priceCur), d.quote?.prov.source), fact('Capitalizzazione', big(mult.marketCap, priceCur), d.profile?.marketCap?.prov.source), fact('Ricavi ultimo esercizio', big(y0?.revenue, cur), statementSrc), fact('Margine operativo', pct(m0?.operatingMargin), 'calcolato'), fact('Debito netto / EBITDA', x(m0?.netDebtToEbitda), 'calcolato'));
  if (d.profile) S(2).facts.push(fact('Nome', d.profile.name), fact('Borsa', d.profile.exchange ?? 'n.d.'), fact('Paese', d.profile.country ?? 'n.d.'), fact('Settore', [d.profile.sector, d.profile.industry].filter(Boolean).join(' · ') || 'n.d.'), fact('Fine esercizio', d.profile.fiscalYearEnd ?? 'n.d.'));
  S(3).facts.push(
    fact('Ultima chiusura', perf.last ? `${pr(perf.last.close, priceCur)} (${perf.last.date})` : 'n.d.'),
    ...(['1M', 'YTD', '1Y', '3Y', '5Y'] as const).map((k) => fact(`Rendimento ${k}`, pct(perf.returns[k]), 'calcolato dallo storico prezzi')),
    fact('Massimo / minimo 52 settimane', `${pr(perf.high52, priceCur)} / ${pr(perf.low52, priceCur)}`),
    fact('Massimo drawdown 12 mesi', pct(perf.maxDrawdown)),
  );
  S(4).facts.push(fact(`CAGR ricavi ${span} anni`, pct(span >= 1 ? cagr(years[span]?.revenue ?? null, y0?.revenue ?? null, span) : null), 'calcolato'), fact(`CAGR utile netto ${span} anni`, pct(span >= 1 ? cagr(years[span]?.netIncome ?? null, y0?.netIncome ?? null, span) : null), 'calcolato'), ...m.slice(0, 5).map((r) => fact(`Ricavi ${r.fiscalYear}`, `${big(r.revenue, cur)} (${r.revenueGrowth === null ? 'n.d.' : `${r.revenueGrowth > 0 ? '+' : ''}${(r.revenueGrowth * 100).toFixed(1)}%`})`, statementSrc)));
  S(5).facts.push(fact('Margine lordo', pct(m0?.grossMargin)), fact('Margine operativo', pct(m0?.operatingMargin)), fact('Margine netto', pct(m0?.netMargin)), fact('ROE', pct(m0?.roe)), fact('ROA', pct(m0?.roa)), fact('ROIC', `${pct(m0?.roic)}${m0?.taxRateAssumed ? ' (aliquota ipotizzata 21%)' : ''}`));
  S(6).facts.push(fact('Flusso di cassa operativo', big(y0?.operatingCashFlow, cur), statementSrc), fact('Capex', big(y0?.capex, cur), statementSrc), fact('Free cash flow', big(m0?.fcf, cur), 'calcolato: operativo − capex'), fact('Margine FCF', pct(m0?.fcfMargin)), fact('Dividendi pagati', big(y0?.dividendsPaid, cur), statementSrc), fact('Riacquisto azioni', big(y0?.buybacks, cur), statementSrc));
  S(7).facts.push(fact('Debito lordo', big(m0?.grossDebt, cur)), fact('Cassa e investimenti a breve', big(y0 ? (y0.cash ?? 0) + (y0.shortTermInvestments ?? 0) : null, cur)), fact('Debito netto', big(m0?.netDebt, cur)), fact('Debito netto / EBITDA', x(m0?.netDebtToEbitda)), fact('Debito / patrimonio netto', x(m0?.debtToEquity)), fact('Copertura interessi (EBIT / interessi)', x(m0?.interestCoverage)), fact('Current ratio', x(m0?.currentRatio)), fact('Quick ratio', x(m0?.quickRatio)), fact('Scadenze del debito e covenant', 'non disponibili dalle fonti strutturate: vanno lette nei documenti depositati'));
  S(8).facts.push(fact('P/E', x(mult.pe)), fact('P/S', x(mult.ps)), fact('P/B', x(mult.pb)), fact('EV', big(mult.enterpriseValue, cur)), fact('EV/EBITDA', x(mult.evEbitda)), fact('EV/Ricavi', x(mult.evSales)), fact('FCF yield', pct(mult.fcfYield)), fact('Dividend yield', pct(mult.dividendYield)));
  if (priceCur && cur && priceCur !== cur) S(8).facts.push(fact('Attenzione', `prezzo in ${priceCur}, bilanci in ${cur}: i multipli possono non essere confrontabili`));
  const range = fairValueRange(scenarios);
  for (const s of scenarios) S(9).facts.push(fact(`Scenario ${s.id}`, `fair value ${pr(s.fairValue, cur)} · ${s.upside === null ? 'n.d.' : `${s.upside > 0 ? '+' : ''}${(s.upside * 100).toFixed(0)}%`} vs prezzo · crescita ${pct(s.inputs.revenueGrowth)}, margine ${pct(s.inputs.operatingMargin)}, WACC ${pct(s.inputs.wacc)}, g ${pct(s.inputs.terminalGrowth)}, ${s.horizonYears} anni`, 'calcolato (DCF)'));
  S(9).facts.push(fact('Intervallo di fair value', range ? `${pr(range.low, cur)} – ${pr(range.high, cur)} (dipende dalle ipotesi, non è un valore oggettivo)` : 'n.d.'));
  const rec = d.analysts.recommendations;
  if (rec) {
    const r0 = rec.value[0];
    S(10).facts.push(fact(`Raccomandazioni (${rec.prov.period ?? ''})`, `strong buy ${r0.strongBuy}, buy ${r0.buy}, hold ${r0.hold}, sell ${r0.sell}, strong sell ${r0.strongSell}`, rec.prov.source));
  }
  if (d.analysts.priceTarget) S(10).facts.push(fact('Prezzo obiettivo medio', pr(d.analysts.priceTarget.value.mean, priceCur), `${d.analysts.priceTarget.prov.source} · ${d.analysts.priceTarget.prov.period ?? ''}`));
  for (const u of d.analysts.unavailable) S(10).facts.push(fact('Non disponibile', u));
  for (const a of anomalies.slice(0, 10)) S(11).facts.push(fact(`${a.fiscalYear}`, a.message, 'calcolato'));
  if (!anomalies.length) S(11).facts.push(fact('Segnali dai bilanci', 'nessuna anomalia rilevata dalle regole di PFI'));
  // conclusione: qualità dell'azienda e attrattività del prezzo restano due domande separate
  const qualitySignals = [
    m0?.roic !== null && m0?.roic !== undefined ? `ROIC ${pct(m0.roic)}` : null,
    m.slice(0, 5).every((r) => r.fcf !== null && r.fcf > 0) && m.length >= 3 ? 'free cash flow positivo in tutti gli ultimi esercizi disponibili' : null,
    m0?.netDebtToEbitda !== null && m0?.netDebtToEbitda !== undefined ? `debito netto/EBITDA ${x(m0.netDebtToEbitda)}` : null,
    m0?.operatingMargin !== null && m0?.operatingMargin !== undefined ? `margine operativo ${pct(m0.operatingMargin)}` : null,
  ].filter(Boolean) as string[];
  S(13).facts.push(fact('Qualità dell\'azienda: dati', qualitySignals.join('; ') || 'dati insufficienti'), fact('Attrattività del prezzo: dati', range && price ? `prezzo ${pr(price, priceCur)} rispetto a un intervallo di fair value ${pr(range.low, cur)} – ${pr(range.high, cur)} (ipotesi modificabili)` : 'dati insufficienti'));

  const sources = new Set<string>();
  if (statementSrc) sources.add(statementSrc);
  for (const p of d.profile?.sources ?? []) sources.add(p.source);
  if (d.quote) sources.add(d.quote.prov.source);
  if (rec) sources.add(rec.prov.source);
  return {
    id: uid(),
    symbol: d.symbol,
    name: d.profile?.name ?? d.symbol,
    createdAt: new Date().toISOString(),
    currency: cur,
    price,
    priceAsOf: d.quote?.asOf ?? perf.last?.date ?? null,
    sections,
    scenarios,
    fairValue: range,
    assumptions,
    assumptionNotes,
    sources: [...sources],
    ai: { generated: false },
  };
}

const CLAIM = { type: 'object', properties: { text: { type: 'string' }, type: { type: 'string', enum: ['fatto', 'interpretazione', 'ipotesi'] } }, required: ['text', 'type'] };
export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    business: { type: 'string' },
    growth: { type: 'string' },
    profitability: { type: 'string' },
    balance: { type: 'string' },
    valuation: { type: 'string' },
    risks: { type: 'array', items: CLAIM },
    strengths: { type: 'array', items: CLAIM },
    weaknesses: { type: 'array', items: CLAIM },
    opportunities: { type: 'array', items: CLAIM },
    threats: { type: 'array', items: CLAIM },
    quality_view: { type: 'string' },
    price_view: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'risks', 'strengths', 'weaknesses', 'opportunities', 'threats', 'quality_view', 'price_view', 'questions'],
};

export function reportContext(r: CompanyReport, description?: string): string {
  const lines = [`AZIENDA: ${r.name} (${r.symbol}). Dati aggiornati al ${r.createdAt.slice(0, 10)}.`];
  if (description) lines.push(`Descrizione (dalla fonte): ${description.slice(0, 1200)}`);
  for (const s of r.sections) if (s.facts.length) lines.push(`\n${s.title.toUpperCase()}\n${s.facts.map((f) => `- ${f.label}: ${f.value}${f.source ? ` [${f.source}]` : ''}`).join('\n')}`);
  lines.push(`\nIPOTESI DEGLI SCENARI\n${r.assumptionNotes.join('\n')}`);
  return limitContext(lines.join('\n')).text;
}

interface AiReport {
  summary?: string;
  business?: string;
  growth?: string;
  profitability?: string;
  balance?: string;
  valuation?: string;
  risks?: Claim[];
  strengths?: Claim[];
  weaknesses?: Claim[];
  opportunities?: Claim[];
  threats?: Claim[];
  quality_view?: string;
  price_view?: string;
  questions?: string[];
}

const cleanClaims = (c: unknown): Claim[] => (Array.isArray(c) ? c.filter((x) => x && typeof x.text === 'string').map((x) => ({ text: String(x.text).slice(0, 400), type: ['fatto', 'interpretazione', 'ipotesi'].includes(x.type) ? x.type : 'interpretazione' })) : []);

/** Aggiunge i commenti del modello locale. Il modello non produce numeri nuovi: deve usare quelli del contesto. */
export async function addAiNarrative(r: CompanyReport, client: AiClient, description?: string, signal?: AbortSignal): Promise<CompanyReport> {
  const sys = `${BASE_RULES}
Compito: commentare il report di un'azienda quotata. Rispondi SOLO con JSON valido secondo lo schema.
- Ogni elemento di risks, strengths, weaknesses, opportunities, threats ha "type": "fatto" se è un dato del contesto, "interpretazione" se è una tua lettura dei dati, "ipotesi" se riguarda il futuro.
- quality_view: la qualità dell'azienda (redditività, solidità, flussi). price_view: se il prezzo attuale appare alto o basso rispetto agli scenari, ricordando che dipende dalle ipotesi. Tienile separate.
- Niente raccomandazioni di acquisto o vendita, niente probabilità. questions: 3-5 domande che un investitore dovrebbe porsi.`;
  const out = await client.chat(
    [
      { role: 'system', content: sys },
      { role: 'user', content: reportContext(r, description) },
    ],
    { json: REPORT_SCHEMA, temperature: 0.2, signal },
  );
  const j = parseJsonLoose<AiReport>(out);
  if (!j) return { ...r, ai: { generated: false, model: client.settings.model, error: 'Il modello non ha restituito un JSON valido.' } };
  const sec = (i: number) => r.sections[i - 1];
  const next: CompanyReport = { ...r, sections: r.sections.map((s) => ({ ...s, facts: [...s.facts] })), ai: { generated: true, model: client.settings.model } };
  const put = (i: number, text?: string) => {
    if (text) next.sections[i - 1] = { ...sec(i), facts: next.sections[i - 1].facts, narrative: String(text).slice(0, 2000) };
  };
  put(1, j.summary);
  put(2, j.business);
  put(4, j.growth);
  put(5, j.profitability);
  put(7, j.balance);
  put(8, j.valuation);
  next.sections[10] = { ...next.sections[10], claims: cleanClaims(j.risks) };
  next.sections[11] = {
    ...next.sections[11],
    claims: [
      ...cleanClaims(j.strengths).map((c) => ({ ...c, text: `Punto di forza: ${c.text}` })),
      ...cleanClaims(j.weaknesses).map((c) => ({ ...c, text: `Debolezza: ${c.text}` })),
      ...cleanClaims(j.opportunities).map((c) => ({ ...c, text: `Opportunità: ${c.text}` })),
      ...cleanClaims(j.threats).map((c) => ({ ...c, text: `Minaccia: ${c.text}` })),
    ],
  };
  const qs = Array.isArray(j.questions) ? j.questions.map(String).slice(0, 6) : [];
  next.sections[12] = { ...next.sections[12], narrative: [j.quality_view && `Qualità dell'azienda: ${j.quality_view}`, j.price_view && `Prezzo: ${j.price_view}`].filter(Boolean).join('\n\n'), claims: qs.map((q) => ({ text: q, type: 'ipotesi' as const })) };
  return next;
}

export async function saveSnapshot(r: CompanyReport, extra: { statements: unknown; prices: number }): Promise<string> {
  const id = uid();
  await db.company_snapshots.add({ id, symbol: r.symbol, name: r.name, createdAt: r.createdAt, payload: { report: r, statements: extra.statements, pricePoints: extra.prices }, sources: r.sources });
  return id;
}

/** PDF del report, generato nel browser. */
export async function exportReportPdf(r: CompanyReport): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const clean = (s: string) => s.replace(/[^\x20-\x7E -ÿ\n]/g, '');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(clean(`${r.name} (${r.symbol})`), 40, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(clean(`Company Intelligence - generato localmente da PFI il ${new Date(r.createdAt).toLocaleString('it-IT')}. Solo a scopo informativo: non e' una raccomandazione di investimento.`), 40, 66, { maxWidth: W - 80 });
  doc.text(clean(`Fonti: ${r.sources.join('; ') || 'n.d.'}. ${r.ai.generated ? `Commenti generati dal modello locale ${r.ai.model}.` : 'Commenti AI non generati.'}`), 40, 88, { maxWidth: W - 80 });
  let y = 116;
  for (const s of r.sections) {
    if (y > 740) {
      doc.addPage();
      y = 50;
    }
    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(clean(s.title), 40, y);
    y += 8;
    if (s.facts.length) {
      autoTable(doc, { startY: y, head: [['Voce', 'Valore', 'Fonte']], body: s.facts.map((f) => [clean(f.label), clean(f.value), clean(f.source ?? '')]), styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [36, 41, 47] }, margin: { left: 40, right: 40 } });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const text = [s.narrative, ...(s.claims ?? []).map((c) => `[${c.type}] ${c.text}`)].filter(Boolean).join('\n');
    if (text) {
      const lines = doc.splitTextToSize(clean(text), W - 80);
      for (const line of lines) {
        if (y > 790) {
          doc.addPage();
          y = 50;
        }
        doc.text(line, 40, y);
        y += 12;
      }
    }
    y += 14;
  }
  doc.save(`pfi-report-${r.symbol}-${r.createdAt.slice(0, 10)}.pdf`);
}
