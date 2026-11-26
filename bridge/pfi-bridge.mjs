#!/usr/bin/env node
/**
 * PFI Bridge — ponte locale verso Enable Banking (sola lettura).
 *
 * Perché esiste:
 *  - l'API di Enable Banking richiede richieste firmate con la chiave privata RSA dell'applicazione:
 *    la chiave resta in questo processo, sul tuo computer, e non entra mai nel browser;
 *  - il browser non può chiamare direttamente api.enablebanking.com (CORS);
 *  - espone SOLO endpoint di lettura (banche, autorizzazione, sessioni, dettagli, saldi, movimenti).
 *    Pagamenti e qualunque altra operazione sono bloccati.
 *
 * Ascolta solo su 127.0.0.1 e accetta richieste solo da pagine servite da localhost
 * (o dalle origini aggiunte esplicitamente in config.json).
 * Nessuna dipendenza esterna: usa solo i moduli di Node (>= 18).
 */
import { createServer } from 'node:http';
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearch, researchConfig } from './research.mjs';

export const BRIDGE_VERSION = '1.1.0';
const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------- configurazione

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const configPath = resolve(arg('config') ?? env.PFI_BRIDGE_CONFIG ?? resolve(HERE, 'config.json'));
  let file = {};
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (e) {
      throw new Error(`config.json non valido (${configPath}): ${e.message}`);
    }
  }
  const base = dirname(configPath);
  const keyPath = env.EB_PRIVATE_KEY_PATH ?? file.privateKeyPath;
  return {
    configPath,
    configFound: existsSync(configPath),
    applicationId: env.EB_APPLICATION_ID ?? file.applicationId ?? '',
    privateKeyPath: keyPath ? (isAbsolute(keyPath) ? keyPath : resolve(base, keyPath)) : '',
    privateKeyPem: env.EB_PRIVATE_KEY ?? '',
    redirectUrl: env.EB_REDIRECT_URL ?? file.redirectUrl ?? '',
    apiBase: (env.EB_API_BASE ?? file.apiBase ?? 'https://api.enablebanking.com').replace(/\/$/, ''),
    port: Number(arg('port') ?? env.PFI_BRIDGE_PORT ?? file.port ?? 8787),
    research: researchConfig(file, env),
    allowedOrigins: [...(file.allowedOrigins ?? []), ...(env.PFI_BRIDGE_ORIGINS ? env.PFI_BRIDGE_ORIGINS.split(',') : [])].map((o) => o.trim().replace(/\/$/, '')),
  };
}

export function configProblems(cfg) {
  const p = [];
  if (!cfg.applicationId) p.push('applicationId mancante (ID dell’applicazione Enable Banking).');
  if (!cfg.privateKeyPem && !cfg.privateKeyPath) p.push('privateKeyPath mancante (file .pem scaricato alla creazione dell’applicazione).');
  else if (!cfg.privateKeyPem && !existsSync(cfg.privateKeyPath)) p.push(`Chiave privata non trovata: ${cfg.privateKeyPath}`);
  if (!cfg.redirectUrl) p.push('redirectUrl mancante (uno degli "Allowed redirect URLs" dell’applicazione).');
  return p;
}

// ---------------------------------------------------------------------------- JWT RS256

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function makeJwt(applicationId, privateKey, now = Math.floor(Date.now() / 1000), ttl = 3600) {
  const header = { typ: 'JWT', alg: 'RS256', kid: applicationId };
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + ttl };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign('RSA-SHA256', Buffer.from(data), privateKey);
  return `${data}.${b64url(signature)}`;
}

// ---------------------------------------------------------------------------- regole di accesso

/** Solo letture: ogni altra rotta (pagamenti inclusi) viene rifiutata. */
const ROUTES = [
  { method: 'GET', re: /^\/application$/ },
  { method: 'GET', re: /^\/aspsps$/ },
  { method: 'POST', re: /^\/auth$/ },
  { method: 'POST', re: /^\/sessions$/ },
  { method: 'GET', re: /^\/sessions\/[\w-]+$/ },
  { method: 'DELETE', re: /^\/sessions\/[\w-]+$/ },
  { method: 'GET', re: /^\/accounts\/[\w-]+\/(details|balances|transactions)$/ },
];

export function isAllowedRoute(method, path) {
  return ROUTES.some((r) => r.method === method && r.re.test(path));
}

export function isAllowedOrigin(origin, extra = []) {
  if (!origin) return true; // richieste locali senza Origin (es. curl)
  try {
    const u = new URL(origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && (u.protocol === 'http:' || u.protocol === 'https:')) return true;
  } catch {
    return false;
  }
  return extra.includes(origin.replace(/\/$/, ''));
}

// ---------------------------------------------------------------------------- server

