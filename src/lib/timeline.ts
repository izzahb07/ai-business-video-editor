import type { AspectRatio, Clip, ExportQuality, ExportResolution } from '../types';

export interface PlacedClip {
  clip: Clip;
  index: number;
  /** Timeline start/end in seconds. */
  start: number;
  end: number;
}

export function clipDuration(c: Clip): number {
  return Math.max(0, c.out - c.in);
}

export function layoutClips(clips: Clip[]): PlacedClip[] {
  let t = 0;
  return clips.map((clip, index) => {
    const start = t;
    t += clipDuration(clip);
    return { clip, index, start, end: t };
  });
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((s, c) => s + clipDuration(c), 0);
}

/**
 * Find which clip is visible at timeline time `t` and the matching time inside the source file.
 * Times exactly on a boundary belong to the next clip. Times at/after the end map to the last frame.
 */
export function locate(placed: PlacedClip[], t: number): { placed: PlacedClip; sourceTime: number } | null {
  if (placed.length === 0) return null;
  for (const p of placed) {
    if (t < p.end) {
      const local = Math.max(0, t - p.start);
      return { placed: p, sourceTime: p.clip.in + local };
    }
  }
  const last = placed[placed.length - 1];
  return { placed: last, sourceTime: Math.max(last.clip.in, last.clip.out - 1 / 60) };
}

/** Output pixel size for an aspect ratio; short side = resolution. Always even numbers (H.264 requirement). */
export function outputSize(aspect: AspectRatio, resolution: ExportResolution): { width: number; height: number } {
  const even = (n: number) => Math.round(n / 2) * 2;
  const r = resolution;
  switch (aspect) {
    case '9:16': return { width: r, height: even((r * 16) / 9) };
    case '16:9': return { width: even((r * 16) / 9), height: r };
    case '1:1': return { width: r, height: r };
    case '4:5': return { width: r, height: even((r * 5) / 4) };
  }
}

export function aspectValue(aspect: AspectRatio): number {
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}

/** Video bitrate in bits/second. Reference: 1080x1920 @30fps. */
export function videoBitrate(width: number, height: number, fps: number, quality: ExportQuality): number {
  const base = { high: 12_000_000, medium: 8_000_000, low: 4_000_000 }[quality];
  const pixelFactor = (width * height) / (1080 * 1920);
  const fpsFactor = Math.pow(fps / 30, 0.75);
  return Math.round(base * pixelFactor * fpsFactor);
}

export function estimateFileSize(durationSec: number, vBitrate: number, audioBitrate: number): number {
  return Math.round(((vBitrate + audioBitrate) * durationSec) / 8);
}
