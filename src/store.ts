import { create } from 'zustand';
import type { Asset, Clip, Project, ProjectSettings } from './types';

const HISTORY_LIMIT = 100;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newProject(): Project {
  return {
    id: uid(),
    name: 'My Video',
    clips: [],
    settings: { aspect: '9:16', background: 'blur' },
  };
}

interface EditorState {
  project: Project;
  assets: Record<string, Asset>;
  past: Project[];
  future: Project[];
  selectedClipId: string | null;
  /** True while restoring a saved project on startup. */
  loading: boolean;

  /** Apply a change to the project. `history: false` is for live slider drags after `checkpoint()`. */
  update: (fn: (p: Project) => Project, opts?: { history?: boolean }) => void;
  /** Save an undo point now (call at the start of a drag gesture). */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;

  addAsset: (a: Asset) => void;
  patchAsset: (id: string, patch: Partial<Asset>) => void;
  select: (clipId: string | null) => void;

  // Convenience actions (all undoable)
  appendClipForAsset: (a: Asset) => void;
  moveClip: (clipId: string, delta: number) => void;
  removeClip: (clipId: string) => void;
  duplicateClip: (clipId: string) => void;
  patchClip: (clipId: string, patch: Partial<Clip>, opts?: { history?: boolean }) => void;
  setSettings: (patch: Partial<ProjectSettings>) => void;

  /** Replace everything (startup restore / new project). Clears history. */
  load: (project: Project, assets: Record<string, Asset>) => void;
  setLoading: (v: boolean) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  project: newProject(),
  assets: {},
  past: [],
  future: [],
  selectedClipId: null,
  loading: true,

  update: (fn, opts) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    if (opts?.history === false) {
      set({ project: next });
    } else {
      set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
    }
  },

  checkpoint: () => {
    const { project, past } = get();
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  },

  undo: () => {
    const { past, project, future, selectedClipId } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [project, ...future],
      selectedClipId: prev.clips.some((c) => c.id === selectedClipId) ? selectedClipId : null,
    });
  },

  redo: () => {
    const { past, project, future, selectedClipId } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      project: next,
      past: [...past, project],
      future: future.slice(1),
      selectedClipId: next.clips.some((c) => c.id === selectedClipId) ? selectedClipId : null,
    });
  },

  addAsset: (a) => set({ assets: { ...get().assets, [a.id]: a } }),
  patchAsset: (id, patch) => {
    const a = get().assets[id];
    if (a) set({ assets: { ...get().assets, [id]: { ...a, ...patch } } });
  },
  select: (clipId) => set({ selectedClipId: clipId }),

  appendClipForAsset: (a) => {
    const clip: Clip = {
      id: uid(),
      assetId: a.id,
      in: 0,
      out: a.duration,
      volume: 1,
      muted: false,
      fit: 'fill',
    };
    get().update((p) => ({ ...p, clips: [...p.clips, clip] }));
  },

  moveClip: (clipId, delta) =>
    get().update((p) => {
      const i = p.clips.findIndex((c) => c.id === clipId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= p.clips.length) return p;
      const clips = [...p.clips];
      const [c] = clips.splice(i, 1);
      clips.splice(j, 0, c);
      return { ...p, clips };
    }),

  removeClip: (clipId) => {
    get().update((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clipId) }));
    if (get().selectedClipId === clipId) set({ selectedClipId: null });
  },

  duplicateClip: (clipId) => {
    const newId = uid();
    get().update((p) => {
      const i = p.clips.findIndex((c) => c.id === clipId);
      if (i < 0) return p;
      const clips = [...p.clips];
      clips.splice(i + 1, 0, { ...p.clips[i], id: newId });
      return { ...p, clips };
    });
    set({ selectedClipId: newId });
  },

  patchClip: (clipId, patch, opts) =>
    get().update(
      (p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }),
      opts,
    ),

  setSettings: (patch) => get().update((p) => ({ ...p, settings: { ...p.settings, ...patch } })),

  load: (project, assets) => set({ project, assets, past: [], future: [], selectedClipId: null }),
  setLoading: (v) => set({ loading: v }),
}));