export function createBridge(cfg, { fetchImpl = fetch, log = console.log } = {}) {
  const research = createResearch(cfg.research ?? researchConfig({}, {}), { fetchImpl, log });
  let key = null;
  let token = null;
  const getKey = () => {
    if (!key) key = createPrivateKey(cfg.privateKeyPem || readFileSync(cfg.privateKeyPath, 'utf8'));
    return key;
  };
  const getToken = () => {
    const now = Math.floor(Date.now() / 1000);
    if (!token || token.exp - now < 300) token = { jwt: makeJwt(cfg.applicationId, getKey(), now), exp: now + 3600 };
    return token.jwt;
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((ok, ko) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          ko(new Error('Richiesta troppo grande'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
      req.on('error', ko);
    });

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && isAllowedOrigin(origin, cfg.allowedOrigins)
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        }
      : {};
    if (!isAllowedOrigin(origin, cfg.allowedOrigins)) return send(res, 403, { error: 'ORIGIN_NOT_ALLOWED', message: `Origine non autorizzata: ${origin}` });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/health') {
        const problems = configProblems(cfg);
        const info = { ok: problems.length === 0, bridgeVersion: BRIDGE_VERSION, applicationId: cfg.applicationId || null, redirectUrl: cfg.redirectUrl || null, apiBase: cfg.apiBase, problems };
        if (problems.length === 0 && url.searchParams.get('check') === '1') {
          try {
            getKey();
          } catch (e) {
            return send(res, 200, { ...info, ok: false, problems: [`Chiave privata non leggibile: ${e.message}`] }, cors);
          }
          const r = await fetchImpl(`${cfg.apiBase}/application`, { headers: { Authorization: `Bearer ${getToken()}` } });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return send(res, 200, { ...info, ok: false, problems: [`Enable Banking ha rifiutato le credenziali (${r.status}): ${body.message ?? body.error ?? 'errore'}`] }, cors);
          return send(res, 200, { ...info, application: { name: body.name, environment: body.environment, active: body.active } }, cors);
        }
        return send(res, 200, info, cors);
      }

      if (url.pathname.startsWith('/research/')) {
        if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Solo lettura.' }, cors);
        try {
          const r = await research(url);
          return send(res, r.status, r.body, cors);
        } catch (e) {
          return send(res, 502, { error: 'UPSTREAM', message: `Fonte dati non raggiungibile: ${e.message}` }, cors);
        }
      }

      const path = url.pathname.replace(/^\/eb/, '');
      if (!url.pathname.startsWith('/eb/') || !isAllowedRoute(req.method, path)) {
        return send(res, 403, { error: 'FORBIDDEN', message: 'Operazione non consentita dal bridge (sola lettura).' }, cors);
      }
      const problems = configProblems(cfg);
      if (problems.length) return send(res, 503, { error: 'NOT_CONFIGURED', message: problems.join(' ') }, cors);

      let body;
      if (req.method === 'POST') {
        const raw = await readBody(req);
        let json;
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch {
          return send(res, 400, { error: 'BAD_JSON', message: 'JSON non valido' }, cors);
        }
        if (path === '/auth') {
          // il redirect è sempre quello configurato; l'accesso richiesto è solo in lettura
          json = { ...json, redirect_url: cfg.redirectUrl, psu_type: json.psu_type ?? 'personal' };
          delete json.access?.balances_only;
        }
        body = JSON.stringify(json);
      }
      const headers = { Authorization: `Bearer ${getToken()}`, Accept: 'application/json' };
      if (body) headers['Content-Type'] = 'application/json';
      if (req.headers['user-agent']) headers['Psu-User-Agent'] = req.headers['user-agent'];
      const upstream = await fetchImpl(`${cfg.apiBase}${path}${url.search}`, { method: req.method, headers, body });
      const text = await upstream.text();
      log(`${new Date().toISOString()} ${req.method} ${path} → ${upstream.status}`);
      return send(res, upstream.status, text || '{}', cors);
    } catch (e) {
      log(`${new Date().toISOString()} errore: ${e.message}`);
      return send(res, 502, { error: 'BRIDGE_ERROR', message: `Il bridge non è riuscito a contattare Enable Banking: ${e.message}` }, cors);
    }
  });
}

// ---------------------------------------------------------------------------- avvio da riga di comando

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cfg = loadConfig();
  const problems = configProblems(cfg);
  const server = createBridge(cfg);
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`PFI Bridge ${BRIDGE_VERSION} in ascolto su http://127.0.0.1:${cfg.port} (solo questo computer)`);
    console.log(`Configurazione: ${cfg.configFound ? cfg.configPath : 'nessun config.json, uso le variabili d’ambiente'}`);
    console.log(`Enable Banking: ${cfg.apiBase}`);
    if (problems.length) {
      console.log('\nConfigurazione incompleta:');
      for (const p of problems) console.log(`  - ${p}`);
      console.log('\nCopia bridge/config.example.json in bridge/config.json e compilalo (vedi README).');
    }
    console.log('Lascia questa finestra aperta mentre usi il collegamento bancario. Ctrl+C per chiudere.');
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `La porta ${cfg.port} è già in uso. Avvia con --port 8788.` : e.message);
    process.exit(1);
  });
}
