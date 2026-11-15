/** Motion graphics: animated text, shapes, stickers, logos and picture-in-picture. */
import type { AnimType, Keyframe, Overlay } from '../types';
import type { FrameSource } from '../lib/compositor';
import { backOut, bounceOut, clamp01, drawLines, easeInOut, easeOutCubic, fontString, layoutWords, roundRect, tokenize } from './text';

export interface OverlayState {
  x: number; y: number; scale: number; rotation: number; opacity: number;
  /** 0..1 reveal for typewriter / draw-on. */
  reveal: number;
  local: number;
}

export function isOverlayActive(o: Overlay, t: number) {
  return t >= o.start && t < o.start + o.duration;
}

export function interpKeyframes(o: Overlay, local: number): Omit<Keyframe, 't'> {
  const base = { x: o.x, y: o.y, scale: o.scale, rotation: o.rotation, opacity: o.opacity };
  const kf = [...o.keyframes].sort((a, b) => a.t - b.t);
  if (kf.length === 0) return base;
  const strip = ({ x, y, scale, rotation, opacity }: Keyframe) => ({ x, y, scale, rotation, opacity });
  if (local <= kf[0].t) return strip(kf[0]);
  if (local >= kf[kf.length - 1].t) return strip(kf[kf.length - 1]);
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i], b = kf[i + 1];
    if (local >= a.t && local <= b.t) {
      const e = easeInOut((local - a.t) / Math.max(1e-6, b.t - a.t));
      const L = (p: number, q: number) => p + (q - p) * e;
      return { x: L(a.x, b.x), y: L(a.y, b.y), scale: L(a.scale, b.scale), rotation: L(a.rotation, b.rotation), opacity: L(a.opacity, b.opacity) };
    }
  }
  return base;
}

function applyAnim(s: OverlayState, type: AnimType, p: number) {
  // p: 0 = fully hidden, 1 = fully shown
  const e = easeOutCubic(p);
  switch (type) {
    case 'fade': s.opacity *= e; break;
    case 'slide-up': s.y += (1 - e) * 0.08; s.opacity *= clamp01(p * 2); break;
    case 'slide-down': s.y -= (1 - e) * 0.08; s.opacity *= clamp01(p * 2); break;
    case 'slide-left': s.x += (1 - e) * 0.25; s.opacity *= clamp01(p * 2); break;
    case 'slide-right': s.x -= (1 - e) * 0.25; s.opacity *= clamp01(p * 2); break;
    case 'zoom': s.scale *= 0.5 + 0.5 * e; s.opacity *= e; break;
    case 'pop': s.scale *= Math.max(0, backOut(p)); s.opacity *= clamp01(p * 3); break;
    case 'bounce': s.y -= (1 - bounceOut(p)) * 0.12; s.opacity *= clamp01(p * 4); break;
    case 'typewriter': case 'draw': s.reveal = Math.min(s.reveal, p); break;
    default: break;
  }
}

export function overlayState(o: Overlay, t: number): OverlayState | null {
  if (!isOverlayActive(o, t)) return null;
  const local = t - o.start;
  const k = interpKeyframes(o, local);
  const s: OverlayState = { ...k, reveal: 1, local };
  const inD = Math.min(o.animIn.duration, o.duration / 2);
  const outD = Math.min(o.animOut.duration, o.duration / 2);
  if (o.animIn.type !== 'none' && inD > 0 && local < inD) applyAnim(s, o.animIn.type, local / inD);
  const rem = o.duration - local;
  if (o.animOut.type !== 'none' && outD > 0 && rem < outD) {
    // Typewriter/draw out = un-type; everything else plays the in-animation backwards.
    applyAnim(s, o.animOut.type, rem / outD);
  }
  const w = 2 * Math.PI * local;
  switch (o.loop) {
    case 'pulse': s.scale *= 1 + 0.06 * Math.sin(w * 1.2); break;
    case 'float': s.y += 0.008 * Math.sin(w * 0.6); break;
    case 'wiggle': s.rotation += 6 * Math.sin(w * 1.5); break;
    case 'spin': s.rotation += local * 120; break;
  }
  return s;
}

export interface OverlayAssets {
  /** Decoded frame for video (PiP) overlays, keyed by overlay id. */
  videos: Map<string, FrameSource>;
  /** Decoded images keyed by asset id. */
  images: Map<string, ImageBitmap | HTMLImageElement | HTMLCanvasElement>;
}

