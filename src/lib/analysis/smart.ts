/**
 * Smart-edit suggestions from REAL measurements (audio levels and video frames).
 * Nothing here is guessed: each suggestion cites what was measured, and applying it is a normal, undoable edit.
 */
import type { Asset, Clip, Project } from '../../types';
import { uid } from '../defaults';
import { layoutClips, type PlacedClip } from '../timeline';
import { getAudio } from '../registry';
import { analyzeBuffer, quietRanges, speechRanges, HOP } from '../../engine/audio';
import { analyzeVideo, sampleAt, similarity, type VideoAnalysis } from './video';
import { MIN_CLIP } from '../../store';

export type SuggestionType = 'silence' | 'deadair' | 'scene' | 'repeat' | 'opening' | 'order' | 'pacing';
export interface Suggestion {
  key: string;
  type: SuggestionType;
  basis: 'Audio analysis' | 'Visual analysis' | 'Rule-based scoring';
  title: string;
  detail: string;
  /** Timeline time to preview. */
  at: number;
  /** Seconds removed if accepted. */
  saves?: number;
  apply: (p: Project) => Project;
}

export interface SilenceSettings {
  /** dB below which audio counts as silence; null = automatic per clip. */
  thresholdDb: number | null;
  minPause: number;
  /** Kept on each side of a cut so words aren't clipped. */
  padding: number;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Replace a clip by the pieces left after removing source ranges. */
export function removeSourceRanges(p: Project, clipId: string, ranges: [number, number][]): Project {
  const i = p.clips.findIndex((c) => c.id === clipId);
  if (i < 0) return p;
  const c = p.clips[i];
  const keep: [number, number][] = [];
  let cur = c.in;
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (e <= cur || s >= c.out) continue;
    if (s > cur) keep.push([cur, Math.min(s, c.out)]);
    cur = Math.max(cur, e);
  }
  if (cur < c.out) keep.push([cur, c.out]);
  const pieces: Clip[] = keep.filter(([a, b]) => b - a >= MIN_CLIP).map(([a, b], k) => ({
    ...structuredClone(c), id: k === 0 ? c.id : uid(), in: a, out: b,
    transition: k === 0 ? c.transition : { type: 'none', duration: c.transition.duration },
  }));
  const clips = [...p.clips];
  clips.splice(i, 1, ...pieces);
  return { ...p, clips };
}

function silenceFor(placed: PlacedClip, s: SilenceSettings) {
  const c = placed.clip;
  const buf = getAudio(c.assetId);
  if (!buf || c.muted) return [];
  const a = analyzeBuffer(buf);
  const thr = s.thresholdDb ?? Math.min(a.speechThreshold - 4, -30);
  const out: { range: [number, number]; edge: 'start' | 'end' | null; level: number }[] = [];
  for (const [qs, qe] of quietRanges(a, thr, s.minPause, c.in, c.out)) {
    const atStart = qs <= c.in + HOP * 1.5, atEnd = qe >= c.out - HOP * 1.5;
    // Keep padding next to speech; at clip edges remove all the dead air.
    const rs = atStart ? c.in : qs + s.padding;
    const re = atEnd ? c.out : qe - s.padding;
    if (re - rs < 0.15) continue;
    let lvl = -120;
    for (let k = Math.floor(qs / HOP); k < Math.ceil(qe / HOP) && k < a.db.length; k++) lvl = Math.max(lvl, a.db[k]);
    out.push({ range: [rs, re], edge: atStart ? 'start' : atEnd ? 'end' : null, level: lvl });
  }
  return out;
}

export interface AnalyzeOptions { silence: SilenceSettings; onProgress?: (msg: string, p: number) => void; /** Skip video decoding (low memory). */ audioOnly?: boolean }

