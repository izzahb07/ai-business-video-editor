/**
 * Bundled fonts (served from this app; no third-party requests). Canvas text only uses a web
 * font after it is loaded, so export waits for the fonts a project uses.
 */
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/800.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/800.css';
import '@fontsource/anton/400.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/800.css';
import '@fontsource/permanent-marker/400.css';
import type { Project } from '../types';
import { FONTS, nearestWeight } from './defaults';

const loaded = new Set<string>();

export async function loadFont(family: string, weight: number, sample = 'AaBb Ññ'): Promise<void> {
  const key = `${family}:${nearestWeight(family, weight)}`;
  if (loaded.has(key) || typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(`${nearestWeight(family, weight)} 40px "${family}"`, sample);
    loaded.add(key);
  } catch { /* fall back to system font */ }
}

export async function ensureFonts(project: Project): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const o of project.overlays) if (o.kind === 'text' && o.style) jobs.push(loadFont(o.style.font, o.style.weight));
  jobs.push(loadFont('Montserrat', 800)); // callout labels
  if (project.captions.enabled && project.captions.segments.length) {
    jobs.push(loadFont(project.captions.style.font, project.captions.style.weight));
  }
  await Promise.all(jobs);
}

/** Warm up every bundled font so the preview draws them immediately. */
export function preloadAllFonts(onDone?: () => void) {
  void Promise.all(FONTS.flatMap((f) => f.weights.map((w) => loadFont(f.family, w)))).then(() => onDone?.());
}
