/**
 * Connection to YOUR AI server (see /server). API keys live only on that server.
 * The app stores just the server address and a passcode on this device.
 */
import { create } from 'zustand';

export interface ServiceConfig {
  url: string;
  passcode: string;
  /** User agreed that clip AUDIO may be sent to their server for transcription. */
  consentAudio: boolean;
  /** User agreed that transcript TEXT may be sent for hook/script suggestions. */
  consentText: boolean;
}

const KEY = 'ai-service-v1';
function load(): ServiceConfig {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '');
    if (v && typeof v.url === 'string') return { consentAudio: false, consentText: false, passcode: '', ...v };
  } catch { /* ignore */ }
  return { url: '', passcode: '', consentAudio: false, consentText: false };
}

export const useService = create<ServiceConfig & { set: (p: Partial<ServiceConfig>) => void }>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p);
    const { url, passcode, consentAudio, consentText } = { ...get(), ...p };
    try { localStorage.setItem(KEY, JSON.stringify({ url, passcode, consentAudio, consentText })); } catch { /* ignore */ }
  },
}));

export function serviceConfigured(): boolean {
  const s = useService.getState();
  return /^https?:\/\//.test(s.url.trim());
}

export class ServiceError extends Error {}

export async function callService(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const s = useService.getState();
  if (!serviceConfigured()) throw new ServiceError('No AI server is connected. Open Studio settings (ⓘ) → AI server.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 180000);
  try {
    const res = await fetch(s.url.replace(/\/+$/, '') + path, {
      ...init,
      signal: ctrl.signal,
      headers: { ...(init.headers || {}), 'X-App-Passcode': s.passcode },
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = (body as { error?: string } | null)?.error || text.slice(0, 200) || res.statusText;
      if (res.status === 401) throw new ServiceError('The AI server rejected the passcode. Check it in Studio settings.');
      throw new ServiceError(`AI server error (${res.status}): ${msg}`);
    }
    return body;
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    if ((err as Error).name === 'AbortError') throw new ServiceError('The AI server took too long to respond.');
    throw new ServiceError(`Could not reach the AI server (${(err as Error).message}). Check the address and your connection.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkService(): Promise<{ ok: boolean; transcription: boolean; ai: boolean; message: string }> {
  try {
    const r = (await callService('/health', { timeoutMs: 15000 })) as { transcription?: boolean; ai?: boolean };
    return { ok: true, transcription: !!r?.transcription, ai: !!r?.ai, message: 'Connected' };
  } catch (e) {
    return { ok: false, transcription: false, ai: false, message: (e as Error).message };
  }
}
