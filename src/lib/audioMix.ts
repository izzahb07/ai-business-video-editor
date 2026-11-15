/** Mixes clip audio into the final soundtrack, in short segments to keep memory low. */
import type { Clip } from '../types';
import { layoutClips } from './timeline';
import { AUDIO_RATE } from './media';

/** Short fade at each cut so jump cuts don't click/pop. */
export const CUT_FADE = 0.006;

export async function renderAudioSegment(
  clips: Clip[],
  buffers: Map<string, AudioBuffer | null>,
  t0: number,
  t1: number,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((t1 - t0) * AUDIO_RATE));
  const ctx = new OfflineAudioContext(2, length, AUDIO_RATE);
  for (const p of layoutClips(clips)) {
    const { clip } = p;
    if (clip.muted || clip.volume <= 0) continue;
    if (p.end <= t0 || p.start >= t1) continue;
    const buf = buffers.get(clip.assetId);
    if (!buf) continue;

    const node = ctx.createBufferSource();
    node.buffer = buf;
    const gain = ctx.createGain();
    node.connect(gain).connect(ctx.destination);

    // Where the clip starts relative to this segment (may be negative = started earlier).
    const rel = p.start - t0;
    const when = Math.max(0, rel);
    const offset = clip.in + Math.max(0, -rel);
    const dur = Math.min(p.end, t1) - Math.max(p.start, t0);
    if (dur <= 0 || offset >= buf.duration) continue;

    // Gain envelope with tiny fades at the clip's own edges only.
    const g = gain.gain;
    const v = clip.volume;
    const clipLen = p.end - p.start;
    const fade = Math.min(CUT_FADE, clipLen / 4);
    const gainAt = (tl: number) => {
      // tl = time since clip start
      if (tl < fade) return v * (tl / fade);
      if (tl > clipLen - fade) return v * Math.max(0, (clipLen - tl) / fade);
      return v;
    };
    const localStart = Math.max(0, -rel);
    g.setValueAtTime(gainAt(localStart), when);
    if (localStart < fade) g.linearRampToValueAtTime(v, when + (fade - localStart));
    const fadeOutStartLocal = clipLen - fade;
    const segEndLocal = localStart + dur;
    if (segEndLocal > fadeOutStartLocal) {
      const fs = Math.max(localStart, fadeOutStartLocal);
      g.setValueAtTime(gainAt(fs), when + (fs - localStart));
      g.linearRampToValueAtTime(gainAt(segEndLocal), when + dur);
    }

    node.start(when, offset, dur);
  }
  return ctx.startRendering();
}
