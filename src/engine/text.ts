/** Text layout and styled drawing, shared by text overlays and captions. */
import { nearestWeight } from '../lib/defaults';

export interface Word {
  text: string;
  /** Global word index (for highlighting). */
  index: number;
  highlight: boolean;
  width: number;
}
export interface Line {
  words: Word[];
  width: number;
}

export function fontString(family: string, weight: number, px: number): string {
  return `${nearestWeight(family, weight)} ${Math.max(1, Math.round(px))}px "${family}", system-ui, sans-serif`;
}

/** Split text into words; *word* marks a highlighted word. */
export function tokenize(text: string, uppercase: boolean): { text: string; highlight: boolean; newline: boolean }[] {
  const out: { text: string; highlight: boolean; newline: boolean }[] = [];
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    let inHl = false;
    for (const raw of line.split(/\s+/).filter(Boolean)) {
      let w = raw;
      let hl = inHl;
      if (w.startsWith('*')) { hl = true; inHl = true; w = w.slice(1); }
      if (w.endsWith('*')) { w = w.slice(0, -1); inHl = false; }
      if (!w) continue;
      out.push({ text: uppercase ? w.toUpperCase() : w, highlight: hl, newline: false });
    }
    if (li < lines.length - 1 && out.length) out[out.length - 1].newline = true;
  });
  return out;
}

export function layoutWords(
  ctx: CanvasRenderingContext2D,
  tokens: { text: string; highlight: boolean; newline?: boolean }[],
  maxWidth: number,
): Line[] {
  const space = ctx.measureText(' ').width;
  const lines: Line[] = [];
  let cur: Line = { words: [], width: 0 };
  tokens.forEach((t, i) => {
    const w = ctx.measureText(t.text).width;
    const add = cur.words.length ? space + w : w;
    if (cur.words.length && cur.width + add > maxWidth) {
      lines.push(cur);
      cur = { words: [], width: 0 };
    }
    cur.width += cur.words.length ? space + w : w;
    cur.words.push({ text: t.text, index: i, highlight: t.highlight, width: w });
    if (t.newline) {
      lines.push(cur);
      cur = { words: [], width: 0 };
    }
  });
  if (cur.words.length) lines.push(cur);
  return lines;
}

export interface DrawTextOpts {
  family: string;
  weight: number;
  px: number;
  align: 'left' | 'center' | 'right';
  color: string;
  bg?: { on: boolean; color: string; opacity: number; radius: number; padding: number };
  outline?: { on: boolean; color: string; width: number };
  shadow?: { on: boolean; color: string; blur: number };
  /** Scale factor for pixel sizes (outline width, radius, padding). */
  unit: number;
  lineHeight?: number;
  /** Per-word colour (by global index); default uses `color`. */
  wordColor?: (w: Word) => string;
  /** Per-word extra scale / y offset (for pop / bounce). */
  wordScale?: (w: Word) => number;
  wordDy?: (w: Word) => number;
  /** Number of characters to reveal (typewriter). */
  revealChars?: number;
  /** Only draw words with index in this set (word-by-word captions). */
  onlyWords?: Set<number>;
}

/** Draw laid-out lines centred vertically on (cx, cy). Returns the bounding box. */
export function drawLines(ctx: CanvasRenderingContext2D, lines: Line[], cx: number, cy: number, o: DrawTextOpts) {
  const lh = o.px * (o.lineHeight ?? 1.18);
  const totalH = lh * lines.length;
  const maxW = Math.max(0, ...lines.map((l) => l.width));
  const space = ctx.measureText(' ').width;
  const top = cy - totalH / 2;
  const boxX = o.align === 'center' ? cx - maxW / 2 : o.align === 'left' ? cx : cx - maxW;

  if (o.bg?.on) {
    const pad = o.bg.padding * o.unit;
    ctx.save();
    ctx.globalAlpha *= o.bg.opacity;
    ctx.fillStyle = o.bg.color;
    for (let i = 0; i < lines.length; i++) {
      const lw = lines[i].width;
      const lx = o.align === 'center' ? cx - lw / 2 : o.align === 'left' ? cx : cx - lw;
      roundRect(ctx, lx - pad, top + i * lh - pad * 0.45, lw + pad * 2, lh + pad * 0.9, o.bg.radius * o.unit);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  let charsLeft = o.revealChars ?? Infinity;

  // Two passes: outlines/shadow first, then fills, so outlines never cover neighbouring letters.
  for (const pass of ['stroke', 'fill'] as const) {
    let budget = charsLeft;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let x = o.align === 'center' ? cx - line.width / 2 : o.align === 'left' ? cx : cx - line.width;
      const y = top + i * lh + lh / 2;
      for (const w of line.words) {
        if (budget <= 0) break;
        const visible = o.onlyWords ? o.onlyWords.has(w.index) : true;
        let text = w.text;
        if (budget < text.length) text = text.slice(0, Math.max(0, Math.floor(budget)));
        budget -= w.text.length + 1;
        if (visible && text) {
          const s = o.wordScale?.(w) ?? 1;
          const dy = o.wordDy?.(w) ?? 0;
          ctx.save();
          ctx.translate(x + w.width / 2, y + dy);
          ctx.scale(s, s);
          if (pass === 'stroke') {
            if (o.shadow?.on && o.shadow.blur > 0) {
              ctx.shadowColor = o.shadow.color;
              ctx.shadowBlur = o.shadow.blur * o.unit;
              ctx.shadowOffsetY = 2 * o.unit;
            }
            if (o.outline?.on && o.outline.width > 0) {
              ctx.strokeStyle = o.outline.color;
              ctx.lineWidth = o.outline.width * o.unit;
              ctx.strokeText(text, -w.width / 2, 0);
            } else if (o.shadow?.on) {
              ctx.fillStyle = o.wordColor?.(w) ?? o.color;
              ctx.fillText(text, -w.width / 2, 0);
            }
          } else {
            ctx.fillStyle = o.wordColor?.(w) ?? o.color;
            ctx.fillText(text, -w.width / 2, 0);
          }
          ctx.restore();
        }
        x += w.width + space;
      }
    }
    if (pass === 'fill') charsLeft = budget;
  }
  return { x: boxX, y: top, w: maxW, h: totalH };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------- easing ----------
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = (x: number) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const backOut = (x: number) => { const t = clamp01(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const bounceOut = (x: number) => {
  let t = clamp01(x);
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
