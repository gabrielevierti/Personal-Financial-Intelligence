// Avvia, solo per i test E2E, un Enable Banking simulato (8799) e un PFI Bridge (8788) configurato verso di esso.
import { generateKeyPairSync } from 'node:crypto';
import { createBridge } from '../bridge/pfi-bridge.mjs';
import { createMockEnableBanking } from './mock-enablebanking.mjs';
import { createMockOllama } from './mock-ollama.mjs';
import { createMockResearch } from './mock-research.mjs';

const research = createMockResearch();
research.server.listen(8797, '127.0.0.1');
const R = 'http://127.0.0.1:8797';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const mock = createMockEnableBanking({ publicKey, appId: 'e2e-app' });
mock.server.listen(8799, '127.0.0.1');
const bridge = createBridge({
  applicationId: 'e2e-app',
  privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  privateKeyPath: '',
  redirectUrl: 'http://localhost:4173/',
  apiBase: 'http://127.0.0.1:8799',
  port: 8788,
  allowedOrigins: [],
  research: { secUserAgent: 'PFI e2e test@example.com', alphaVantageKey: '', finnhubKey: 'e2e-key', tiingoKey: 'e2e-key', secWww: R, secData: R, avBase: R, finnhubBase: R, tiingoBase: R },
});
bridge.listen(8788, '127.0.0.1', () => console.log('bridge di test pronto'));

// Ollama simulato (11499) per l'assistente AI
createMockOllama().server.listen(11499, '127.0.0.1');