export async function analyzeProject(project: Project, assets: Record<string, Asset>, opts: AnalyzeOptions): Promise<Suggestion[]> {
  const placed = layoutClips(project.clips);
  const out: Suggestion[] = [];
  const videoAssets = opts.audioOnly ? [] : [...new Set(project.clips.map((c) => c.assetId))].map((id) => assets[id]).filter((a) => a?.kind === 'video');
  const va = new Map<string, VideoAnalysis | null>();
  for (let i = 0; i < videoAssets.length; i++) {
    const a = videoAssets[i];
    va.set(a.id, await analyzeVideo(a, (p) => opts.onProgress?.(`Looking at clip ${i + 1} of ${videoAssets.length}…`, (i + p) / videoAssets.length)));
  }

  // ---- 1. Silence, pauses and dead air ----
  for (const p of placed) {
    for (const s of silenceFor(p, opts.silence)) {
      const [a, b] = s.range;
      const tl = p.start + (a - p.clip.in);
      const type: SuggestionType = s.edge ? 'deadair' : 'silence';
      out.push({
        key: `${type}:${p.clip.assetId}:${a.toFixed(2)}`, type, basis: 'Audio analysis',
        title: s.edge === 'start' ? `Dead air at the start of clip ${p.index + 1}` : s.edge === 'end' ? `Dead air at the end of clip ${p.index + 1}` : `Pause in clip ${p.index + 1}`,
        detail: `${(b - a).toFixed(1)} s below ${Math.round(s.level)} dB at ${fmt(tl)}${s.edge ? '' : ` — keeps ${opts.silence.padding.toFixed(2)} s around words`}`,
        at: tl, saves: b - a,
        apply: (pp) => removeSourceRanges(pp, p.clip.id, [[a, b]]),
      });
    }
  }

  // ---- 2. Scene changes inside clips ----
  for (const p of placed) {
    const v = va.get(p.clip.assetId);
    if (!v || v.diff.length < 4) continue;
    const inRange = v.diff.map((d, i) => ({ d, t: v.times[i] })).filter((x) => x.t > p.clip.in + 0.3 && x.t < p.clip.out - 0.3);
    // Robust threshold (median + scaled MAD): one big cut can't hide itself by inflating the spread.
    const vals = v.diff.slice(1).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const mad = [...vals.map((x) => Math.abs(x - med))].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    const thr = Math.max(0.12, med + 8 * 1.4826 * mad);
    for (const x of inRange) {
      if (x.d < thr) continue;
      const tl = p.start + (x.t - p.clip.in);
      out.push({
        key: `scene:${p.clip.assetId}:${x.t.toFixed(2)}`, type: 'scene', basis: 'Visual analysis',
        title: `Scene change in clip ${p.index + 1} at ${fmt(tl)}`,
        detail: `Picture changes by ${(x.d * 100).toFixed(0)}% between frames. Split here to rearrange or remove a shot.`,
        at: tl,
        apply: (pp) => {
          const c = pp.clips.find((k) => k.id === p.clip.id);
          const cut = x.t - (v.times[1] - v.times[0]) / 2;
          if (!c || cut - c.in < MIN_CLIP || c.out - cut < MIN_CLIP) return pp;
          const i = pp.clips.indexOf(c);
          const clips = [...pp.clips];
          clips.splice(i, 1, { ...c, out: cut }, { ...structuredClone(c), id: uid(), in: cut, transition: { type: 'none', duration: c.transition.duration } });
          return { ...pp, clips };
        },
      });
    }
  }

  // ---- 3. Repetitive footage ----
  const sig = (c: Clip) => {
    const v = va.get(c.assetId);
    if (!v) return null;
    return [0.25, 0.5, 0.75].map((f) => v.frames[sampleAt(v, c.in + (c.out - c.in) * f)]);
  };
  const sigs = placed.map((p) => sig(p.clip));
  for (let j = 1; j < placed.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = sigs[i], b = sigs[j];
      if (!a || !b) continue;
      const sim = (similarity(a[0], b[0]) + similarity(a[1], b[1]) + similarity(a[2], b[2])) / 3;
      if (sim < 0.94) continue;
      const pj = placed[j];
      out.push({
        key: `repeat:${pj.clip.id}:${placed[i].clip.id}`, type: 'repeat', basis: 'Visual analysis',
        title: `Clip ${j + 1} looks like clip ${i + 1}`,
        detail: `${Math.round(sim * 100)}% visual match. Repeated shots lower retention — remove clip ${j + 1}?`,
        at: pj.start, saves: pj.end - pj.start,
        apply: (pp) => ({ ...pp, clips: pp.clips.filter((c) => c.id !== pj.clip.id) }),
      });
      break;
    }
  }

  // ---- 4. Strongest moments for the opening 3 seconds ----
  const scoreAt = (p: PlacedClip, src: number) => {
    const v = va.get(p.clip.assetId);
    const buf = getAudio(p.clip.assetId);
    let speech = 0, motion = 0, sharp = 0, bright = 0.5;
    if (buf && !p.clip.muted) {
      const sr = speechRanges(analyzeBuffer(buf));
      const covered = sr.reduce((n, [s, e]) => n + Math.max(0, Math.min(e, src + 3) - Math.max(s, src)), 0);
      speech = covered / 3;
    }
    if (v) {
      const idx = v.times.map((t, i) => ({ t, i })).filter((x) => x.t >= src && x.t < src + 3).map((x) => x.i);
      if (idx.length) {
        motion = Math.min(1, idx.reduce((n, i) => n + v.diff[i], 0) / idx.length / 0.08);
        sharp = Math.min(1, idx.reduce((n, i) => n + v.sharpness[i], 0) / idx.length / 0.12);
        bright = idx.reduce((n, i) => n + v.brightness[i], 0) / idx.length;
      }
    }
    const exposurePenalty = bright < 0.12 || bright > 0.95 ? 0.4 : 0;
    return { score: 0.45 * speech + 0.3 * motion + 0.25 * sharp - exposurePenalty, speech, motion, sharp };
  };
  const windows: { p: PlacedClip; src: number; tl: number; score: ReturnType<typeof scoreAt> }[] = [];
  for (const p of placed) {
    if (assets[p.clip.assetId]?.kind !== 'video' || p.end - p.start < 1.5) continue;
    for (let s = p.clip.in; s <= Math.max(p.clip.in, p.clip.out - 3) + 1e-6; s += 0.5) {
      windows.push({ p, src: s, tl: p.start + (s - p.clip.in), score: scoreAt(p, s) });
    }
  }
  if (windows.length > 1) {
    windows.sort((a, b) => b.score.score - a.score.score);
    const current = windows.find((w) => w.tl < 0.25);
    const best = windows[0];
    if (best.tl >= 1 && (!current || best.score.score > current.score.score + 0.12)) {
      const len = Math.min(3, best.p.clip.out - best.src);
      out.push({
        key: `opening:${best.p.clip.assetId}:${best.src.toFixed(1)}`, type: 'opening', basis: 'Rule-based scoring',
        title: `Stronger opening found at ${fmt(best.tl)}`,
        detail: `Speech ${Math.round(best.score.speech * 100)}%, motion ${Math.round(best.score.motion * 100)}%, detail ${Math.round(best.score.sharp * 100)}%${current ? ` vs your current first 3 s scoring ${Math.round(current.score.score * 100)}` : ''}. Adds this ${len.toFixed(1)} s moment as a teaser at the start.`,
        at: best.tl,
        apply: (pp) => {
          const src = pp.clips.find((c) => c.id === best.p.clip.id) ?? best.p.clip;
          const teaser: Clip = { ...structuredClone(src), id: uid(), in: best.src, out: best.src + len, transition: { type: 'none', duration: 0.5 } };
          const clips = pp.clips.map((c, i) => (i === 0 ? { ...c, transition: { type: 'zoom' as const, duration: 0.4 } } : c));
          return { ...pp, clips: [teaser, ...clips] };
        },
      });
    }
  }

  // ---- 5. Pacing: long static clips ----
  for (const p of placed) {
    const len = p.end - p.start;
    const v = va.get(p.clip.assetId);
    if (len < 8 || !v) continue;
    const idx = v.times.map((t, i) => ({ t, i })).filter((x) => x.t >= p.clip.in && x.t < p.clip.out).map((x) => x.i);
    const motion = idx.reduce((n, i) => n + v.diff[i], 0) / Math.max(1, idx.length);
    if (motion > 0.03) continue;
    out.push({
      key: `pacing:${p.clip.id}`, type: 'pacing', basis: 'Rule-based scoring',
      title: `Clip ${p.index + 1} is ${len.toFixed(0)} s with little movement`,
      detail: 'Add a punch-in: split in the middle and zoom the second half to 115% (a pattern interrupt that keeps viewers watching).',
      at: p.start + len / 2,
      apply: (pp) => {
        const c = pp.clips.find((k) => k.id === p.clip.id);
        if (!c) return pp;
        const mid = c.in + (c.out - c.in) / 2;
        const i = pp.clips.indexOf(c);
        const clips = [...pp.clips];
        clips.splice(i, 1, { ...c, out: mid }, { ...structuredClone(c), id: uid(), in: mid, transform: { ...c.transform, scale: c.transform.scale * 1.15 }, transition: { type: 'none', duration: 0.5 } });
        return { ...pp, clips };
      },
    });
  }

  // ---- 6. Clip order: strongest clip first ----
  if (placed.length >= 3) {
    const clipScores = placed.map((p) => {
      const ws = windows.filter((w) => w.p.clip.id === p.clip.id);
      return ws.length ? Math.max(...ws.map((w) => w.score.score)) : 0;
    });
    const bestIdx = clipScores.indexOf(Math.max(...clipScores));
    if (bestIdx > 0 && clipScores[bestIdx] > clipScores[0] + 0.15) {
      const id = placed[bestIdx].clip.id;
      out.push({
        key: `order:${id}`, type: 'order', basis: 'Rule-based scoring',
        title: `Start with clip ${bestIdx + 1}`,
        detail: `It scores highest for speech, motion and detail (${Math.round(clipScores[bestIdx] * 100)} vs ${Math.round(clipScores[0] * 100)} for your current first clip).`,
        at: placed[bestIdx].start,
        apply: (pp) => {
          const c = pp.clips.find((k) => k.id === id);
          if (!c) return pp;
          return { ...pp, clips: [c, ...pp.clips.filter((k) => k.id !== id)] };
        },
      });
    }
  }

  return out;
}
