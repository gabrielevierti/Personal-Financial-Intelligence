/**
 * Ollama simulato per i test: /api/tags e /api/chat in streaming NDJSON, con risposte deterministiche.
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUESS = [
  [/moo|zara|amazon/i, 'exp-shopping'],
  [/hazama|ristorante|sushi/i, 'exp-restaurants'],
  [/embraer|volo/i, 'exp-travel'],
];

export function createMockOllama({ models = ['qwen2.5:3b'] } = {}) {
  const state = { requests: [] };
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } : {};
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      return res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
    }
    if (req.url === '/api/chat' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      state.requests.push(body);
      if (!models.includes(body.model)) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
        return res.end(JSON.stringify({ error: `model "${body.model}" not found, try pulling it first` }));
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', ...cors });
      let text;
      if (body.format?.properties?.quality_view) {
        const C = (t, type) => ({ text: t, type });
        text = JSON.stringify({ summary: 'Sintesi di prova basata sul contesto.', business: 'Azienda di software.', risks: [C('Concorrenza nel settore', 'ipotesi')], strengths: [C('Margini in crescita', 'fatto')], weaknesses: [C('Debito presente', 'fatto')], opportunities: [C('Nuovi mercati', 'ipotesi')], threats: [C('Rallentamento economico', 'ipotesi')], quality_view: 'Redditività solida secondo i dati.', price_view: 'Il prezzo è nell\'intervallo degli scenari.', questions: ['La crescita è sostenibile?'] });
      } else if (body.format) {
        const prompt = body.messages.at(-1).content;
        const lines = [...prompt.matchAll(/^(\d+)\. (.*)$/gm)];
        text = JSON.stringify({
          risultati: lines.map(([, n, d]) => ({ n: Number(n), categoria: (GUESS.find(([re]) => re.test(d)) ?? [null, prompt.includes('inc-other') && !prompt.includes('exp-other') ? 'inc-other' : 'exp-other'])[1] })),
        });
      } else {
        const sys = body.messages[0].content;
        const ok = sys.includes('PREVISIONE') && sys.includes('CONTI');
        text = `<think>ragionamento interno</think>**Riepilogo**\n\n- ${ok ? 'Ho ricevuto il contesto finanziario.' : 'Contesto mancante.'}\n- Domanda: ${body.messages.at(-1).content}`;
      }
      // streaming a pezzi, come Ollama
      for (const part of text.match(/.{1,12}/gs) ?? []) res.write(`${JSON.stringify({ message: { role: 'assistant', content: part }, done: false })}\n`);
      res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`);
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });
  return { server, state };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createMockOllama().server.listen(Number(process.argv[2] ?? 11499), '127.0.0.1');
}
