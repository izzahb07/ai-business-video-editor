import { describe, expect, it, vi } from 'vitest';
import { handle, type Env, type ClaudeFactory } from '../src/index';

const env: Env = { APP_PASSCODE: 'secret-pass', ALLOWED_ORIGINS: 'https://izzahb07.github.io', TRANSCRIBE_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant-test' };
const H = (extra: Record<string, string> = {}) => ({ 'X-App-Passcode': 'secret-pass', Origin: 'https://izzahb07.github.io', ...extra });

describe('auth & CORS', () => {
  it('rejects a wrong passcode', async () => {
    const r = await handle(new Request('https://w/health', { headers: { 'X-App-Passcode': 'nope' } }), env);
    expect(r.status).toBe(401);
  });
  it('reports configured features and allows only the app origin', async () => {
    const r = await handle(new Request('https://w/health', { headers: H() }), env);
    expect(await r.json()).toEqual({ ok: true, transcription: true, ai: true });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://izzahb07.github.io');
    const r2 = await handle(new Request('https://w/health', { headers: H({ Origin: 'https://evil.example' }) }), env);
    expect(r2.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('answers CORS preflight without a passcode', async () => {
    const r = await handle(new Request('https://w/transcribe', { method: 'OPTIONS', headers: { Origin: 'https://izzahb07.github.io' } }), env);
    expect(r.status).toBe(204);
  });
});

describe('/transcribe', () => {
  it('calls an OpenAI-compatible API with word timestamps and maps the result', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body as FormData;
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      expect(body.get('model')).toBe('whisper-1');
      expect(body.get('response_format')).toBe('verbose_json');
      expect(body.getAll('timestamp_granularities[]')).toContain('word');
      expect(body.get('language')).toBe('ms');
      return new Response(JSON.stringify({ language: 'malay', words: [{ word: 'Selamat', start: 0.1, end: 0.5 }, { word: 'datang', start: 0.5, end: 0.9 }] }));
    });
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(100)], { type: 'audio/wav' }), 'a.wav');
    fd.append('language', 'ms');
    const r = await handle(new Request('https://w/transcribe', { method: 'POST', headers: H(), body: fd }), env, { fetch: fetchMock as never });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ language: 'ms', approximate: false, words: [{ text: 'Selamat', start: 0.1, end: 0.5 }, { text: 'datang', start: 0.5, end: 0.9 }] });
  });
  it('uses Groq automatically for a gsk_ key', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
      expect((init.body as FormData).get('model')).toBe('whisper-large-v3-turbo');
      return new Response(JSON.stringify({ language: 'en', words: [{ word: 'Hi', start: 0, end: 0.3 }] }));
    });
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(10)]), 'a.wav');
    const r = await handle(new Request('https://w/transcribe', { method: 'POST', headers: H(), body: fd }), { ...env, TRANSCRIBE_API_KEY: 'gsk_abc' }, { fetch: fetchMock as never });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('rejects oversize audio and reports missing configuration', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(26 * 1024 * 1024)]), 'a.wav');
    const r = await handle(new Request('https://w/transcribe', { method: 'POST', headers: H(), body: fd }), env, { fetch: vi.fn() as never });
    expect(r.status).toBe(413);
    const r2 = await handle(new Request('https://w/transcribe', { method: 'POST', headers: H(), body: new FormData() }), { ...env, TRANSCRIBE_API_KEY: undefined });
    expect(r2.status).toBe(501);
  });
});

describe('/ai/hooks', () => {
  const okResult = {
    hooks: Array.from({ length: 10 }, (_, i) => ({ style: 'curiosity', text: `Hook ${i}`, spoken: 's', openingVisual: 'v', why: 'w' })),
    bestHookIndex: 0, structure: [{ part: 'Hook', guidance: 'g', onScreenText: 't' }], retentionTips: ['cut faster'],
    titles: ['T'], description: 'D', caption: 'C', hashtags: ['#a'], cta: 'Follow', claimsToVerify: [],
  };
  it('sends the transcript to Claude with structured output and returns parsed JSON', async () => {
    const parse = vi.fn(async (params: Record<string, unknown>) => {
      expect(params.model).toBe('claude-opus-5-5');
      expect(params.fallbacks).toBe('default');
      expect(JSON.stringify(params.messages)).toContain('We clean offices');
      return { stop_reason: 'end_turn', parsed_output: okResult, model: 'claude-opus-5-5' };
    });
    const claude: ClaudeFactory = () => ({ beta: { messages: { parse } } } as never);
    const r = await handle(new Request('https://w/ai/hooks', { method: 'POST', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ transcript: 'We clean offices in KL.', objective: 'sales' }) }), env, { claude });
    expect(r.status).toBe(200);
    const body = await r.json() as { hooks: unknown[] };
    expect(body.hooks).toHaveLength(10);
    expect(parse).toHaveBeenCalledOnce();
  });
  it('handles refusals and empty input', async () => {
    const claude: ClaudeFactory = () => ({ beta: { messages: { parse: async () => ({ stop_reason: 'refusal', parsed_output: null }) } } } as never);
    const r = await handle(new Request('https://w/ai/hooks', { method: 'POST', headers: H(), body: JSON.stringify({ description: 'x' }) }), env, { claude });
    expect(r.status).toBe(422);
    const r2 = await handle(new Request('https://w/ai/hooks', { method: 'POST', headers: H(), body: JSON.stringify({}) }), env, { claude });
    expect(r2.status).toBe(400);
  });
});