/** Draw one overlay. Returns its on-screen bounding box (for selection handles), or null. */
export function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, o: Overlay, t: number, assets: OverlayAssets) {
  const s = overlayState(o, t);
  if (!s || s.opacity <= 0.001) return null;
  const unit = W / 1080;

  if (o.panel?.on) {
    ctx.save();
    ctx.globalAlpha = o.panel.opacity * clamp01(s.opacity);
    ctx.fillStyle = o.panel.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = clamp01(s.opacity);
  ctx.translate(s.x * W, s.y * H);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.scale(s.scale, s.scale);
  let box: { w: number; h: number } | null = null;

  switch (o.kind) {
    case 'text': {
      const st = o.style!;
      const px = st.size * unit;
      ctx.font = fontString(st.font, st.weight, px);
      const tokens = tokenize(o.text ?? '', st.uppercase);
      const lines = layoutWords(ctx, tokens, W * 0.86 / Math.max(0.2, s.scale));
      const totalChars = tokens.reduce((n, tk) => n + tk.text.length + 1, 0);
      const r = drawLines(ctx, lines, st.align === 'center' ? 0 : st.align === 'left' ? -W * 0.43 : W * 0.43, 0, {
        family: st.font, weight: st.weight, px, align: st.align, color: st.color, bg: st.bg, outline: st.outline, shadow: st.shadow,
        unit, wordColor: (w) => (w.highlight ? st.highlightColor : st.color),
        revealChars: s.reveal < 1 ? s.reveal * totalChars : undefined,
      });
      box = { w: r.w + 40 * unit, h: r.h + 30 * unit };
      break;
    }
    case 'shape': box = drawShape(ctx, W, H, o, s.reveal, unit); break;
    case 'sticker': {
      const px = 150 * unit;
      ctx.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.sticker ?? '⭐', 0, px * 0.06);
      box = { w: px * 1.2, h: px * 1.2 };
      break;
    }
    case 'image':
    case 'video': {
      const src = o.kind === 'image'
        ? (() => { const im = o.assetId ? assets.images.get(o.assetId) : undefined; return im ? { image: im, width: im.width, height: im.height } : null; })()
        : assets.videos.get(o.id) ?? null;
      const w = (o.w ?? 0.4) * W;
      const ar = src && src.width ? src.height / src.width : 9 / 16;
      const h = w * ar;
      const r = (o.radius ?? 0) * unit;
      if (o.kind === 'video') {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 24 * unit;
        ctx.fillStyle = '#000';
        roundRect(ctx, -w / 2, -h / 2, w, h, r);
        ctx.fill();
        ctx.restore();
      }
      if (src) {
        ctx.save();
        roundRect(ctx, -w / 2, -h / 2, w, h, r);
        ctx.clip();
        ctx.drawImage(src.image, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      if (o.border?.on) {
        ctx.strokeStyle = o.border.color;
        ctx.lineWidth = o.border.width * unit;
        roundRect(ctx, -w / 2, -h / 2, w, h, r);
        ctx.stroke();
      }
      box = { w, h };
      break;
    }
  }
  ctx.restore();
  if (!box) return null;
  const bw = box.w * s.scale, bh = box.h * s.scale;
  return { x: s.x * W - bw / 2, y: s.y * H - bh / 2, w: bw, h: bh };
}

function drawShape(ctx: CanvasRenderingContext2D, W: number, H: number, o: Overlay, reveal: number, unit: number) {
  const w = (o.w ?? 0.3) * W;
  const h = (o.h ?? 0.15) * H;
  const lw = (o.strokeWidth ?? 10) * unit;
  const color = o.color ?? '#ffd84d';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 10 * unit;
  const p = clamp01(reveal);

  switch (o.shape) {
    case 'arrow': {
      // Arrow from left to right across the box, drawn on progressively.
      const x0 = -w / 2, x1 = -w / 2 + w * p;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x1, 0);
      ctx.stroke();
      if (p > 0.85) {
        const head = Math.min(w * 0.22, 60 * unit) * ((p - 0.85) / 0.15);
        ctx.beginPath();
        ctx.moveTo(x1 + lw * 0.3, 0);
        ctx.lineTo(x1 - head, -head * 0.7);
        ctx.lineTo(x1 - head, head * 0.7);
        ctx.closePath();
        ctx.fill();
      }
      return { w: w + 40 * unit, h: Math.max(h, 80 * unit) };
    }
    case 'circle': {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      if (o.fill) { ctx.globalAlpha *= 0.35; ctx.fill(); ctx.globalAlpha /= 0.35; }
      ctx.stroke();
      return { w: w + lw, h: h + lw };
    }
    case 'rect': {
      if (o.fill) {
        ctx.save();
        ctx.globalAlpha *= 0.35 * p;
        roundRect(ctx, -w / 2, -h / 2, w, h, 16 * unit);
        ctx.fill();
        ctx.restore();
      }
      // Draw-on: reveal the perimeter.
      const per = 2 * (w + h);
      ctx.setLineDash([per * p, per]);
      roundRect(ctx, -w / 2, -h / 2, w, h, 16 * unit);
      ctx.stroke();
      ctx.setLineDash([]);
      return { w: w + lw, h: h + lw };
    }
    case 'underline': {
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.quadraticCurveTo(0, h * 0.25, -w / 2 + w * p, 0);
      ctx.stroke();
      return { w, h: Math.max(lw * 3, 60 * unit) };
    }
    case 'callout': {
      // Dot, leader line, and a label box.
      const label = o.label ?? 'Label';
      const px = 46 * unit;
      ctx.font = fontString('Montserrat', 800, px);
      const tw = ctx.measureText(label).width;
      const bx = -w / 2, by = -h / 2;
      ctx.beginPath();
      ctx.arc(bx, h / 2, 12 * unit, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx, h / 2);
      ctx.lineTo(bx + (w * 0.4) * p, by + 30 * unit);
      ctx.stroke();
      if (p > 0.5) {
        const a = (p - 0.5) / 0.5;
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.shadowBlur = 0;
        const pad = 22 * unit;
        roundRect(ctx, bx + w * 0.4, by, tw + pad * 2, px + pad * 1.4, 14 * unit);
        ctx.fill();
        ctx.fillStyle = pickTextColor(color);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(label, bx + w * 0.4 + pad, by + (px + pad * 1.4) / 2);
        ctx.restore();
      }
      return { w: w + tw, h: h + px };
    }
    default:
      return null;
  }
}

function pickTextColor(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg);
  if (!m) return '#000';
  const n = parseInt(m[1], 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#000000' : '#ffffff';
}
