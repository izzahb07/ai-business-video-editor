/** Prepare speech audio for transcription: mono, 16 kHz (what Whisper expects). */
import type { WordTiming } from '../../types';

export async function toMono16k(buf: AudioBuffer, from = 0, to = buf.duration): Promise<Float32Array> {
  const dur = Math.max(0.1, Math.min(to, buf.duration) - from);
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * 16000), 16000);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination); // stereo → mono down-mix happens automatically
  src.start(0, from, dur);
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice();
}

/** 16-bit PCM WAV (for uploading to a transcription service). */
export function encodeWav(samples: Float32Array, rate = 16000): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Clean up word tokens (Whisper puts leading spaces; drop empty/garbage). */
export function cleanWords(words: WordTiming[]): WordTiming[] {
  const out: WordTiming[] = [];
  for (const w of words) {
    const text = w.text.trim();
    if (!text || !isFinite(w.start) || !isFinite(w.end)) continue;
    // Merge stray punctuation into the previous word.
    if (/^[.,!?;:%)"'’”]+$/.test(text) && out.length) {
      out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + text, end: Math.max(out[out.length - 1].end, w.end) };
      continue;
    }
    out.push({ text, start: Math.max(0, w.start), end: Math.max(w.start + 0.04, w.end) });
  }
  return out;
}

/** Group words into caption phrases at sentence ends, pauses, or ~8 words. */
export function groupPhrases(words: WordTiming[], maxWords = 8, pause = 0.6): WordTiming[][] {
  const groups: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const endSentence = /[.!?]$/.test(w.text);
    const gap = next ? next.start - w.end : Infinity;
    if (endSentence || gap > pause || cur.length >= maxWords || !next) {
      groups.push(cur);
      cur = [];
    }
  });
  return groups;
}
