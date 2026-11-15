/**
 * THE frame renderer. Preview and export both call `Renderer.render`, so every edit
 * (crop, transitions, colour grade, graphics, captions) appears identically in the MP4.
 */
import type { Project } from '../types';
import { blurInPlace, drawClipLayer, NO_MOTION, type ClipMotion, type FrameSource } from '../lib/compositor';
import { layoutClips, locate, type PlacedClip } from '../lib/timeline';
import { isNeutralGrade } from '../lib/defaults';
import { getLut } from '../lib/registry';
import { Grader } from './grade';
import { drawOverlay, type OverlayAssets } from './overlays';
import { drawCaptions } from './captions';
import { clamp01, easeInOut } from './text';

export interface RenderInputs extends OverlayAssets {
  /** Decoded frame of the main clip visible at time t. */
  main: FrameSource | null;
}

export interface RenderOptions {
  /** Before/after split position 0..1 (left side ungraded), or null. */
  compare?: number | null;
  /** Skip colour grading (faster scrubbing). */
  noGrade?: boolean;
}

export interface TransitionFx {
  type: string;
  /** 0 = no effect, 1 = at the cut. */
  amount: number;
  phase: 'in' | 'out';
}

/** Which transition effect applies at local time `lt` of placed clip `p`. */
export function transitionAt(placed: PlacedClip[], p: PlacedClip, lt: number): TransitionFx | null {
  const D = p.end - p.start;
  const trIn = p.index > 0 ? p.clip.transition : null;
  const next = placed[p.index + 1];
  const trOut = next ? next.clip.transition : null;
  if (trIn && trIn.type !== 'none') {
    const half = Math.min(trIn.duration / 2, D / 2);
    if (lt < half) return { type: trIn.type, amount: 1 - lt / half, phase: 'in' };
  }
  if (trOut && trOut.type !== 'none') {
    const half = Math.min(trOut.duration / 2, D / 2, (next.end - next.start) / 2);
    if (D - lt < half) return { type: trOut.type, amount: 1 - (D - lt) / half, phase: 'out' };
  }
  return null;
}

function motionFor(fx: TransitionFx | null): ClipMotion {
  if (!fx) return NO_MOTION;
  const a = easeInOut(fx.amount);
  switch (fx.type) {
    case 'zoom': return { zoom: 1 + 0.45 * a * a, dx: 0, ghost: 0 };
    case 'whip': return { zoom: 1 + 0.08 * a, dx: (fx.phase === 'out' ? -1 : 1) * 0.55 * a * a, ghost: a };
    default: return NO_MOTION;
  }
}

export class Renderer {
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private grader: Grader | null | undefined;
  W: number;
  H: number;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.layer = document.createElement('canvas');
    this.layer.width = W;
    this.layer.height = H;
    this.lctx = this.layer.getContext('2d', { alpha: false, willReadFrequently: false })!;
  }

  resize(W: number, H: number) {
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.layer.width = W;
    this.layer.height = H;
    this.grader?.resize(W, H);
  }

  private getGrader(): Grader | null {
    if (this.grader === undefined) this.grader = Grader.create(this.W, this.H);
    return this.grader;
  }

  render(out: CanvasRenderingContext2D, project: Project, t: number, inputs: RenderInputs, opts: RenderOptions = {}) {
    const { W, H } = this;
    const placed = layoutClips(project.clips);
    const loc = locate(placed, t);
    out.save();
    out.fillStyle = '#000';
    out.fillRect(0, 0, W, H);

    if (loc) {
      const { placed: p } = loc;
      const clip = p.clip;
      const fx = transitionAt(placed, p, t - p.start);
      drawClipLayer(this.lctx, W, H, inputs.main, clip, project.settings, motionFor(fx));
      if (fx?.type === 'blur') blurInPlace(this.lctx, this.layer, easeInOut(fx.amount));

      let frame: CanvasImageSource = this.layer;
      const wantsGrade = !opts.noGrade && (!isNeutralGrade(clip.grade) || opts.compare != null);
      if (wantsGrade) {
        const g = this.getGrader();
        if (g) {
          g.resize(W, H);
          frame = g.process(this.layer, clip.grade, clip.grade.lutId ? getLut(clip.grade.lutId) ?? null : null, opts.compare ?? null);
        }
      }
      out.drawImage(frame, 0, 0, W, H);

      if (fx && (fx.type === 'fade' || fx.type === 'flash')) {
        out.globalAlpha = clamp01(easeInOut(fx.amount));
        out.fillStyle = fx.type === 'fade' ? '#000' : '#fff';
        out.fillRect(0, 0, W, H);
        out.globalAlpha = 1;
      }
    }

    for (const o of project.overlays) drawOverlay(out, W, H, o, t, inputs);
    drawCaptions(out, W, H, project, t);
    out.restore();
  }

  dispose() {
    this.grader?.dispose();
    this.layer.width = this.layer.height = 0;
  }
}
