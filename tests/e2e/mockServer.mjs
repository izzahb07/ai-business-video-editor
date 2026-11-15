// Runs the REAL AI server code (server/src/index.ts) locally, with only the external
// providers (speech-to-text API and Claude) replaced by fakes.
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { ROOT, OUT } from './lib.mjs';

export async function startAiServer({ port = 4190, words, hooksResult }) {
  const outFile = path.join(OUT, 'worker-bundle.mjs');
  execFileSync(path.join(ROOT, 'server/node_modules/.bin/esbuild'), [path.join(ROOT, 'server/src/index.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${outFile}`]);
  const { handle } = await import(outFile + '?t=' + Date.now());
  const env = { APP_PASSCODE: 'test-pass', ALLOWED_ORIGINS: 'http://localhost:4180', TRANSCRIBE_API_KEY: 'fake', ANTHROPIC_API_KEY: 'fake' };
  const log = { transcribe: [], hooks: [] };
  const fakeFetch = async (url, init) => {
    const file = init.body.get('file');
    const buf = Buffer.from(await file.arrayBuffer());
    log.transcribe.push({ url, language: init.body.get('language'), bytes: buf.length, rate: buf.readUInt32LE(24), channels: buf.readUInt16LE(22), model: init.body.get('model') });
    return new Response(JSON.stringify({ language: 'english', words: words.map((w) => ({ word: w.text, start: w.start, end: w.end })) }));
  };
  const fakeClaude = () => ({ beta: { messages: { parse: async (params) => { log.hooks.push(params); return { stop_reason: 'end_turn', parsed_output: hooksResult, model: params.model }; } } } });
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : body, duplex: 'half' });
    const r = await handle(request, env, { fetch: fakeFetch, claude: fakeClaude });
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((r) => srv.listen(port, r));
  return { url: `http://localhost:${port}`, passcode: 'test-pass', log, close: () => srv.close() };
}
