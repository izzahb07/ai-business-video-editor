/** Editing helpers for graphics, including keyframe-aware transform edits. */
import type { Keyframe, Overlay } from '../types';
import { interpKeyframes } from '../engine/overlays';

export type TransformPatch = Partial<Pick<Keyframe, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>>;

/** Current transform values of an overlay at timeline time t (ignoring in/out animations). */
export function transformAt(o: Overlay, t: number) {
  return interpKeyframes(o, Math.max(0, Math.min(o.duration, t - o.start)));
}

/**
 * Apply a position/scale/rotation/opacity change. Without keyframes it changes the graphic;
 * with keyframes it edits (or creates) the keyframe at the playhead.
 */
export function editTransform(o: Overlay, patch: TransformPatch, t: number): Partial<Overlay> {
  if (!o.keyframes.length) return patch;
  const local = Math.max(0, Math.min(o.duration, t - o.start));
  const near = o.keyframes.findIndex((k) => Math.abs(k.t - local) < 0.05);
  const kfs = [...o.keyframes];
  if (near >= 0) kfs[near] = { ...kfs[near], ...patch };
  else kfs.push({ ...interpKeyframes(o, local), ...patch, t: local });
  kfs.sort((a, b) => a.t - b.t);
  return { keyframes: kfs };
}

/** Turn keyframing on: first keyframe at the start with the current values. */
export function enableKeyframes(o: Overlay, t: number): Partial<Overlay> {
  const first: Keyframe = { t: 0, x: o.x, y: o.y, scale: o.scale, rotation: o.rotation, opacity: o.opacity };
  const local = Math.max(0, Math.min(o.duration, t - o.start));
  const kfs = [first];
  if (local > 0.05) kfs.push({ ...first, t: local });
  return { keyframes: kfs };
}
