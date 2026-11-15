/**
 * Captions: resolves caption segments onto the current edit and draws them.
 * Segments anchored to a source video follow trims/splits/silence-removal automatically.
 */
import type { CaptionSegment, CaptionStyle, Clip, Project, WordTiming } from '../types';
import { layoutClips } from '../lib/timeline';
import { backOut, clamp01, drawLines, fontString, layoutWords } from './text';

export interface CaptionWord { text: string; start: number; end: number; emph: boolean }
export interface CaptionCard { segmentId: string; start: number; end: number; words: CaptionWord[] }

/** Spread words evenly across a time range when no word timings exist. */
export function evenWords(text: string, start: number, end: number): WordTiming[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  let t = start;
  return parts.map((p) => {
    const d = ((end - start) * (p.length + 1)) / total;
    const w = { text: p, start: t, end: t + d };
    t += d;
    return w;
  });
}

/** Words of a segment, keeping the user's edited text when it no longer matches the timings. */
export function segmentWords(seg: CaptionSegment): WordTiming[] {
  const textWords = seg.text.split(/\s+/).filter(Boolean);
  if (seg.words.length && seg.words.length === textWords.length) {
    return seg.words.map((w, i) => ({ ...w, text: textWords[i] }));
  }
  return evenWords(seg.text, seg.start, seg.end);
}

function mapSegment(seg: CaptionSegment, clips: Clip[]): { start: number; end: number; words: CaptionWord[] }[] {
  const words = segmentWords(seg);
  const emph = new Set(seg.emphasis);
  if (!seg.anchorAssetId) {
    return [{ start: seg.start, end: seg.end, words: words.map((w, i) => ({ ...w, emph: emph.has(i) })) }];
  }
  const out: { start: number; end: number; words: CaptionWord[] }[] = [];
  for (const p of layoutClips(clips)) {
    const c = p.clip;
    if (c.assetId !== seg.anchorAssetId) continue;
    const s = Math.max(seg.start, c.in), e = Math.min(seg.end, c.out);
    if (e - s <= 0.05) continue;
    const toTl = (x: number) => p.start + (x - c.in);
    const ws = words
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => { const mid = (w.start + w.end) / 2; return mid >= c.in && mid < c.out; })
      .map(({ w, i }) => ({ text: w.text, start: toTl(Math.max(w.start, c.in)), end: toTl(Math.min(w.end, c.out)), emph: emph.has(i) }));
    if (ws.length) out.push({ start: toTl(s), end: toTl(e), words: ws });
  }
  return out;
}

let cacheKey: [unknown, unknown, number] | null = null;
let cacheVal: CaptionCard[] = [];

export function resolveCaptions(project: Project): CaptionCard[] {
  const { captions, clips } = project;
  const maxWords = Math.max(1, captions.style.maxWords);
  if (cacheKey && cacheKey[0] === captions && cacheKey[1] === clips && cacheKey[2] === maxWords) return cacheVal;
  const cards: CaptionCard[] = [];
  for (const seg of captions.segments) {
    for (const m of mapSegment(seg, clips)) {
      // Break into short, readable cards.
      for (let i = 0; i < m.words.length; i += maxWords) {
        const ws = m.words.slice(i, i + maxWords);
        const next = m.words[i + maxWords];
        const start = i === 0 ? Math.min(m.start, ws[0].start) : ws[0].start;
        const end = next ? next.start : Math.max(m.end, ws[ws.length - 1].end);
        if (end > start) cards.push({ segmentId: seg.id, start, end, words: ws });
      }
    }
  }
  cards.sort((a, b) => a.start - b.start);
  // Avoid overlaps: a card ends when the next begins.
  for (let i = 0; i < cards.length - 1; i++) cards[i].end = Math.min(cards[i].end, cards[i + 1].start);
  cacheKey = [captions, clips, maxWords];
  cacheVal = cards.filter((c) => c.end > c.start);
  return cacheVal;
}

