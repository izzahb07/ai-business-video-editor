/**
 * Audio engine. `buildAudioGraph` is used by BOTH the live preview (AudioContext) and the
 * export (OfflineAudioContext), so what you hear is what is encoded.
 */
import type { AudioItem, Clip, Project } from '../types';
import { layoutClips } from '../lib/timeline';
import { getAudio } from '../lib/registry';

export const HOP = 0.02; // analysis window (seconds)
export const CUT_FADE = 0.006;

export interface AudioAnalysis {
  /** RMS level in dBFS per HOP window. */
  db: Float32Array;
  /** Peak amplitude per HOP window (waveforms). */
  peaks: Float32Array;
  noiseFloor: number;
  /** Level above which we consider it speech/sound. */
  speechThreshold: number;
}

const analysisCache = new WeakMap<AudioBuffer, AudioAnalysis>();

export function analyzeBuffer(buf: AudioBuffer): AudioAnalysis {
  const have = analysisCache.get(buf);
  if (have) return have;
  const hopN = Math.round(buf.sampleRate * HOP);
  const n = Math.max(1, Math.floor(buf.length / hopN));
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const db = new Float32Array(n);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, pk = 0;
    const o = i * hopN;
    for (let j = 0; j < hopN; j++) {
      const v = (L[o + j] + R[o + j]) * 0.5;
      sum += v * v;
      const a = Math.abs(v);
      if (a > pk) pk = a;
    }
    db[i] = 10 * Math.log10(sum / hopN + 1e-12);
    peaks[i] = pk;
  }
  const sorted = Array.from(db).filter((v) => v > -100).sort((a, b) => a - b);
  const noiseFloor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -90;
  const loud = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : -20;
  // Threshold between noise floor and typical loud level, but never absurdly low.
  const speechThreshold = Math.max(-55, Math.min(noiseFloor + 12, loud - 12));
  const a = { db, peaks, noiseFloor, speechThreshold };
  analysisCache.set(buf, a);
  return a;
}

/** Ranges (source seconds) where level stays below `thresholdDb` for at least `minDur`. */
export function quietRanges(a: AudioAnalysis, thresholdDb: number, minDur: number, from = 0, to = Infinity): [number, number][] {
  const out: [number, number][] = [];
  const i0 = Math.max(0, Math.floor(from / HOP)), i1 = Math.min(a.db.length, Math.ceil(to / HOP));
  let start = -1;
  for (let i = i0; i <= i1; i++) {
    const quiet = i < i1 && a.db[i] < thresholdDb;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      const s = start * HOP, e = i * HOP;
      if (e - s >= minDur) out.push([s, e]);
      start = -1;
    }
  }
  return out;
}

