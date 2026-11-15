/**
 * Preview player.
 * - The Web Audio clock is the master clock (sample-accurate, survives clip switches).
 * - Video elements are always muted (so iOS lets us switch between them freely) and are
 *   kept in sync with the audio clock; each frame is drawn through the shared compositor.
 */
import { create } from 'zustand';
import type { Asset, Project } from '../types';
import { drawFrame } from './compositor';
import { getAudio, getPooledVideo, seekVideo } from './registry';
import { layoutClips, locate, totalDuration, type PlacedClip } from './timeline';
import { CUT_FADE } from './audioMix';

interface PlayerUi {
  time: number;
  playing: boolean;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
}
export const usePlayer = create<PlayerUi>((set) => ({
  time: 0,
  playing: false,
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
}));

let audioCtx: AudioContext | null = null;

/** Must be called from a tap/click handler the first time (iOS requirement). */
export function unlockAudio(): AudioContext {
  if (!audioCtx) {
    // Let preview sound play even when the iPhone's silent switch is on (Safari 16.4+).
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch { /* not supported */ }
    audioCtx = new AudioContext({ latencyHint: 'playback' });
  }
  if (audioCtx.state !== 'running') void audioCtx.resume();
  return audioCtx;
}

export class PreviewPlayer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private project: Project | null = null;
  private placed: PlacedClip[] = [];
  private duration = 0;

  private playing = false;
  private startCtxTime = 0;
  private startTimelineTime = 0;
  private time = 0;
  private raf = 0;
  private nodes: AudioBufferSourceNode[] = [];
  private activeVideo: HTMLVideoElement | null = null;
  private activeClipId: string | null = null;
  private seekToken = 0;
  private lastUiUpdate = 0;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.redraw();
  }

  detach() {
    this.pause();
    this.canvas = null;
    this.ctx = null;
  }

  /** `_assets` is accepted so the preview re-syncs when assets change (e.g. audio finishes decoding). */
  setProject(project: Project, _assets: Record<string, Asset>) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.project = project;
    this.placed = layoutClips(project.clips);
    this.duration = totalDuration(project.clips);
    if (this.time > this.duration) this.time = this.duration;
    usePlayer.getState().setTime(this.time);
    void this.seek(this.time);
    if (wasPlaying) this.play();
  }

  getTime() {
    return this.time;
  }

  isPlaying() {
    return this.playing;
  }

  /** Call from a user gesture. */
  play() {
    if (!this.project || this.placed.length === 0) return;
    const ac = unlockAudio();
    if (this.time >= this.duration - 0.05) this.time = 0;
    this.playing = true;
    usePlayer.getState().setPlaying(true);
    this.startCtxTime = ac.currentTime + 0.05;
    this.startTimelineTime = this.time;
    this.scheduleAudio(ac, this.startCtxTime, this.time);
    this.syncVideo(true);
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    this.time = this.currentTime();
    this.playing = false;
    usePlayer.getState().setPlaying(false);
    cancelAnimationFrame(this.raf);
    for (const n of this.nodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.nodes = [];
    this.activeVideo?.pause();
    usePlayer.getState().setTime(this.time);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  async seek(t: number) {
    const was = this.playing;
    if (was) this.pause();
    this.time = Math.max(0, Math.min(t, this.duration));
    usePlayer.getState().setTime(this.time);
    const token = ++this.seekToken;
    const loc = locate(this.placed, this.time);
    if (!loc) {
      this.drawVideo(null);
      return;
    }
    const v = getPooledVideo(loc.placed.clip.assetId);
    if (!v) return;
    this.setActive(v, loc.placed.clip.id);
    try {
      await seekVideo(v, loc.sourceTime);
    } catch { /* ignore */ }
    if (token !== this.seekToken) return;
    this.drawVideo(v);
    if (was) this.play();
  }

  redraw() {
    this.drawVideo(this.activeVideo);
  }

  private currentTime(): number {
    if (!this.playing || !audioCtx) return this.time;
    return Math.min(this.duration, this.startTimelineTime + Math.max(0, audioCtx.currentTime - this.startCtxTime));
  }

  private scheduleAudio(ac: AudioContext, ctxStart: number, fromTime: number) {
    for (const p of this.placed) {
      const { clip } = p;
      if (p.end <= fromTime || clip.muted || clip.volume <= 0) continue;
      const buf = getAudio(clip.assetId);
      if (!buf) continue;
      const rel = p.start - fromTime;
      const when = ctxStart + Math.max(0, rel);
      const offset = clip.in + Math.max(0, -rel);
      const dur = p.end - Math.max(p.start, fromTime);
      if (dur <= 0 || offset >= buf.duration) continue;
      const node = ac.createBufferSource();
      node.buffer = buf;
      const g = ac.createGain();
      const fade = Math.min(CUT_FADE, dur / 4);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(clip.volume, when + fade);
      g.gain.setValueAtTime(clip.volume, when + dur - fade);
      g.gain.linearRampToValueAtTime(0, when + dur);
      node.connect(g).connect(ac.destination);
      node.start(when, offset, dur);
      this.nodes.push(node);
    }
  }

  private setActive(v: HTMLVideoElement, clipId: string) {
    if (this.activeVideo && this.activeVideo !== v) this.activeVideo.pause();
    this.activeVideo = v;
    this.activeClipId = clipId;
  }

  /** Make sure the right video element is playing at the right position. */
  private syncVideo(force = false) {
    const t = this.currentTime();
    const loc = locate(this.placed, t);
    if (!loc) return;
    const { clip } = loc.placed;
    const v = getPooledVideo(clip.assetId);
    if (!v) return;
    const switched = this.activeClipId !== clip.id || this.activeVideo !== v;
    if (switched) this.setActive(v, clip.id);
    const drift = Math.abs(v.currentTime - loc.sourceTime);
    if (force || switched || drift > 0.2) {
      if (!v.seeking) v.currentTime = loc.sourceTime;
    }
    if (v.paused) void v.play().catch(() => {});

    // Pre-roll the next clip's element so the cut is instant.
    const next = this.placed[loc.placed.index + 1];
    if (next && loc.placed.end - t < 0.8) {
      const nv = getPooledVideo(next.clip.assetId);
      if (nv && nv !== v && nv.paused && Math.abs(nv.currentTime - next.clip.in) > 0.05 && !nv.seeking) {
        nv.currentTime = next.clip.in;
      }
      // Keep the active one most-recently-used in the pool.
      getPooledVideo(clip.assetId);
    }
  }

  private loop = () => {
    if (!this.playing) return;
    const t = this.currentTime();
    this.time = t;
    if (t >= this.duration - 1e-3) {
      this.pause();
      this.time = this.duration;
      usePlayer.getState().setTime(this.time);
      return;
    }
    this.syncVideo();
    this.drawVideo(this.activeVideo);
    const now = performance.now();
    if (now - this.lastUiUpdate > 66) {
      this.lastUiUpdate = now;
      usePlayer.getState().setTime(t);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private drawVideo(v: HTMLVideoElement | null) {
    const { canvas, ctx, project } = this;
    if (!canvas || !ctx || !project) return;
    const loc = locate(this.placed, this.time);
    const fit = loc?.placed.clip.fit ?? 'fill';
    const ready = v && v.readyState >= 2 && v.videoWidth > 0;
    drawFrame(
      ctx,
      canvas.width,
      canvas.height,
      ready ? { image: v, width: v.videoWidth, height: v.videoHeight } : null,
      fit,
      project.settings,
    );
  }
}

export const player = new PreviewPlayer();
