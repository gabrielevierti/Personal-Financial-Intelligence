import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/#/banks');
  await page.getByLabel('Indirizzo del bridge', { exact: true }).fill('http://127.0.0.1:8788');
  await page.locator('#bridge-url').locator('..').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByTestId('bridge-status')).toContainText('Bridge pronto');
  await page.goto('/#/assistant');
  await page.getByRole('button', { name: /Modello:/ }).click();
  await page.getByLabel('Indirizzo', { exact: true }).fill('http://127.0.0.1:11499');
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByTestId('ai-status')).toContainText('Pronto · qwen2.5:3b');
}

async function movement(page: Page, kind: 'Entrata' | 'Uscita', desc: string, amount: string, date: string) {
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Nuovo movimento' }).first().click();
  if (kind === 'Entrata') await page.getByRole('button', { name: 'Entrata', exact: true }).click();
  await page.getByLabel('Data', { exact: true }).fill(date);
  await page.getByLabel('Descrizione', { exact: true }).fill(desc);
  await page.getByLabel('Importo', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Registra movimento' }).click();
  await expect(page.getByText('Movimento registrato.').first()).toBeVisible();
}

test('dashboard 2.0: spese reali, veicoli, pianificati, previsione, pannello AI', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Nuovo conto' }).first().click();
  await page.getByLabel('Nome', { exact: true }).fill('Trade Republic');
  await page.getByLabel('Saldo iniziale', { exact: true }).fill('3000');
  await page.getByLabel('Data di creazione', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Crea conto' }).click();

  const today = new Date().toISOString().slice(0, 10);
  await movement(page, 'Uscita', 'Buy trade IE00BK5BQT80 Vanguard FTSE All-World', '500', today);
  await movement(page, 'Uscita', 'Esselunga Milano', '80', today);
  await page.goto('/#/transactions');
  await page.getByTestId('auto-categorize').click();
  await expect(page.getByTestId('tx-row').filter({ hasText: 'Buy trade' })).toContainText('Acquisto investimenti');

  // le uscite contano solo la spesa vera; l'acquisto di titoli resta nel patrimonio, al costo
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('kpi-expense')).toContainText('80,00');
  await expect(page.getByTestId('kpi-networth')).toContainText('2.920,00');
  await expect(page.getByTestId('kpi-investments')).toContainText('500,00');
  await expect(page.getByTestId('kpi-liquidity')).toContainText('2.420,00');
  await expect(page.getByTestId('forecast')).toBeVisible();
  await expect(page.getByTestId('kpi-autonomy')).toBeVisible();

  // auto tra i beni fisici
  await page.goto('/#/investments');
  await page.getByRole('button', { name: 'Nuovo asset' }).first().click();
  await page.getByLabel('Nome', { exact: true }).fill('Fiat Panda');
  await page.getByLabel('Categoria', { exact: true }).selectOption('vehicle');
  await page.getByLabel('Quantità', { exact: true }).fill('1');
  await page.getByLabel('Prezzo medio di acquisto (unitario)').fill('12000');
  await page.getByLabel('Data di acquisto (facoltativa)').fill('2024-01-01');
  await page.getByLabel('Deprezzamento annuo stimato % (facoltativo)').fill('15');
  await page.getByRole('button', { name: 'Usa come valore corrente' }).click();
  await page.getByRole('button', { name: 'Aggiungi asset' }).click();
  await expect(page.getByText('Asset aggiunto.')).toBeVisible();
  await page.goto('/#/networth');
  await expect(page.getByText('Beni fisici', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Fiat Panda')).toBeVisible();
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('kpi-investments')).toContainText('500,00'); // il veicolo non è un investimento

  // movimento pianificato → entra nella previsione come programmato
  await page.goto('/#/budgets');
  await page.getByTestId('scheduled').getByRole('button', { name: 'Aggiungi' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Affitto');
  await page.getByLabel('Tipo', { exact: true }).selectOption('rent');
  await page.getByLabel('Importo in uscita').fill('700');
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const next = `${today.slice(0, 8)}${String(Math.min(last, d.getDate() + 1)).padStart(2, '0')}`;
  await page.getByLabel('Prossima scadenza').fill(d.getDate() === last ? `${today.slice(0, 8)}${last}` : next);
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('Movimento pianificato aggiunto.')).toBeVisible();
  if (d.getDate() !== last) {
    await page.goto('/#/dashboard');
    await expect(page.getByTestId('forecast')).toContainText('700,00');
  }

  // pannello AI globale dall'header, con contesto della pagina
  await page.goto('/#/dashboard');
  await page.getByTestId('ai-toggle').click();
  await expect(page.getByTestId('ai-panel')).toContainText('Modello locale attivo');
  await page.getByLabel('Domanda').fill('Come sto andando?');
  await page.getByLabel('Domanda').press('Enter');
  await expect(page.getByTestId('ai-panel')).toContainText('Ho ricevuto il contesto finanziario.');
  // AI sul singolo KPI
  await page.getByRole('button', { name: /Chiedi all'AI: Come sto andando in questo periodo/ }).click();
  await expect(page.getByTestId('ai-panel')).toContainText('Come sto andando in questo periodo?');
  await page.getByRole('button', { name: 'Chiudi il pannello' }).click();
  await expect(page.getByTestId('ai-panel')).toHaveCount(0);
  await page.goto('/#/assistant');
  await expect(page.getByTestId('ai-history')).toContainText('Come sto andando?');

  await page.goto('/#/insights');
  await expect(page.getByRole('heading', { name: 'Financial Insights', level: 1 })).toBeVisible();
  await page.goto('/#/simulations');
  await page.getByLabel('Importo da investire').fill('2000');
  await expect(page.getByTestId('simulation-result')).toContainText('420,00');
  expect(errors).toEqual([]);
});

test('investment research: ricerca, scheda azienda, valutazione, report, watchlist, confronto, mercati', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await page.goto('/#/settings');
  await expect(page.getByTestId('research-settings')).toContainText('SEC EDGAR');
  await expect(page.getByTestId('research-settings')).toContainText('manca alphaVantageKey');

  await page.goto('/#/research');
  await page.getByTestId('company-search').fill('testco');
  await page.getByTestId('search-results').getByRole('button', { name: /TSTC/ }).first().click();
  await expect(page.getByTestId('co-price')).toContainText('60,00');
  await expect(page.getByText('non in tempo reale')).toBeVisible();
  await expect(page.getByTestId('price-chart')).toBeVisible();

  await page.getByRole('tab', { name: 'Financials' }).click();
  await expect(page.getByText('SEC EDGAR (XBRL, bilanci depositati)').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /^Ricavi/ }).first()).toContainText('13,6 Mld');

  await page.getByRole('tab', { name: 'Debt' }).click();
  await expect(page.getByRole('row', { name: /^Debito netto \d|^Debito netto —|Debito netto/ }).first()).toBeVisible();
  await expect(page.getByText(/Scadenze e covenant/)).toBeVisible();

  await page.getByRole('tab', { name: 'Valuation' }).click();
  await expect(page.getByTestId('dcf-value')).not.toHaveText('—');
  const before = await page.getByTestId('dcf-value').textContent();
  await page.getByLabel('WACC').fill('12');
  await expect(page.getByTestId('dcf-value')).not.toHaveText(before ?? '');
  await expect(page.getByTestId('scenarios')).toContainText('prudente');

  await page.getByRole('tab', { name: 'Analysts' }).click();
  await expect(page.getByText('Finnhub (recommendation trends)').first()).toBeVisible();

  await page.getByRole('tab', { name: 'AI Report' }).click();
  await page.getByTestId('report-generate').click();
  await expect(page.getByTestId('report')).toContainText('Sintesi di prova basata sul contesto.');
  await expect(page.getByTestId('report')).toContainText('Conclusione');
  await page.getByTestId('report-save').click();
  await expect(page.getByText(/Istantanea salvata/)).toBeVisible();

  await page.getByRole('button', { name: /Watchlist/ }).click();
  await page.goto('/#/watchlist');
  await expect(page.getByTestId('watchlist')).toContainText('TSTC');
  await expect(page.getByTestId('watchlist')).toContainText('60,00');

  await page.goto('/#/compare?s=TSTC');
  await expect(page.getByTestId('compare')).toContainText('Margine operativo');

  await page.goto('/#/market');
  await expect(page.getByTestId('market')).toContainText('S&P 500');
  expect(errors).toEqual([]);
});