export function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, project: Project, t: number) {
  if (!project.captions.enabled) return null;
  const cards = resolveCaptions(project);
  const card = cards.find((c) => t >= c.start && t < c.end);
  if (!card) return null;
  return drawCaptionCard(ctx, W, H, card, project.captions.style, t);
}

export function drawCaptionCard(ctx: CanvasRenderingContext2D, W: number, H: number, card: CaptionCard, st: CaptionStyle, t: number) {
  const unit = W / 1080;
  const px = st.size * unit;
  ctx.save();
  ctx.font = fontString(st.font, st.weight, px);
  const tokens = card.words.map((w) => ({ text: st.uppercase ? w.text.toUpperCase() : w.text, highlight: w.emph }));
  const lines = layoutWords(ctx, tokens, W * 0.84);
  const local = t - card.start;
  const activeIdx = (() => {
    let idx = -1;
    card.words.forEach((w, i) => { if (t >= w.start) idx = i; });
    return idx;
  })();
  let alpha = 1, cardScale = 1;
  let only: Set<number> | undefined;
  let reveal: number | undefined;
  const wordColor = (i: number) => {
    const isActive = i === activeIdx;
    if ((st.animation === 'karaoke') && i <= activeIdx) return st.activeColor;
    if ((st.animation === 'pop' || st.animation === 'bounce' || st.animation === 'word') && isActive) return st.activeColor;
    if (card.words[i]?.emph) return st.emphasisColor;
    return st.color;
  };
  let wordScale: ((i: number) => number) | undefined;
  let wordDy: ((i: number) => number) | undefined;
  switch (st.animation) {
    case 'fade':
      alpha = clamp01(local / 0.15) * clamp01((card.end - t) / 0.12);
      break;
    case 'pop':
      cardScale = 0.75 + 0.25 * backOut(local / 0.18);
      break;
    case 'word': {
      only = new Set([Math.max(0, activeIdx)]);
      const w = card.words[Math.max(0, activeIdx)];
      wordScale = () => 0.7 + 0.3 * backOut((t - w.start) / 0.15);
      break;
    }
    case 'bounce':
      wordScale = (i) => (i === activeIdx ? 1 + 0.12 * backOut((t - card.words[i].start) / 0.2) : 1);
      wordDy = (i) => (i === activeIdx ? -10 * unit * Math.sin(Math.PI * clamp01((t - card.words[i].start) / 0.25)) : 0);
      break;
    case 'typewriter': {
      const visible = card.words.filter((w) => t >= w.start);
      reveal = visible.reduce((n, w) => n + w.text.length + 1, 0);
      if (visible.length) {
        const cur = visible[visible.length - 1];
        const frac = clamp01((t - cur.start) / Math.max(0.05, cur.end - cur.start));
        reveal -= (cur.text.length + 1) * (1 - frac);
      }
      break;
    }
  }
  const cx = st.align === 'center' ? W / 2 : st.align === 'left' ? W * 0.08 : W * 0.92;
  const cy = st.y * H;
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(cardScale, cardScale);
  const box = drawLines(ctx, lines, 0, 0, {
    family: st.font, weight: st.weight, px, align: st.align, color: st.color, bg: st.bg, outline: st.outline, shadow: st.shadow, unit,
    wordColor: (w) => wordColor(w.index),
    wordScale: wordScale ? (w) => wordScale!(w.index) : undefined,
    wordDy: wordDy ? (w) => wordDy!(w.index) : undefined,
    onlyWords: only,
    revealChars: reveal,
  });
  ctx.restore();
  return { x: cx + box.x * cardScale, y: cy + box.y * cardScale, w: box.w * cardScale, h: box.h * cardScale };
}

// ---------- SRT ----------
function srtTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** SRT for the CURRENT edit (timeline times), one entry per caption card. */
export function toSrt(project: Project): string {
  const cards = resolveCaptions(project);
  return cards
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.words.map((w) => w.text).join(' ')}\n`)
    .join('\n');
}
