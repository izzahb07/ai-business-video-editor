/**
 * Draws one clip frame into a layer: crop → fit/fill → user scale/rotate/position → transition motion.
 * Used by BOTH preview and export (via engine/render.ts).
 */
import type { Clip, ClipTransform, FitMode, ProjectSettings } from '../types';

export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

let blurCanvas: HTMLCanvasElement | null = null;

export interface ClipMotion {
  /** Extra zoom multiplier (transitions). */
  zoom: number;
  /** Extra horizontal shift as fraction of width (transitions). */
  dx: number;
  /** Motion-blur ghosts for whip transitions (0 = none). */
  ghost: number;
}
export const NO_MOTION: ClipMotion = { zoom: 1, dx: 0, ghost: 0 };

export function drawClipLayer(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  src: FrameSource | null,
  clip: Pick<Clip, 'fit' | 'transform'>,
  settings: ProjectSettings,
  motion: ClipMotion = NO_MOTION,
) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!src || !src.width || !src.height) { ctx.restore(); return; }
  const tr = clip.transform;
  const sx = tr.cropX * src.width, sy = tr.cropY * src.height;
  const sw = Math.max(2, tr.cropW * src.width), sh = Math.max(2, tr.cropH * src.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (clip.fit === 'fit' && settings.background === 'blur') {
    drawBlurredBackground(ctx, W, H, src.image, sx, sy, sw, sh);
  }
  const draw = (dx: number, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    drawTransformed(ctx, W, H, src.image, sx, sy, sw, sh, clip.fit, tr, motion.zoom, motion.dx + dx);
    ctx.restore();
  };
  if (motion.ghost > 0) {
    for (let k = 3; k >= 1; k--) draw(-motion.ghost * k * 0.04, 0.22);
  }
  draw(0, 1);
  ctx.restore();
}

function drawTransformed(
  ctx: CanvasRenderingContext2D, W: number, H: number, img: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number, fit: FitMode, tr: ClipTransform, zoom: number, dxFrac: number,
) {
  const rot = ((tr.rotation % 360) + 360) % 360;
  const quarter = rot % 180 >= 45 && rot % 180 < 135;
  // Fit uses the rotated footprint so 90° rotations still fill/fit correctly.
  const fw = quarter ? sh : sw, fh = quarter ? sw : sh;
  const base = fit === 'fill' ? Math.max(W / fw, H / fh) : Math.min(W / fw, H / fh);
  const s = base * tr.scale * zoom;
  ctx.translate(W / 2 + (tr.x + dxFrac) * W, H / 2 + tr.y * H);
  ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.flipH ? -s : s, s);
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
}

/** Soft blur fill without ctx.filter (unsupported on older Safari): downscale then upscale. */
function drawBlurredBackground(
  ctx: CanvasRenderingContext2D, W: number, H: number, img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number,
) {
  const bw = Math.max(4, Math.round(W / 48));
  const bh = Math.max(4, Math.round(H / 48));
  if (!blurCanvas) blurCanvas = document.createElement('canvas');
  if (blurCanvas.width !== bw || blurCanvas.height !== bh) { blurCanvas.width = bw; blurCanvas.height = bh; }
  const b = blurCanvas.getContext('2d')!;
  const s = Math.max(bw / sw, bh / sh);
  b.imageSmoothingEnabled = true;
  b.drawImage(img, sx, sy, sw, sh, (bw - sw * s) / 2, (bh - sh * s) / 2, sw * s, sh * s);
  const pad = Math.max(W, H) * 0.04;
  ctx.drawImage(blurCanvas, -pad, -pad, W + pad * 2, H + pad * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);
}

/** Box-blur a canvas in place by downscaling (used for the "blur" transition). */
export function blurInPlace(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, amount: number) {
  if (amount <= 0.01) return;
  const f = 1 + amount * 24;
  const w = Math.max(2, Math.round(canvas.width / f)), h = Math.max(2, Math.round(canvas.height / f));
  if (!blurCanvas) blurCanvas = document.createElement('canvas');
  blurCanvas.width = w;
  blurCanvas.height = h;
  const b = blurCanvas.getContext('2d')!;
  b.imageSmoothingEnabled = true;
  b.drawImage(canvas, 0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(blurCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}
