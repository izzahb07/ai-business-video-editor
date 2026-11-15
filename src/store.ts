import { create } from 'zustand';
import type { Asset, AudioItem, CaptionSegment, Captions, Clip, Overlay, Project, ProjectSettings } from './types';
import { newClip, newProject, uid } from './lib/defaults';
import { layoutClips, locate } from './lib/timeline';

export { newProject, uid };

const HISTORY_LIMIT = 100;
/** Shortest clip piece allowed when trimming/splitting (seconds). */
export const MIN_CLIP = 0.1;

export type Selection =
  | { type: 'clip'; id: string }
  | { type: 'overlay'; id: string }
  | { type: 'caption'; id: string }
  | { type: 'audio'; id: string }
  | null;

interface EditorState {
  project: Project;
  assets: Record<string, Asset>;
  past: Project[];
  future: Project[];
  selection: Selection;
  /** Kept for Phase 1 components: id of the selected clip, if a clip is selected. */
  selectedClipId: string | null;
  loading: boolean;

  update: (fn: (p: Project) => Project, opts?: { history?: boolean }) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;

  addAsset: (a: Asset) => void;
  patchAsset: (id: string, patch: Partial<Asset>) => void;
  select: (clipId: string | null) => void;
  setSelection: (s: Selection) => void;

  // Clips
  appendClipForAsset: (a: Asset) => void;
  moveClip: (clipId: string, delta: number) => void;
  reorderClip: (clipId: string, toIndex: number) => void;
  removeClip: (clipId: string) => void;
  duplicateClip: (clipId: string) => void;
  patchClip: (clipId: string, patch: Partial<Clip>, opts?: { history?: boolean }) => void;
  /** Split the clip under timeline time t. Returns false if t is too close to an edge. */
  splitAt: (t: number) => boolean;
  /** Set in/out of a clip, clamped to the source file. */
  trimClip: (clipId: string, inP: number, out: number, opts?: { history?: boolean }) => void;
  setSettings: (patch: Partial<ProjectSettings>) => void;

  // Overlays
  addOverlay: (o: Overlay) => void;
  patchOverlay: (id: string, patch: Partial<Overlay>, opts?: { history?: boolean }) => void;
  removeOverlay: (id: string) => void;
  duplicateOverlay: (id: string) => void;
  moveOverlayLayer: (id: string, delta: number) => void;

  // Captions
  setCaptions: (patch: Partial<Captions>, opts?: { history?: boolean }) => void;
  patchSegment: (id: string, patch: Partial<CaptionSegment>, opts?: { history?: boolean }) => void;

  // Audio
  addAudioItem: (it: AudioItem) => void;
  patchAudioItem: (id: string, patch: Partial<AudioItem>, opts?: { history?: boolean }) => void;
  removeAudioItem: (id: string) => void;

  load: (project: Project, assets: Record<string, Asset>) => void;
  setLoading: (v: boolean) => void;
}

function stillExists(p: Project, s: Selection): boolean {
  if (!s) return true;
  if (s.type === 'clip') return p.clips.some((c) => c.id === s.id);
  if (s.type === 'overlay') return p.overlays.some((o) => o.id === s.id);
  if (s.type === 'caption') return p.captions.segments.some((c) => c.id === s.id);
  return p.audio.items.some((a) => a.id === s.id);
}

