import type {
  Asset, CaptionStyle, Captions, Clip, ClipTransform, Grade, Overlay, Project, TextStyle,
} from '../types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const defaultTransform = (): ClipTransform => ({
  cropX: 0, cropY: 0, cropW: 1, cropH: 1, rotation: 0, scale: 1, x: 0, y: 0, flipH: false,
});

export const defaultGrade = (): Grade => ({
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  saturation: 0, vibrance: 0, temperature: 0, tint: 0, fade: 0, vignette: 0, sharpness: 0,
  lutId: null, lutMix: 100,
});

export function isNeutralGrade(g: Grade): boolean {
  const d = defaultGrade();
  return (Object.keys(d) as (keyof Grade)[]).every((k) => k === 'lutMix' || g[k] === d[k]);
}

export const defaultTextStyle = (): TextStyle => ({
  font: 'Montserrat', weight: 800, size: 72, color: '#ffffff', highlightColor: '#ffd84d',
  align: 'center', uppercase: false,
  bg: { on: false, color: '#000000', opacity: 0.6, radius: 18, padding: 22 },
  outline: { on: true, color: '#000000', width: 6 },
  shadow: { on: true, color: '#000000', blur: 16 },
});

/** Professional caption looks. Selecting one copies its style into the project (fully editable after). */
export const CAPTION_TEMPLATES: { id: string; name: string; style: Omit<CaptionStyle, 'template' | 'y' | 'maxWords'> & { maxWords: number } }[] = [
  {
    id: 'bold-pop', name: 'Bold Pop',
    style: { font: 'Montserrat', weight: 900, size: 78, color: '#ffffff', activeColor: '#ffd84d', emphasisColor: '#ffd84d',
      align: 'center', uppercase: true, animation: 'pop', maxWords: 3,
      bg: { on: false, color: '#000000', opacity: 0.6, radius: 16, padding: 18 },
      outline: { on: true, color: '#000000', width: 9 }, shadow: { on: true, color: '#000000', blur: 18 } },
  },
  {
    id: 'karaoke', name: 'Karaoke',
    style: { font: 'Poppins', weight: 800, size: 66, color: '#ffffff', activeColor: '#a58bff', emphasisColor: '#ffd84d',
      align: 'center', uppercase: false, animation: 'karaoke', maxWords: 5,
      bg: { on: false, color: '#000000', opacity: 0.6, radius: 16, padding: 18 },
      outline: { on: true, color: '#000000', width: 7 }, shadow: { on: true, color: '#000000', blur: 12 } },
  },
  {
    id: 'boxed', name: 'Clean Box',
    style: { font: 'Inter', weight: 800, size: 54, color: '#ffffff', activeColor: '#ffffff', emphasisColor: '#ffd84d',
      align: 'center', uppercase: false, animation: 'fade', maxWords: 7,
      bg: { on: true, color: '#000000', opacity: 0.72, radius: 18, padding: 20 },
      outline: { on: false, color: '#000000', width: 4 }, shadow: { on: false, color: '#000000', blur: 0 } },
  },
  {
    id: 'impact', name: 'Impact Word',
    style: { font: 'Anton', weight: 400, size: 104, color: '#ffffff', activeColor: '#3cff8f', emphasisColor: '#3cff8f',
      align: 'center', uppercase: true, animation: 'word', maxWords: 1,
      bg: { on: false, color: '#000000', opacity: 0.6, radius: 16, padding: 18 },
      outline: { on: true, color: '#000000', width: 10 }, shadow: { on: true, color: '#000000', blur: 20 } },
  },
  {
    id: 'luxury', name: 'Minimal Luxury',
    style: { font: 'Playfair Display', weight: 600, size: 56, color: '#f6efe2', activeColor: '#e6c27a', emphasisColor: '#e6c27a',
      align: 'center', uppercase: false, animation: 'fade', maxWords: 6,
      bg: { on: false, color: '#000000', opacity: 0.5, radius: 12, padding: 16 },
      outline: { on: false, color: '#000000', width: 3 }, shadow: { on: true, color: '#000000', blur: 22 } },
  },
  {
    id: 'bounce', name: 'Bounce Highlight',
    style: { font: 'Poppins', weight: 800, size: 70, color: '#ffffff', activeColor: '#ff5ca8', emphasisColor: '#ffd84d',
      align: 'center', uppercase: true, animation: 'bounce', maxWords: 3,
      bg: { on: false, color: '#000000', opacity: 0.6, radius: 16, padding: 18 },
      outline: { on: true, color: '#000000', width: 8 }, shadow: { on: true, color: '#000000', blur: 14 } },
  },
  {
    id: 'typewriter', name: 'Typewriter',
    style: { font: 'Inter', weight: 800, size: 58, color: '#ffffff', activeColor: '#ffffff', emphasisColor: '#ffd84d',
      align: 'center', uppercase: false, animation: 'typewriter', maxWords: 8,
      bg: { on: true, color: '#111111', opacity: 0.8, radius: 10, padding: 18 },
      outline: { on: false, color: '#000000', width: 3 }, shadow: { on: false, color: '#000000', blur: 0 } },
  },
];

