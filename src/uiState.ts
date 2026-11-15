import { create } from 'zustand';

export type Tab = 'edit' | 'captions' | 'text' | 'color' | 'audio' | 'ai' | 'format';

interface UiState {
  tab: Tab;
  setTab: (t: Tab) => void;
  /** Before/after split position for colour grading, or null when off. */
  compare: number | null;
  setCompare: (c: number | null) => void;
}

export const useUi = create<UiState>((set) => ({
  tab: 'edit',
  setTab: (tab) => set({ tab }),
  compare: null,
  setCompare: (compare) => set({ compare }),
}));
