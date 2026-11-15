/// <reference lib="webworker" />
/**
 * On-device speech recognition (OpenAI Whisper via Transformers.js / ONNX Runtime).
 * Runs in a Web Worker so the editor stays responsive. The model is downloaded once from
 * Hugging Face and cached by the browser. No audio leaves the device.
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
// One thread keeps memory low (and SharedArrayBuffer isn't available on GitHub Pages anyway).
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModel = '';

type Req = { id: number; audio: Float32Array; model: string; language: string | null; allowGpu: boolean };

async function load(model: string, allowGpu: boolean) {
  if (asr && loadedModel === model) return asr;
  const hasWebGPU = allowGpu && !!(self.navigator as Navigator & { gpu?: unknown }).gpu;
  const opts: Record<string, unknown> = {
    progress_callback: (p: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
      if (p.status === 'progress') postMessage({ type: 'download', file: p.file, progress: p.progress ?? 0, loaded: p.loaded, total: p.total });
    },
  };
  if (hasWebGPU) {
    opts.device = 'webgpu';
    opts.dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
  } else {
    opts.device = 'wasm';
    opts.dtype = 'q8';
  }
  asr = (await pipeline('automatic-speech-recognition', model, opts)) as AutomaticSpeechRecognitionPipeline;
  loadedModel = model;
  return asr;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, audio, model, language, allowGpu } = e.data;
  try {
    const p = await load(model, allowGpu);
    postMessage({ type: 'status', id, status: 'transcribing' });
    const common = { chunk_length_s: 30, stride_length_s: 5, ...(language ? { language, task: 'transcribe' } : {}) };
    let words: { text: string; start: number; end: number }[] = [];
    let approximate = false;
    try {
      const out = (await p(audio, { ...common, return_timestamps: 'word' } as never)) as { chunks?: { text: string; timestamp: [number, number | null] }[] };
      words = (out.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
    } catch (wordErr) {
      // Some model builds don't support word timestamps: fall back to phrase timestamps.
      console.warn('Word timestamps unavailable, using phrase timestamps', wordErr);
      const out = (await p(audio, { ...common, return_timestamps: true } as never)) as { chunks?: { text: string; timestamp: [number, number | null] }[] };
      approximate = true;
      for (const c of out.chunks ?? []) {
        const parts = c.text.trim().split(/\s+/).filter(Boolean);
        const s = c.timestamp[0], en = c.timestamp[1] ?? s + parts.length * 0.35;
        parts.forEach((w, i) => words.push({ text: w, start: s + ((en - s) * i) / parts.length, end: s + ((en - s) * (i + 1)) / parts.length }));
      }
    }
    postMessage({ type: 'result', id, words, approximate });
  } catch (err) {
    postMessage({ type: 'error', id, message: (err as Error)?.message || String(err) });
  }
};