export function captionStyleFromTemplate(id: string, y = 0.72): CaptionStyle {
  const t = CAPTION_TEMPLATES.find((x) => x.id === id) ?? CAPTION_TEMPLATES[0];
  return { ...structuredClone(t.style), template: t.id, y };
}

export const defaultCaptions = (): Captions => ({
  enabled: true,
  segments: [],
  style: captionStyleFromTemplate('bold-pop'),
  language: 'auto',
});

export function newClip(a: Asset): Clip {
  return {
    id: uid(), assetId: a.id, in: 0, out: a.kind === 'image' ? 3 : a.duration, volume: 1, muted: false, fit: 'fill',
    transform: defaultTransform(), grade: defaultGrade(),
    transition: { type: 'none', duration: 0.5 }, voice: { enhance: false, denoise: false },
  };
}

export function newProject(): Project {
  return {
    id: uid(), name: 'My Video', clips: [], overlays: [], captions: defaultCaptions(),
    audio: { items: [], duckLevel: 0.25 }, luts: [],
    settings: { aspect: '9:16', background: 'blur' },
  };
}

/** Bring projects saved by older versions up to the current shape (keeps all existing work). */
export function normalizeProject(p: Partial<Project> & { clips?: Partial<Clip>[] }): Project {
  const base = newProject();
  const clips = (p.clips ?? []).map((c) => ({
    ...newClip({ id: c.assetId!, duration: (c.out ?? 0) } as Asset),
    ...c,
    transform: { ...defaultTransform(), ...(c.transform ?? {}) },
    grade: { ...defaultGrade(), ...(c.grade ?? {}) },
    transition: c.transition ?? { type: 'none', duration: 0.5 },
    voice: c.voice ?? { enhance: false, denoise: false },
  })) as Clip[];
  return {
    ...base,
    ...p,
    clips,
    overlays: (p.overlays ?? []) as Overlay[],
    captions: p.captions ? { ...defaultCaptions(), ...p.captions, style: { ...defaultCaptions().style, ...p.captions.style } } : base.captions,
    audio: p.audio ?? base.audio,
    luts: p.luts ?? [],
    settings: { ...base.settings, ...(p.settings ?? {}) },
  } as Project;
}

export function normalizeAsset(a: Partial<Asset>): Asset {
  return { kind: 'video', codec: null, hasAudio: false, webCodecsDecodable: false, thumb: '', stored: false, ...a } as Asset;
}

export const FONTS: { family: string; weights: number[]; label: string }[] = [
  { family: 'Montserrat', weights: [700, 900], label: 'Montserrat' },
  { family: 'Inter', weights: [500, 800], label: 'Inter' },
  { family: 'Poppins', weights: [600, 800], label: 'Poppins' },
  { family: 'Anton', weights: [400], label: 'Anton' },
  { family: 'Bebas Neue', weights: [400], label: 'Bebas Neue' },
  { family: 'Playfair Display', weights: [600, 800], label: 'Playfair' },
  { family: 'Permanent Marker', weights: [400], label: 'Marker' },
];

export function nearestWeight(family: string, w: number): number {
  const f = FONTS.find((x) => x.family === family);
  if (!f) return w;
  return f.weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
}
