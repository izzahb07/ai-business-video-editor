/** On-device visual analysis: tiny greyscale samples of each video for scene/motion/similarity scoring. */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset } from '../../types';
import { createVideoElement, destroyVideoElement, getFile, seekVideo } from '../registry';

export const SIDE = 24; // sample size (pixels per side)

export interface VideoAnalysis {
  /** Source times of the samples. */
  times: number[];
  /** Greyscale SIDE×SIDE samples (0..255). */
  frames: Uint8Array[];
  /** Mean absolute difference to the previous sample (0..1). */
  diff: number[];
  /** Brightness 0..1. */
  brightness: number[];
  /** Detail/sharpness (Laplacian energy, relative). */
  sharpness: number[];
}

const cache = new Map<string, Promise<VideoAnalysis | null>>();

export function analyzeVideo(asset: Asset, onProgress?: (p: number) => void): Promise<VideoAnalysis | null> {
  let p = cache.get(asset.id);
  if (!p) {
    p = run(asset, onProgress).catch((e) => { console.warn('video analysis failed', e); return null; });
    cache.set(asset.id, p);
  }
  return p;
}

async function run(asset: Asset, onProgress?: (p: number) => void): Promise<VideoAnalysis | null> {
  const file = getFile(asset.id);
  if (!file || asset.kind !== 'video') return null;
  const fps = asset.webCodecsDecodable ? 4 : 2;
  const n = Math.max(2, Math.min(asset.webCodecsDecodable ? 2400 : 300, Math.floor(asset.duration * fps)));
  const times = Array.from({ length: n }, (_, i) => Math.min(asset.duration - 0.02, (i + 0.5) * (asset.duration / n)));
  const c = document.createElement('canvas');
  c.width = c.height = SIDE;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const frames: Uint8Array[] = [];
  const grab = (img: CanvasImageSource) => {
    ctx.drawImage(img, 0, 0, SIDE, SIDE);
    const d = ctx.getImageData(0, 0, SIDE, SIDE).data;
    const g = new Uint8Array(SIDE * SIDE);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    frames.push(g);
    if (frames.length % 20 === 0) onProgress?.(frames.length / n);
  };
  if (asset.webCodecsDecodable) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) return null;
      const origin = await vt.getFirstTimestamp();
      const sink = new CanvasSink(vt, { width: 64, height: 64, fit: 'fill', poolSize: 2 });
      let last: CanvasImageSource | null = null;
      for await (const wc of sink.canvasesAtTimestamps(times.map((t) => t + origin))) {
        if (wc) last = wc.canvas;
        if (last) grab(last);
      }
    } finally {
      input.dispose();
    }
  } else {
    const url = URL.createObjectURL(file);
    const v = createVideoElement(url);
    try {
      for (const t of times) { await seekVideo(v, t); grab(v); }
    } finally {
      destroyVideoElement(v);
      URL.revokeObjectURL(url);
    }
  }
  const diff: number[] = [], brightness: number[] = [], sharpness: number[] = [];
  frames.forEach((f, i) => {
    let sum = 0, lap = 0, d = 0;
    for (let k = 0; k < f.length; k++) sum += f[k];
    for (let y = 1; y < SIDE - 1; y++) for (let x = 1; x < SIDE - 1; x++) {
      const k = y * SIDE + x;
      const L = 4 * f[k] - f[k - 1] - f[k + 1] - f[k - SIDE] - f[k + SIDE];
      lap += L * L;
    }
    if (i > 0) { const p = frames[i - 1]; for (let k = 0; k < f.length; k++) d += Math.abs(f[k] - p[k]); }
    diff.push(i > 0 ? d / f.length / 255 : 0);
    brightness.push(sum / f.length / 255);
    sharpness.push(Math.sqrt(lap / ((SIDE - 2) * (SIDE - 2))) / 255);
  });
  onProgress?.(1);
  return { times: times.slice(0, frames.length), frames, diff, brightness, sharpness };
}

/** Similarity 0..1 between two greyscale samples. */
export function similarity(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return 1 - d / a.length / 255;
}

/** Index of the sample nearest to source time t. */
export function sampleAt(v: VideoAnalysis, t: number): number {
  let best = 0;
  for (let i = 0; i < v.times.length; i++) if (Math.abs(v.times[i] - t) < Math.abs(v.times[best] - t)) best = i;
  return best;
}