export const useEditor = create<EditorState>((set, get) => {
  const setSel = (s: Selection) => set({ selection: s, selectedClipId: s?.type === 'clip' ? s.id : null });
  const fixSel = (p: Project) => {
    const s = get().selection;
    if (!stillExists(p, s)) setSel(null);
  };
  return {
    project: newProject(),
    assets: {},
    past: [],
    future: [],
    selection: null,
    selectedClipId: null,
    loading: true,

    update: (fn, opts) => {
      const { project, past } = get();
      const next = fn(project);
      if (next === project) return;
      if (opts?.history === false) set({ project: next });
      else set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
      fixSel(next);
    },

    checkpoint: () => {
      const { project, past } = get();
      set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
    },

    undo: () => {
      const { past, project, future } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
      fixSel(prev);
    },

    redo: () => {
      const { past, project, future } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({ project: next, past: [...past, project], future: future.slice(1) });
      fixSel(next);
    },

    addAsset: (a) => set({ assets: { ...get().assets, [a.id]: a } }),
    patchAsset: (id, patch) => {
      const a = get().assets[id];
      if (a) set({ assets: { ...get().assets, [id]: { ...a, ...patch } } });
    },
    select: (clipId) => setSel(clipId ? { type: 'clip', id: clipId } : null),
    setSelection: (s) => setSel(s),

    appendClipForAsset: (a) => {
      const clip = newClip(a);
      get().update((p) => ({ ...p, clips: [...p.clips, clip] }));
    },

    moveClip: (clipId, delta) => {
      const i = get().project.clips.findIndex((c) => c.id === clipId);
      if (i >= 0) get().reorderClip(clipId, i + delta);
    },

    reorderClip: (clipId, toIndex) =>
      get().update((p) => {
        const i = p.clips.findIndex((c) => c.id === clipId);
        const j = Math.max(0, Math.min(p.clips.length - 1, toIndex));
        if (i < 0 || i === j || toIndex < 0 || toIndex >= p.clips.length) return p;
        const clips = [...p.clips];
        const [c] = clips.splice(i, 1);
        clips.splice(j, 0, c);
        return { ...p, clips };
      }),

    removeClip: (clipId) => get().update((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clipId) })),

    duplicateClip: (clipId) => {
      const newId = uid();
      get().update((p) => {
        const i = p.clips.findIndex((c) => c.id === clipId);
        if (i < 0) return p;
        const clips = [...p.clips];
        clips.splice(i + 1, 0, { ...structuredClone(p.clips[i]), id: newId });
        return { ...p, clips };
      });
      setSel({ type: 'clip', id: newId });
    },

    patchClip: (clipId, patch, opts) =>
      get().update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }), opts),

    splitAt: (t) => {
      const p = get().project;
      const loc = locate(layoutClips(p.clips), t);
      if (!loc) return false;
      const { clip } = loc.placed;
      const s = loc.sourceTime;
      if (s - clip.in < MIN_CLIP || clip.out - s < MIN_CLIP) return false;
      const right: Clip = { ...structuredClone(clip), id: uid(), in: s, transition: { type: 'none', duration: clip.transition.duration } };
      get().update((pp) => {
        const clips = [...pp.clips];
        const i = clips.findIndex((c) => c.id === clip.id);
        clips.splice(i, 1, { ...clip, out: s }, right);
        return { ...pp, clips };
      });
      setSel({ type: 'clip', id: right.id });
      return true;
    },

    trimClip: (clipId, inP, out, opts) => {
      const p = get().project;
      const c = p.clips.find((x) => x.id === clipId);
      if (!c) return;
      const a = get().assets[c.assetId];
      const dur = a?.kind === 'image' ? 3600 : a?.duration ?? c.out;
      let i = Math.max(0, Math.min(inP, dur - MIN_CLIP));
      let o = Math.min(dur, Math.max(out, i + MIN_CLIP));
      if (o - i < MIN_CLIP) { i = Math.max(0, o - MIN_CLIP); o = i + MIN_CLIP; }
      get().patchClip(clipId, { in: i, out: o }, opts);
    },

    setSettings: (patch) => get().update((p) => ({ ...p, settings: { ...p.settings, ...patch } })),

    addOverlay: (o) => {
      get().update((p) => ({ ...p, overlays: [...p.overlays, o] }));
      setSel({ type: 'overlay', id: o.id });
    },
    patchOverlay: (id, patch, opts) =>
      get().update((p) => ({ ...p, overlays: p.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), opts),
    removeOverlay: (id) => get().update((p) => ({ ...p, overlays: p.overlays.filter((o) => o.id !== id) })),
    duplicateOverlay: (id) => {
      const o = get().project.overlays.find((x) => x.id === id);
      if (!o) return;
      get().addOverlay({ ...structuredClone(o), id: uid(), start: o.start + 0.5, y: Math.min(0.95, o.y + 0.05) });
    },
    moveOverlayLayer: (id, delta) =>
      get().update((p) => {
        const i = p.overlays.findIndex((o) => o.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= p.overlays.length) return p;
        const overlays = [...p.overlays];
        const [o] = overlays.splice(i, 1);
        overlays.splice(j, 0, o);
        return { ...p, overlays };
      }),

    setCaptions: (patch, opts) => get().update((p) => ({ ...p, captions: { ...p.captions, ...patch } }), opts),
    patchSegment: (id, patch, opts) =>
      get().update(
        (p) => ({ ...p, captions: { ...p.captions, segments: p.captions.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) } }),
        opts,
      ),

    addAudioItem: (it) => {
      get().update((p) => ({ ...p, audio: { ...p.audio, items: [...p.audio.items, it] } }));
      setSel({ type: 'audio', id: it.id });
    },
    patchAudioItem: (id, patch, opts) =>
      get().update((p) => ({ ...p, audio: { ...p.audio, items: p.audio.items.map((a) => (a.id === id ? { ...a, ...patch } : a)) } }), opts),
    removeAudioItem: (id) => get().update((p) => ({ ...p, audio: { ...p.audio, items: p.audio.items.filter((a) => a.id !== id) } })),

    load: (project, assets) => set({ project, assets, past: [], future: [], selection: null, selectedClipId: null }),
    setLoading: (v) => set({ loading: v }),
  };
});