/** Ranges (source seconds) with sound above the speech threshold, merged with a hold time. */
export function speechRanges(a: AudioAnalysis, hold = 0.3): [number, number][] {
  const out: [number, number][] = [];
  let start = -1, lastLoud = -1;
  for (let i = 0; i < a.db.length; i++) {
    if (a.db[i] >= a.speechThreshold) {
      if (start < 0) start = i;
      lastLoud = i;
    } else if (start >= 0 && (i - lastLoud) * HOP > hold) {
      out.push([start * HOP, (lastLoud + 1) * HOP]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start * HOP, (lastLoud + 1) * HOP]);
  return out;
}

/** Timeline ranges where an unmuted clip has speech (used for ducking). */
export function timelineSpeech(clips: Clip[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of layoutClips(clips)) {
    const c = p.clip;
    if (c.muted || c.volume <= 0) continue;
    const buf = getAudio(c.assetId);
    if (!buf) continue;
    for (const [s, e] of speechRanges(analyzeBuffer(buf))) {
      const a = Math.max(s, c.in), b = Math.min(e, c.out);
      if (b > a) out.push([p.start + (a - c.in), p.start + (b - c.in)]);
    }
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

type Env = [number, number][]; // [timeline time, gain] piecewise-linear

function envAt(env: Env, t: number): number {
  if (!env.length) return 1;
  if (t <= env[0][0]) return env[0][1];
  for (let i = 0; i < env.length - 1; i++) {
    const [ta, va] = env[i], [tb, vb] = env[i + 1];
    if (t >= ta && t <= tb) return tb > ta ? va + ((vb - va) * (t - ta)) / (tb - ta) : vb;
  }
  return env[env.length - 1][1];
}

/** Multiply two envelopes (evaluated on the union of their points). */
function mulEnv(a: Env, b: Env): Env {
  if (!b.length) return a;
  if (!a.length) return b;
  const ts = Array.from(new Set([...a.map((p) => p[0]), ...b.map((p) => p[0])])).sort((x, y) => x - y);
  return ts.map((t) => [t, envAt(a, t) * envAt(b, t)]);
}

function applyEnv(param: AudioParam, env: Env, t0: number, t1: number, toCtx: (t: number) => number) {
  param.setValueAtTime(envAt(env, t0), toCtx(t0));
  for (const [t, v] of env) if (t > t0 && t <= t1 + 0.5) param.linearRampToValueAtTime(v, toCtx(t));
}

/** Envelope that dips to `level` during speech ranges (with attack/release). */
function duckEnv(speech: [number, number][], level: number): Env {
  const env: Env = [];
  for (const [s, e] of speech) {
    env.push([s - 0.15, 1], [s, level], [e, level], [e + 0.35, 1]);
  }
  // Merge overlapping ramps by sorting; overlapping dips stay at `level`.
  env.sort((a, b) => a[0] - b[0]);
  const out: Env = [];
  for (const p of env) {
    const inDip = speech.some(([s, e]) => p[0] > s && p[0] < e);
    out.push([p[0], inDip ? level : p[1]]);
  }
  return out;
}

/** Noise gate envelope (source → timeline) attenuating gaps between words. */
function gateEnv(clip: Clip, start: number, buf: AudioBuffer): Env {
  const a = analyzeBuffer(buf);
  const floor = 0.12; // ≈ -18 dB
  const env: Env = [[start, floor]];
  for (const [s, e] of speechRanges(a, 0.12)) {
    const x = Math.max(s, clip.in), y = Math.min(e, clip.out);
    if (y <= x) continue;
    const ts = start + (x - clip.in), te = start + (y - clip.in);
    env.push([ts - 0.03, floor], [ts, 1], [te, 1], [te + 0.08, floor]);
  }
  return env;
}

export interface GraphHandle {
  nodes: AudioScheduledSourceNode[];
  stop(): void;
}

/**
 * Schedule every sound of the project between timeline times t0 and t1 into `ctx`,
 * with timeline t0 playing at context time `when0`.
 */
export function buildAudioGraph(
  ctx: BaseAudioContext, project: Project, t0: number, t1: number, when0: number, dest: AudioNode,
): GraphHandle {
  const nodes: AudioScheduledSourceNode[] = [];
  const toCtx = (t: number) => when0 + (t - t0);
  const placed = layoutClips(project.clips);

  // ---- Original clip audio ----
  for (const p of placed) {
    const c = p.clip;
    if (c.muted || c.volume <= 0 || p.end <= t0 || p.start >= t1) continue;
    const buf = getAudio(c.assetId);
    if (!buf) continue;
    const a = Math.max(p.start, t0), b = Math.min(p.end, t1);
    const offset = c.in + (a - p.start);
    if (b <= a || offset >= buf.duration) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let node: AudioNode = src;
    if (c.voice.enhance) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7;
      const pres = ctx.createBiquadFilter();
      pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 3.5;
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 2;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.ratio.value = 3.5; comp.knee.value = 8; comp.attack.value = 0.006; comp.release.value = 0.2;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.35;
      node.connect(hp); hp.connect(pres); pres.connect(air); air.connect(comp); comp.connect(makeup);
      node = makeup;
    }
    const g = ctx.createGain();
    const len = p.end - p.start;
    const f = Math.min(CUT_FADE, len / 4);
    let env: Env = [[p.start, 0], [p.start + f, c.volume], [p.end - f, c.volume], [p.end, 0]];
    if (c.voice.denoise) env = mulEnv(env, gateEnv(c, p.start, buf));
    applyEnv(g.gain, env, a, b, toCtx);
    node.connect(g).connect(dest);
    src.start(toCtx(a), offset, b - a);
    nodes.push(src);
  }

  // ---- Music & sound effects ----
  const needsDuck = project.audio.items.some((i) => i.duck);
  const speech = needsDuck ? timelineSpeech(project.clips) : [];
  for (const it of project.audio.items) scheduleItem(ctx, it, project, speech, t0, t1, toCtx, dest, nodes);

  return {
    nodes,
    stop() {
      for (const n of nodes) {
        try { n.stop(); } catch { /* not started / already stopped */ }
      }
    },
  };
}

function scheduleItem(
  ctx: BaseAudioContext, it: AudioItem, project: Project, speech: [number, number][], t0: number, t1: number,
  toCtx: (t: number) => number, dest: AudioNode, nodes: AudioScheduledSourceNode[],
) {
  const buf = getAudio(it.assetId);
  if (!buf || it.volume <= 0) return;
  const s = it.start, e = it.start + it.length;
  if (e <= t0 || s >= t1) return;
  const g = ctx.createGain();
  const fi = Math.min(it.fadeIn, it.length / 2), fo = Math.min(it.fadeOut, it.length / 2);
  let env: Env = [
    [s, fi > 0 ? 0 : it.volume], [s + Math.max(fi, CUT_FADE), it.volume],
    [e - Math.max(fo, CUT_FADE), it.volume], [e, fo > 0 ? 0 : 0],
  ];
  if (it.duck && speech.length) env = mulEnv(env, duckEnv(speech, project.audio.duckLevel));
  applyEnv(g.gain, env, Math.max(s, t0), Math.min(e, t1), toCtx);
  g.connect(dest);

  // One source per (looped) repetition within the window.
  const segLen = Math.max(0.05, buf.duration - it.in);
  let tl = s;
  let rep = 0;
  while (tl < e && rep < 500) {
    const repEnd = Math.min(e, tl + segLen);
    const a = Math.max(tl, t0), b = Math.min(repEnd, t1);
    if (b > a) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(toCtx(a), it.in + (a - tl), b - a);
      nodes.push(src);
    }
    if (!it.loop) break;
    tl = repEnd;
    rep++;
  }
}

/** Render a window of the final mix offline (used by export, in segments). */
export async function renderMix(project: Project, t0: number, t1: number, rate = 48000): Promise<AudioBuffer> {
  const PRE = Math.min(0.5, t0); // pre-roll so filters/compressors are settled at the segment start
  const length = Math.max(1, Math.round((t1 - t0 + PRE) * rate));
  const ctx = new OfflineAudioContext(2, length, rate);
  buildAudioGraph(ctx, project, t0 - PRE, t1, 0, ctx.destination);
  const full = await ctx.startRendering();
  if (PRE <= 0) return full;
  const skip = Math.round(PRE * rate);
  const outLen = Math.max(1, full.length - skip);
  const out = new AudioBuffer({ length: outLen, numberOfChannels: 2, sampleRate: rate });
  for (let ch = 0; ch < 2; ch++) out.copyToChannel(full.getChannelData(ch).subarray(skip, skip + outLen), ch);
  return out;
}
