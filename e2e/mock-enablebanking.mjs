/**
 * Server Enable Banking simulato, usato solo nei test.
 * Verifica la firma JWT come l'API reale e restituisce dati di esempio in formato Enable Banking.
 */
import { createServer } from 'node:http';
import { verify } from 'node:crypto';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function checkJwt(header, publicKey, appId) {
  const token = (header ?? '').replace(/^Bearer /, '');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return 'JWT mancante';
  const head = JSON.parse(Buffer.from(h, 'base64url'));
  const body = JSON.parse(Buffer.from(p, 'base64url'));
  if (head.alg !== 'RS256' || head.kid !== appId) return 'header JWT non valido';
  if (body.iss !== 'enablebanking.com' || body.aud !== 'api.enablebanking.com') return 'claim non validi';
  if (body.exp - body.iat > 86400 || body.exp < Date.now() / 1000) return 'JWT scaduto';
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))) return 'firma non valida';
  return null;
}

export function createMockEnableBanking({ publicKey, appId, today = new Date().toISOString().slice(0, 10) }) {
  const day = (offset) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const state = {
    sessionStatus: 'AUTHORIZED',
    requests: [],
    transactions: [
      { transaction_id: 'T1', transaction_amount: { currency: 'EUR', amount: '2450.00' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: day(-20), debtor: { name: 'ACME SRL' }, remittance_information: ['Stipendio'] },
      { transaction_id: 'T2', transaction_amount: { currency: 'EUR', amount: '850.00' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: day(-15), creditor: { name: 'Mario Bianchi' }, remittance_information: ['Affitto'] },
      { entry_reference: null, transaction_id: null, transaction_amount: { currency: 'EUR', amount: '3.50' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: day(-10), remittance_information: ['BAR CENTRALE'] },
      { entry_reference: null, transaction_id: null, transaction_amount: { currency: 'EUR', amount: '3.50' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: day(-10), remittance_information: ['BAR CENTRALE'] },
      { transaction_id: 'T5', transaction_amount: { currency: 'EUR', amount: '86.35' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: day(-5), remittance_information: ['Pagamento Visa Debit ESSELUNGA MILANO'] },
      { transaction_id: 'P1', transaction_amount: { currency: 'EUR', amount: '20.00' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: null, transaction_date: day(0), remittance_information: ['In attesa'] },
    ],
    balance: '3006.65',
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    state.requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/bank-login') {
      // la "banca" reindirizza subito al redirect_url con il codice di autorizzazione
      const redirect = new URL(url.searchParams.get('redirect'));
      redirect.searchParams.set('code', 'CODE-123');
      redirect.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: redirect.toString() });
      return res.end();
    }
    const err = checkJwt(req.headers.authorization, publicKey, appId);
    if (err) return json(res, 401, { error: 'UNAUTHORIZED', message: err });
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    }
    const host = `http://${req.headers.host}`;
    const p = url.pathname;
    if (p === '/application') return json(res, 200, { name: 'PFI test', environment: 'SANDBOX', active: true });
    if (p === '/aspsps')
      return json(res, 200, {
        aspsps: [
          { name: 'Fineco', country: 'IT', logo: '', maximum_consent_validity: 15552000 },
          { name: 'Intesa Sanpaolo', country: 'IT', logo: '', maximum_consent_validity: 7776000 },
        ].filter((a) => !url.searchParams.get('country') || a.country === url.searchParams.get('country')),
      });
    if (p === '/auth' && req.method === 'POST') {
      if (!body.redirect_url || !body.aspsp?.name || !body.access?.valid_until || !body.state) return json(res, 422, { error: 'VALIDATION', message: 'campi mancanti' });
      state.lastAuth = body;
      return json(res, 200, { url: `${host}/bank-login?state=${encodeURIComponent(body.state)}&redirect=${encodeURIComponent(body.redirect_url)}`, authorization_id: 'auth-1' });
    }
    if (p === '/sessions' && req.method === 'POST') {
      if (body.code !== 'CODE-123') return json(res, 422, { error: 'WRONG_AUTHORIZATION_CODE', message: 'codice non valido' });
      state.sessionStatus = 'AUTHORIZED';
      return json(res, 200, {
        session_id: 'sess-1',
        accounts: [{ uid: 'acc-uid-1', account_id: { iban: 'IT60X0542811101000000123456' }, name: 'Conto Fineco', currency: 'EUR', cash_account_type: 'CACC' }],
        aspsp: { name: state.lastAuth?.aspsp?.name ?? 'Fineco', country: 'IT' },
        psu_type: 'personal',
        access: { valid_until: state.lastAuth?.access?.valid_until ?? '2027-05-25T00:00:00Z' },
      });
    }
    const expired = () => json(res, 401, { code: 'EXPIRED_SESSION', message: 'Session is expired' });
    if (p === '/sessions/sess-1') {
      if (req.method === 'DELETE') {
        state.sessionStatus = 'REVOKED';
        return json(res, 200, { message: 'OK' });
      }
      return json(res, 200, { status: state.sessionStatus, accounts: ['acc-uid-1'], access: { valid_until: '2027-05-25T00:00:00Z' } });
    }
    if (p === '/accounts/acc-uid-1/balances') {
      if (state.sessionStatus !== 'AUTHORIZED') return expired();
      return json(res, 200, { balances: [
          { name: 'Saldo disponibile', balance_amount: { currency: 'EUR', amount: (Number(state.balance) - 20).toFixed(2) }, balance_type: 'ITAV' },
          { name: 'Interessi maturati', balance_amount: { currency: 'EUR', amount: '1.15' }, balance_type: 'OTHR' },
          { name: 'Saldo contabile', balance_amount: { currency: 'EUR', amount: state.balance }, balance_type: 'CLBD', reference_date: today },
        ] });
    }
    if (p === '/accounts/acc-uid-1/transactions') {
      if (state.sessionStatus !== 'AUTHORIZED') return expired();
      const from = url.searchParams.get('date_from') ?? '0000';
      const list = state.transactions.filter((t) => (t.booking_date ?? t.transaction_date) >= from);
      // paginazione: 2 movimenti per pagina
      const start = Number(url.searchParams.get('continuation_key') ?? 0);
      const page = list.slice(start, start + 2);
      return json(res, 200, { transactions: page, continuation_key: start + 2 < list.length ? String(start + 2) : null });
    }
    if (p.startsWith('/payments')) return json(res, 500, { message: 'non dovrebbe mai arrivare qui' });
    return json(res, 404, { error: 'NOT_FOUND', message: p });
  });

  return {
    server,
    state,
    addTransaction(t) {
      state.transactions.push(t);
    },
    day,
  };
}

// Avvio standalone (per gli E2E): node e2e/mock-enablebanking.mjs <porta> <file chiave pubblica> <appId>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [port, pubPath, appId] = process.argv.slice(2);
  const mock = createMockEnableBanking({ publicKey: readFileSync(pubPath, 'utf8'), appId });
  mock.server.listen(Number(port), '127.0.0.1', () => console.log(`Mock Enable Banking su ${port}`));
}
