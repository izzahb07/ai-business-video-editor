/**
 * AI Business Video Studio — optional AI server (Cloudflare Worker).
 *
 * Why a server? API keys must never be inside the app (anyone could copy them).
 * This worker keeps the keys as encrypted Cloudflare secrets and only accepts
 * requests that carry your passcode, from your app's address.
 *
 * Routes
 *   GET  /health        → which features are configured
 *   POST /transcribe    → speech-to-text with word timestamps (OpenAI-compatible API: OpenAI or Groq)
 *   POST /ai/hooks      → hook ideas, video structure, titles, captions, CTA (Claude)
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export interface Env {
  /** Required: shared passcode you also enter in the app. */
  APP_PASSCODE: string;
  /** Comma-separated origins allowed to call this server, e.g. https://you.github.io */
  ALLOWED_ORIGINS?: string;
  /** Transcription: OpenAI (default) or Groq (OpenAI-compatible). */
  TRANSCRIBE_API_KEY?: string;
  TRANSCRIBE_BASE_URL?: string; // default https://api.openai.com/v1 ; Groq: https://api.groq.com/openai/v1
  TRANSCRIBE_MODEL?: string; // default whisper-1 ; Groq: whisper-large-v3-turbo
  /** Claude for hooks/structure. */
  ANTHROPIC_API_KEY?: string;
}

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const CLAUDE_MODEL = 'claude-opus-5-5';

// ---------------------------------------------------------------- helpers
function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 ? false : allowed.includes(origin);
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Passcode',
    'Access-Control-Max-Age': '86400',
  };
}

function json(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(req, env) } });
}

/** Constant-time string comparison (avoids leaking the passcode through timing). */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------- transcription
export interface Word { text: string; start: number; end: number }

