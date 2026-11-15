import type { ReactNode } from 'react';
import type { Tab } from '../uiState';
import { CaptionsPanel } from './CaptionsPanel';

/** Panels for each tool tab (registered as they are implemented). */
export const TAB_PANELS: Partial<Record<Tab, ReactNode>> = {
  captions: <CaptionsPanel />,
};
