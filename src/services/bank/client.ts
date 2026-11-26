/**
 * Client del PFI Bridge locale. Il browser parla solo con 127.0.0.1: è il bridge a firmare le richieste
 * verso Enable Banking con la chiave privata, che non arriva mai qui.
 */

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';

export class BridgeUnavailableError extends Error {
  constructor(url: string) {
    super(`Il bridge locale non risponde su ${url}. Avvialo con "npm run bridge" e lascia aperta la finestra del terminale.`);
    this.name = 'BridgeUnavailableError';
  }
}

export class BankApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankApiError';
  }
  get sessionExpired(): boolean {
    return ['EXPIRED_SESSION', 'CLOSED_SESSION', 'REVOKED_SESSION', 'WRONG_SESSION_STATUS'].includes(this.code) || this.status === 401;
  }
}

const FRIENDLY: Record<string, string> = {
  EXPIRED_SESSION: 'Il consenso con la banca è scaduto: ricollega la banca per continuare a sincronizzare.',
  CLOSED_SESSION: 'Il consenso con la banca è stato chiuso: ricollega la banca.',
  REVOKED_SESSION: 'Il consenso è stato revocato: ricollega la banca.',
  ASPSP_RATE_LIMIT_EXCEEDED: 'La banca ha limitato il numero di accessi giornalieri. Riprova più tardi.',
  NOT_CONFIGURED: 'Il bridge non è ancora configurato.',
};

export interface BridgeHealth {
  ok: boolean;
  bridgeVersion: string;
  applicationId: string | null;
  redirectUrl: string | null;
  apiBase: string;
  problems: string[];
  application?: { name?: string; environment?: string; active?: boolean };
}

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
  bic?: string;
  beta?: boolean;
  maximum_consent_validity?: number;
}

export interface RemoteAccount {
  uid: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  product?: string;
  currency?: string;
  cash_account_type?: string;
  details?: string;
}

export interface SessionResponse {
  session_id: string;
  accounts: RemoteAccount[];
  aspsp: { name: string; country: string };
  psu_type?: string;
  access: { valid_until: string };
}

export interface RemoteBalance {
  name?: string;
  balance_amount: { currency: string; amount: string };
  balance_type: string;
  reference_date?: string;
  last_change_date_time?: string;
}

export interface RemoteTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { currency: string; amount: string };
  credit_debit_indicator?: 'CRDT' | 'DBIT' | string;
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  creditor_account?: { iban?: string } | null;
  debtor_account?: { iban?: string } | null;
  bank_transaction_code?: { description?: string } | null;
  note?: string | null;
}

export class BridgeClient {
  constructor(public readonly baseUrl: string = DEFAULT_BRIDGE_URL, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new BridgeUnavailableError(this.baseUrl);
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* risposta non JSON */
    }
    if (!res.ok) {
      const code = String(json.code ?? json.error ?? res.status);
      const message = FRIENDLY[code] ?? String(json.message ?? json.detail ?? `Errore ${res.status} da Enable Banking`);
      throw new BankApiError(res.status, code, message);
    }
    return json as T;
  }

  health(check = false) {
    return this.request<BridgeHealth>('GET', `/health${check ? '?check=1' : ''}`);
  }
  async aspsps(country: string): Promise<Aspsp[]> {
    const r = await this.request<{ aspsps: Aspsp[] }>('GET', `/eb/aspsps?country=${encodeURIComponent(country)}&psu_type=personal&service=AIS`);
    return r.aspsps ?? [];
  }
  startAuth(params: { aspsp: { name: string; country: string }; validUntil: string; state: string; language?: string }) {
    return this.request<{ url: string; authorization_id?: string }>('POST', '/eb/auth', {
      access: { valid_until: params.validUntil },
      aspsp: params.aspsp,
      state: params.state,
      psu_type: 'personal',
      language: params.language ?? 'it',
    });
  }
  createSession(code: string) {
    return this.request<SessionResponse>('POST', '/eb/sessions', { code });
  }
  getSession(id: string) {
    return this.request<{ status: string; accounts: string[]; access: { valid_until: string } }>('GET', `/eb/sessions/${encodeURIComponent(id)}`);
  }
  deleteSession(id: string) {
    return this.request<unknown>('DELETE', `/eb/sessions/${encodeURIComponent(id)}`);
  }
  async balances(uid: string): Promise<RemoteBalance[]> {
    const r = await this.request<{ balances: RemoteBalance[] }>('GET', `/eb/accounts/${encodeURIComponent(uid)}/balances`);
    return r.balances ?? [];
  }
  transactionsPage(uid: string, dateFrom: string, continuationKey?: string) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) q.set('continuation_key', continuationKey);
    return this.request<{ transactions: RemoteTransaction[]; continuation_key?: string | null }>('GET', `/eb/accounts/${encodeURIComponent(uid)}/transactions?${q}`);
  }
}

/** Estrae code e state dall'indirizzo a cui la banca ha reindirizzato il browser (o accetta il solo code). */
export function parseCallback(input: string): { code: string; state: string | null; error: string | null } | null {
  const s = input.trim();
  if (!s) return null;
  if (!/[?&#=]/.test(s) && /^[\w-]{6,}$/.test(s)) return { code: s, state: null, error: null };
  try {
    const u = new URL(s.includes('://') ? s : `https://x/${s.startsWith('?') ? s : `?${s}`}`);
    const params = new URLSearchParams(u.search);
    const hash = u.hash.includes('?') ? new URLSearchParams(u.hash.slice(u.hash.indexOf('?'))) : new URLSearchParams(u.hash.replace(/^#/, ''));
    const get = (k: string) => params.get(k) ?? hash.get(k);
    const error = get('error');
    const code = get('code');
    if (!code && !error) return null;
    return { code: code ?? '', state: get('state'), error: error ? (get('error_description') ?? error) : null };
  } catch {
    return null;
  }
}
