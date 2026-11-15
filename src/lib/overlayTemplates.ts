/** Ready-made, fully editable graphics. */
import type { Overlay, ShapeType, TextStyle } from '../types';
import { defaultTextStyle, uid } from './defaults';
import type { Asset } from '../types';

function base(kind: Overlay['kind'], name: string, start: number, duration: number): Overlay {
  return {
    id: uid(), kind, name, start, duration, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, keyframes: [],
    animIn: { type: 'pop', duration: 0.35 }, animOut: { type: 'fade', duration: 0.25 }, loop: 'none',
  };
}

const style = (p: Partial<TextStyle>): TextStyle => ({ ...defaultTextStyle(), ...p });

export type TextPreset = 'text' | 'title' | 'lower-third' | 'hook' | 'cta' | 'label';

export function textOverlay(kind: TextPreset, t: number): Overlay {
  switch (kind) {
    case 'title':
      return { ...base('text', 'Title', t, 3), text: 'YOUR *BIG* TITLE', y: 0.4,
        style: style({ font: 'Bebas Neue', weight: 400, size: 150, highlightColor: '#a58bff' }), animIn: { type: 'zoom', duration: 0.4 } };
    case 'lower-third':
      return { ...base('text', 'Lower third', t, 4), text: 'Your Name\nYour role · Your business', x: 0.32, y: 0.8,
        style: style({ font: 'Inter', weight: 800, size: 48, align: 'left', outline: { on: false, color: '#000', width: 4 }, shadow: { on: false, color: '#000', blur: 0 },
          bg: { on: true, color: '#7c5cff', opacity: 0.92, radius: 14, padding: 22 } }),
        animIn: { type: 'slide-right', duration: 0.45 }, animOut: { type: 'slide-right', duration: 0.35 } };
    case 'hook':
      return { ...base('text', 'Hook', 0, 3), text: 'Stop wasting *money* on this', y: 0.3,
        style: style({ font: 'Montserrat', weight: 900, size: 92, uppercase: true, outline: { on: true, color: '#000', width: 10 } }),
        animIn: { type: 'pop', duration: 0.3 }, loop: 'pulse' };
    case 'cta':
      return { ...base('text', 'Call to action', t, 3), text: 'Book now 👉', y: 0.82,
        style: style({ font: 'Poppins', weight: 800, size: 58, color: '#111111', outline: { on: false, color: '#000', width: 4 }, shadow: { on: false, color: '#000', blur: 0 },
          bg: { on: true, color: '#ffd84d', opacity: 1, radius: 40, padding: 26 } }),
        animIn: { type: 'bounce', duration: 0.6 }, loop: 'pulse' };
    case 'label':
      return { ...base('text', 'Label', t, 3), text: 'NEW', x: 0.75, y: 0.15, rotation: -6,
        style: style({ font: 'Anton', weight: 400, size: 64, color: '#ffffff', outline: { on: false, color: '#000', width: 4 },
          bg: { on: true, color: '#ef4444', opacity: 1, radius: 10, padding: 16 } }) };
    default:
      return { ...base('text', 'Text', t, 3), text: 'Your text here', y: 0.5, style: style({}) };
  }
}

export function shapeOverlay(shape: ShapeType, t: number): Overlay {
  const o = { ...base('shape', shape[0].toUpperCase() + shape.slice(1), t, 3), shape, color: '#ffd84d', strokeWidth: 10,
    animIn: { type: 'draw' as const, duration: 0.6 }, animOut: { type: 'fade' as const, duration: 0.25 } };
  switch (shape) {
    case 'arrow': return { ...o, w: 0.35, h: 0.06, rotation: 20 };
    case 'circle': return { ...o, w: 0.4, h: 0.22, color: '#ef4444' };
    case 'rect': return { ...o, name: 'Highlight box', w: 0.6, h: 0.14, fill: true };
    case 'underline': return { ...o, w: 0.5, h: 0.05, y: 0.6 };
    case 'callout': return { ...o, w: 0.3, h: 0.12, label: 'Look here', color: '#ffffff', x: 0.4, y: 0.45 };
  }
}

export const STICKERS = ['🔥', '✅', '⭐', '👉', '💯', '❤️', '😍', '🎉', '💡', '⚡', '📍', '🛒', '✨', '👀', '💰', '🧼', '🧽', '🏆', '📈', '⏰'];

export function stickerOverlay(emoji: string, t: number): Overlay {
  return { ...base('sticker', `Sticker ${emoji}`, t, 3), sticker: emoji, x: 0.78, y: 0.25, loop: 'wiggle', animIn: { type: 'pop', duration: 0.35 } };
}

export function imageOverlay(asset: Asset, t: number, duration: number): Overlay {
  return { ...base('image', asset.name.replace(/\.[^.]+$/, '') || 'Logo', t, duration), assetId: asset.id, w: 0.22, x: 0.84, y: 0.08,
    radius: 0, animIn: { type: 'fade', duration: 0.4 }, border: { on: false, color: '#ffffff', width: 4 } };
}

export function pipOverlay(asset: Asset, t: number): Overlay {
  return { ...base('video', `PiP: ${asset.name}`, t, Math.min(5, asset.duration)), assetId: asset.id, in: 0, w: 0.42, x: 0.72, y: 0.28,
    radius: 24, muted: true, volume: 1, animIn: { type: 'zoom', duration: 0.35 }, border: { on: true, color: '#ffffff', width: 6 } };
}

/** Intro / outro title cards: full-frame colour panel + text. */
export function introCard(t: number, duration = 2.5): Overlay[] {
  const panel = { on: true, color: '#0b0b0f', opacity: 0.85 };
  return [
    { ...textOverlay('title', t), name: 'Intro title', duration, panel, text: 'YOUR *BRAND*', y: 0.45 },
    { ...textOverlay('text', t + 0.3), name: 'Intro subtitle', duration: duration - 0.3, text: 'Your tagline here', y: 0.56,
      style: style({ font: 'Inter', weight: 500, size: 46, outline: { on: false, color: '#000', width: 3 } }), animIn: { type: 'slide-up', duration: 0.5 } },
  ];
}

export function outroCard(t: number, duration = 3): Overlay[] {
  return [
    { ...textOverlay('title', t), name: 'Outro title', duration, panel: { on: true, color: '#7c5cff', opacity: 0.9 }, text: 'THANK YOU', y: 0.42, animIn: { type: 'fade', duration: 0.4 } },
    { ...textOverlay('cta', t + 0.4), name: 'Outro CTA', duration: duration - 0.4, y: 0.56 },
  ];
}