async function transcribe(req: Request, env: Env, fetchImpl: typeof fetch): Promise<Response> {
  if (!env.TRANSCRIBE_API_KEY) return json(req, env, { error: 'Transcription is not configured on this server (TRANSCRIBE_API_KEY missing).' }, 501);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !file || typeof file === 'string') return json(req, env, { error: 'Send the audio as multipart field "file".' }, 400);
  if (file.size > MAX_AUDIO_BYTES) return json(req, env, { error: 'Audio part is larger than 25 MB.' }, 413);
  const language = String(form.get('language') || '');
  if (language && !/^[a-z]{2}$/.test(language)) return json(req, env, { error: 'Invalid language code.' }, 400);

  const up = new FormData();
  up.append('file', file, 'audio.wav');
  // Groq keys start with "gsk_": use Groq's (free-tier) Whisper automatically.
  const groq = env.TRANSCRIBE_API_KEY.startsWith('gsk_');
  up.append('model', env.TRANSCRIBE_MODEL || (groq ? 'whisper-large-v3-turbo' : 'whisper-1'));
  up.append('response_format', 'verbose_json');
  up.append('timestamp_granularities[]', 'word');
  up.append('timestamp_granularities[]', 'segment');
  if (language) up.append('language', language);

  const base = (env.TRANSCRIBE_BASE_URL || (groq ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1')).replace(/\/+$/, '');
  const r = await fetchImpl(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${env.TRANSCRIBE_API_KEY}` }, body: up });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    return json(req, env, { error: `Speech-to-text provider error ${r.status}: ${detail}` }, 502);
  }
  const data = (await r.json()) as {
    language?: string; text?: string;
    words?: { word: string; start: number; end: number }[];
    segments?: { text: string; start: number; end: number }[];
  };
  let words: Word[] = (data.words || []).map((w) => ({ text: w.word, start: w.start, end: w.end }));
  let approximate = false;
  if (!words.length && data.segments?.length) {
    // Provider gave phrases only: spread words evenly inside each phrase.
    approximate = true;
    for (const s of data.segments) {
      const parts = s.text.trim().split(/\s+/).filter(Boolean);
      parts.forEach((p, i) => words.push({ text: p, start: s.start + ((s.end - s.start) * i) / parts.length, end: s.start + ((s.end - s.start) * (i + 1)) / parts.length }));
    }
  }
  words = words.filter((w) => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end));
  return json(req, env, { language: normalizeLang(data.language), words, approximate });
}

function normalizeLang(l?: string): string {
  const v = (l || '').toLowerCase();
  if (v.startsWith('en')) return 'en';
  if (v === 'malay' || v === 'ms' || v.startsWith('ms')) return 'ms';
  return v || 'auto';
}

// ---------------------------------------------------------------- hooks (Claude)
export const HOOK_STYLES = ['curiosity', 'problem-solution', 'emotional', 'controversial-truthful', 'educational', 'storytelling', 'question'] as const;

export const HooksRequest = z.object({
  transcript: z.string().max(60000).default(''),
  description: z.string().max(4000).default(''),
  objective: z.enum(['sales', 'awareness', 'education', 'engagement', 'storytelling']).default('engagement'),
  language: z.enum(['en', 'ms', 'auto']).default('auto'),
  durationSec: z.number().min(0).max(36000).default(0),
});

export const HooksResult = z.object({
  hooks: z.array(z.object({
    style: z.enum(HOOK_STYLES),
    text: z.string().describe('On-screen hook text, max ~12 words'),
    spoken: z.string().describe('What to say in the first 1-3 seconds'),
    openingVisual: z.string().describe('What to show in the first 1-3 seconds, using the user\'s footage'),
    why: z.string(),
  })),
  bestHookIndex: z.number().int(),
  structure: z.array(z.object({
    part: z.enum(['Hook', 'Context', 'Main content', 'Supporting footage', 'Key message', 'Payoff', 'Call to action']),
    guidance: z.string(),
    onScreenText: z.string(),
  })),
  retentionTips: z.array(z.string()),
  titles: z.array(z.string()),
  description: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
  claimsToVerify: z.array(z.string()).describe('Any statement the user must verify before publishing'),
});

const SYSTEM = `You are a senior social-media video strategist for small businesses.
You write hooks and structures for short vertical videos (TikTok, Reels, Shorts) and YouTube.

Hard rules:
- Use ONLY facts present in the transcript or the description. Never invent statistics, prices, results, awards, customer names or testimonials.
- "Controversial" hooks must still be truthful and fair; no attacks on people or competitors.
- If a hook implies a claim the material doesn't prove, list that claim in claimsToVerify.
- Write in the language of the transcript (English or Bahasa Melayu) unless the request names a language.
- Hook text must be short enough to read in 2 seconds (max ~12 words).
- Return exactly 10 hooks covering these styles at least once: curiosity, problem-solution, emotional, controversial-truthful, educational, storytelling, question.`;

export type ClaudeFactory = (apiKey: string) => Pick<Anthropic, 'beta'>;

async function hooks(req: Request, env: Env, makeClient: ClaudeFactory): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) return json(req, env, { error: 'AI hooks are not configured on this server (ANTHROPIC_API_KEY missing).' }, 501);
  const parsed = HooksRequest.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json(req, env, { error: 'Invalid request: ' + parsed.error.issues[0]?.message }, 400);
  const body = parsed.data;
  if (!body.transcript.trim() && !body.description.trim()) return json(req, env, { error: 'Provide a transcript or a short description of the video.' }, 400);

  const client = makeClient(env.ANTHROPIC_API_KEY);
  const userText = [
    `Objective: ${body.objective}`,
    `Requested language: ${body.language === 'auto' ? 'same as transcript' : body.language === 'ms' ? 'Bahasa Melayu' : 'English'}`,
    body.durationSec ? `Current video length: ${Math.round(body.durationSec)} seconds` : '',
    body.description ? `Creator's description:\n${body.description}` : '',
    body.transcript ? `Transcript of the footage:\n${body.transcript}` : 'No transcript (footage has no speech).',
  ].filter(Boolean).join('\n\n');

  try {
    const msg = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(HooksResult) },
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
    });
    if (msg.stop_reason === 'refusal') return json(req, env, { error: 'The AI declined this request. Try rephrasing the description.' }, 422);
    if (msg.stop_reason === 'max_tokens' || !msg.parsed_output) return json(req, env, { error: 'The AI response was incomplete. Please try again.' }, 502);
    return json(req, env, { ...msg.parsed_output, model: msg.model });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(req, env, { error: 'AI rate limit reached — wait a minute and retry.' }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json(req, env, { error: 'The server\'s ANTHROPIC_API_KEY is invalid.' }, 502);
    if (err instanceof Anthropic.APIError) return json(req, env, { error: `AI provider error ${err.status ?? ''}: ${err.message}`.slice(0, 300) }, 502);
    return json(req, env, { error: 'AI request failed: ' + (err as Error).message }, 502);
  }
}

// ---------------------------------------------------------------- router
export async function handle(
  req: Request, env: Env,
  deps: { fetch?: typeof fetch; claude?: ClaudeFactory } = {},
): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (!env.APP_PASSCODE) return json(req, env, { error: 'Server is missing APP_PASSCODE.' }, 500);
  if (!safeEqual(req.headers.get('X-App-Passcode') || '', env.APP_PASSCODE)) return json(req, env, { error: 'Wrong passcode.' }, 401);

  if (url.pathname === '/health' && req.method === 'GET') {
    return json(req, env, { ok: true, transcription: !!env.TRANSCRIBE_API_KEY, ai: !!env.ANTHROPIC_API_KEY });
  }
  if (url.pathname === '/transcribe' && req.method === 'POST') return transcribe(req, env, deps.fetch ?? fetch);
  if (url.pathname === '/ai/hooks' && req.method === 'POST') {
    return hooks(req, env, deps.claude ?? ((apiKey) => new Anthropic({ apiKey })));
  }
  return json(req, env, { error: 'Not found' }, 404);
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
