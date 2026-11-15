/**
 * Draws one video frame into the output canvas. Used by BOTH the preview and the export,
 * so what you see is what you get.
 */
import type { FitMode, ProjectSettings } from '../types';

let blurCanvas: HTMLCanvasElement | null = null;

export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  src: FrameSource | null,
  fit: FitMode,
  settings: ProjectSettings,
) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!src || src.width === 0 || src.height === 0) {
    ctx.restore();
    return;
  }
  const { image, width: sw, height: sh } = src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (fit === 'fill') {
    const s = Math.max(W / sw, H / sh);
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    if (settings.background === 'blur') drawBlurredBackground(ctx, W, H, image, sw, sh);
    const s = Math.min(W / sw, H / sh);
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  ctx.restore();
}

/**
 * Soft blurred fill behind "fit" clips. Works without ctx.filter (unsupported in older Safari):
 * shrink the frame to a tiny canvas, then scale it back up with smoothing, which blurs it.
 */
function drawBlurredBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  image: CanvasImageSource,
  sw: number,
  sh: number,
) {
  const bw = Math.max(4, Math.round(W / 48));
  const bh = Math.max(4, Math.round(H / 48));
  if (!blurCanvas) blurCanvas = document.createElement('canvas');
  if (blurCanvas.width !== bw || blurCanvas.height !== bh) {
    blurCanvas.width = bw;
    blurCanvas.height = bh;
  }
  const b = blurCanvas.getContext('2d')!;
  const s = Math.max(bw / sw, bh / sh);
  b.imageSmoothingEnabled = true;
  b.drawImage(image, (bw - sw * s) / 2, (bh - sh * s) / 2, sw * s, sh * s);
  // Scale up slightly beyond the edges so soft borders are hidden.
  const pad = Math.max(W, H) * 0.04;
  ctx.drawImage(blurCanvas, -pad, -pad, W + pad * 2, H + pad * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);
}
