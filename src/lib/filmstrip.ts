/** Timeline filmstrips (a sprite of frames across a clip) and waveforms. */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset } from '../types';
import { createVideoElement, destroyVideoElement, getFile, seekVideo } from './registry';

export interface Filmstrip { url: string; frames: number; step: number }
const cache = new Map<string, Promise<Filmstrip | null>>();
const TH = 64; // thumb height (px)

export function getFilmstrip(asset: Asset): Promise<Filmstrip | null> {
  let p = cache.get(asset.id);
  if (!p) {
    p = build(asset).catch((e) => { console.warn('filmstrip failed', e); return null; });
    cache.set(asset.id, p);
  }
  return p;
}

async function build(asset: Asset): Promise<Filmstrip | null> {
  const file = getFile(asset.id);
  if (!file || asset.kind === 'audio') return null;
  if (asset.kind === 'image') return { url: asset.thumb, frames: 1, step: 3600 };
  const frames = Math.max(1, Math.min(asset.webCodecsDecodable ? 40 : 10, Math.ceil(asset.duration / 1)));
  const step = asset.duration / frames;
  const tw = Math.max(16, Math.round((TH * asset.width) / Math.max(1, asset.height)));
  const sprite = document.createElement('canvas');
  sprite.width = tw * frames;
  sprite.height = TH;
  const sctx = sprite.getContext('2d')!;
  const times = Array.from({ length: frames }, (_, i) => Math.min(asset.duration - 0.05, i * step + step / 2));
  if (asset.webCodecsDecodable) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) return null;
      const origin = await vt.getFirstTimestamp();
      const sink = new CanvasSink(vt, { height: TH, fit: 'fill', width: tw });
      let i = 0;
      for await (const wc of sink.canvasesAtTimestamps(times.map((t) => t + origin))) {
        if (wc) sctx.drawImage(wc.canvas, i * tw, 0, tw, TH);
        i++;
      }
    } finally {
      input.dispose();
    }
  } else {
    const url = URL.createObjectURL(file);
    const v = createVideoElement(url);
    try {
      for (let i = 0; i < times.length; i++) {
        await seekVideo(v, times[i]);
        sctx.drawImage(v, i * tw, 0, tw, TH);
      }
    } finally {
      destroyVideoElement(v);
      URL.revokeObjectURL(url);
    }
  }
  const out = sprite.toDataURL('image/jpeg', 0.6);
  sprite.width = sprite.height = 0;
  return { url: out, frames, step };
}

/** Draw a waveform of `peaks` (one value per hop) between source times a..b into a canvas. */
export function drawWaveform(canvas: HTMLCanvasElement, peaks: Float32Array, hop: number, a: number, b: number, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  const i0 = Math.floor(a / hop), i1 = Math.max(i0 + 1, Math.ceil(b / hop));
  const per = (i1 - i0) / w;
  for (let x = 0; x < w; x++) {
    let pk = 0;
    const s = Math.floor(i0 + x * per), e = Math.max(s + 1, Math.floor(i0 + (x + 1) * per));
    for (let i = s; i < e && i < peaks.length; i++) if (peaks[i] > pk) pk = peaks[i];
    const bh = Math.max(1, Math.min(1, pk * 1.6) * h);
    ctx.fillRect(x, (h - bh) / 2, 1, bh);
  }
}
