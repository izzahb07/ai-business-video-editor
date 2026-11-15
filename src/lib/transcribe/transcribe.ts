/** Transcription orchestrator: on-device Whisper or the user's cloud server. */
import type { Asset, Transcript, WordTiming } from '../../types';
import { waitForAudio } from '../registry';
import { callService } from '../ai/service';
import { cleanWords, encodeWav, toMono16k } from './audioPrep';
import { guard, hasCrashed, isIOS } from '../crashGuard';

export type Engine = 'on-device' | 'cloud';
export type Lang = 'auto' | 'en' | 'ms';

export interface TranscribeProgress {
  stage: 'preparing' | 'downloading-model' | 'transcribing' | 'uploading';
  /** 0..1 when known. */
  progress?: number;
  detail?: string;
}

export const ON_DEVICE_MODELS = [
  { id: 'onnx-community/whisper-base_timestamped', label: 'Standard (≈80 MB, more accurate)' },
  { id: 'onnx-community/whisper-tiny_timestamped', label: 'Fast (≈40 MB, less accurate)' },
];

const LANG_NAME: Record<Exclude<Lang, 'auto'>, string> = { en: 'english', ms: 'malay' };

let worker: Worker | null = null;
let reqId = 0;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

async function onDevice(audio: Float32Array, lang: Lang, model: string, onProgress: (p: TranscribeProgress) => void) {
  const w = getWorker();
  const id = ++reqId;
  const files = new Map<string, { loaded: number; total: number }>();
  return new Promise<{ words: WordTiming[]; approximate: boolean }>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'download') {
        if (m.file && m.total) files.set(m.file, { loaded: m.loaded ?? 0, total: m.total });
        const tot = [...files.values()].reduce((a, f) => a + f.total, 0);
        const got = [...files.values()].reduce((a, f) => a + f.loaded, 0);
        onProgress({ stage: 'downloading-model', progress: tot ? got / tot : undefined, detail: tot ? `${(got / 1e6).toFixed(0)} / ${(tot / 1e6).toFixed(0)} MB` : undefined });
        return;
      }
      if (m.id !== id) return;
      if (m.type === 'status') onProgress({ stage: 'transcribing' });
      else if (m.type === 'result') { w.removeEventListener('message', onMsg); resolve({ words: m.words, approximate: m.approximate }); }
      else if (m.type === 'error') { w.removeEventListener('message', onMsg); reject(new Error(m.message)); }
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', (ev) => reject(new Error(ev.message || 'Speech model failed to load.')), { once: true });
    w.postMessage({ id, audio, model, language: lang === 'auto' ? null : LANG_NAME[lang], allowGpu: !isIOS() }, [audio.buffer]);
  });
}

const CLOUD_CHUNK = 600; // seconds per upload (~19 MB WAV, under typical 25 MB limits)

async function cloud(buf: AudioBuffer, lang: Lang, onProgress: (p: TranscribeProgress) => void) {
  const words: WordTiming[] = [];
  let language = lang;
  const n = Math.ceil(buf.duration / CLOUD_CHUNK);
  for (let i = 0; i < n; i++) {
    const from = i * CLOUD_CHUNK, to = Math.min(buf.duration, from + CLOUD_CHUNK);
    onProgress({ stage: 'uploading', progress: i / n, detail: n > 1 ? `Part ${i + 1} of ${n}` : undefined });
    const wav = encodeWav(await toMono16k(buf, from, to));
    const form = new FormData();
    form.append('file', wav, 'audio.wav');
    if (lang !== 'auto') form.append('language', lang);
    const r = (await callService('/transcribe', { method: 'POST', body: form, timeoutMs: 300000 })) as {
      language?: string; words?: WordTiming[];
    };
    if (!r || !Array.isArray(r.words)) throw new Error('The AI server returned no words.');
    if (r.language) language = r.language as Lang;
    for (const w of r.words) words.push({ text: w.text, start: w.start + from, end: w.end + from });
  }
  return { words, language };
}

/** Transcribe one asset's audio. Word times are in the asset's SOURCE time. */
export async function transcribeAsset(
  asset: Asset, engine: Engine, lang: Lang, model: string, onProgress: (p: TranscribeProgress) => void,
): Promise<Transcript> {
  onProgress({ stage: 'preparing' });
  const buf = await waitForAudio(asset.id);
  if (!buf) throw new Error(`"${asset.name}" has no sound to transcribe.`);
  if (engine === 'cloud') {
    const r = await cloud(buf, lang, onProgress);
    return { language: r.language, words: cleanWords(r.words), source: 'cloud', model: 'server', approximateWords: false };
  }
  if (hasCrashed('transcribe:on-device')) {
    throw new Error('On-device captions crashed Safari on this device before (not enough memory). Connect your AI server for captions.');
  }
  // iPhones have little memory per tab: always use the small model there.
  const m = isIOS() ? ON_DEVICE_MODELS[1].id : model;
  const audio = await toMono16k(buf);
  const r = await guard('transcribe:on-device', () => onDevice(audio, lang, m, onProgress));
  model = m;
  return { language: lang, words: cleanWords(r.words), source: 'on-device', model, approximateWords: r.approximate };
}
