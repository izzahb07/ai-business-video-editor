/**
 * Preview player.
 * - The Web Audio clock is the master clock; all sound comes from the same audio graph as export.
 * - Video elements are muted (so iOS lets us switch freely) and kept in sync with the clock.
 * - Frames are drawn through the same Renderer as export.
 */
import { create } from 'zustand';
import type { Asset, Project } from '../types';
import { getPooledVideo, imagesMap, loadImage, seekVideo } from './registry';
import { layoutClips, locate, totalDuration, type PlacedClip } from './timeline';
import { Renderer } from '../engine/render';
import { buildAudioGraph, type GraphHandle } from '../engine/audio';
import { isOverlayActive } from '../engine/overlays';
import type { FrameSource } from './compositor';

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
  private renderer: Renderer | null = null;
  private project: Project | null = null;
  private placed: PlacedClip[] = [];
  private assets: Record<string, Asset> = {};
  private duration = 0;

  private playing = false;
  private startCtxTime = 0;
  private startTimelineTime = 0;
  private time = 0;
  private raf = 0;
  private graph: GraphHandle | null = null;
  private master: GainNode | null = null;
  private activeVideo: HTMLVideoElement | null = null;
  private activeClipId: string | null = null;
  private seekToken = 0;
  private lastUiUpdate = 0;
  /** Before/after split (0..1) or null. */
  compare: number | null = null;
  /** Called after every drawn frame (selection outlines etc.). */
  onFrame: (() => void) | null = null;
  /** Stop playback when reaching this time (clip preview). */
  private stopAt: number | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.renderer) this.renderer = new Renderer(canvas.width, canvas.height);
    else this.renderer.resize(canvas.width, canvas.height);
    this.redraw();
  }

  detach() {
    this.pause();
    this.canvas = null;
    this.ctx = null;
  }

  setProject(project: Project, assets: Record<string, Asset>) {
    this.assets = assets;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.project = project;
    this.placed = layoutClips(project.clips);
    this.duration = totalDuration(project.clips);
    if (this.time > this.duration) this.time = this.duration;
    usePlayer.getState().setTime(this.time);
    // Make sure logo/image overlays are decoded.
    for (const o of project.overlays) {
      if (o.kind === 'image' && o.assetId && !imagesMap().has(o.assetId)) void loadImage(o.assetId).then(() => this.redraw());
    }
    void this.seek(this.time);
    if (wasPlaying) this.play();
  }

  getTime() { return this.time; }
  getDuration() { return this.duration; }
  isPlaying() { return this.playing; }

  play() {
    if (!this.project || this.placed.length === 0) return;
    const ac = unlockAudio();
    if (this.time >= this.duration - 0.05) this.time = 0;
    this.playing = true;
    usePlayer.getState().setPlaying(true);
    this.startCtxTime = ac.currentTime + 0.06;
    this.startTimelineTime = this.time;
    if (!this.master) {
      this.master = ac.createGain();
      this.master.connect(ac.destination);
    }
    this.graph = buildAudioGraph(ac, this.project, this.time, this.duration, this.startCtxTime, this.master);
    this.syncVideos(true);
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    this.time = this.currentTime();
    this.playing = false;
    usePlayer.getState().setPlaying(false);
    cancelAnimationFrame(this.raf);
    this.graph?.stop();
    this.graph = null;
    this.activeVideo?.pause();
    this.forEachPip((v) => v.pause());
    usePlayer.getState().setTime(this.time);
  }

  toggle() {
    if (this.playing) this.pause();
    else { this.stopAt = null; this.play(); }
  }

  /** Preview just one part of the timeline (e.g. a single clip). Call from a tap. */
  async playRange(start: number, end: number) {
    this.pause();
    unlockAudio();
    await this.seek(start);
    this.stopAt = end;
    this.play();
  }

  async seek(t: number) {
    const was = this.playing;
    if (was) this.pause();
    this.time = Math.max(0, Math.min(t, this.duration));
    usePlayer.getState().setTime(this.time);
    const token = ++this.seekToken;
    const loc = locate(this.placed, this.time);
    const waits: Promise<void>[] = [];
    if (loc && !this.isImageClip(loc.placed.clip.assetId)) {
      const v = getPooledVideo(loc.placed.clip.assetId);
      if (v) {
        this.setActive(v, loc.placed.clip.id);
        waits.push(seekVideo(v, loc.sourceTime).catch(() => {}));
      }
    }
    for (const o of this.activePips(this.time)) {
      const v = getPooledVideo(o.assetId!, 'pip:' + o.id);
      if (v) waits.push(seekVideo(v, (o.in ?? 0) + (this.time - o.start)).catch(() => {}));
    }
    await Promise.all(waits);
    if (token !== this.seekToken) return;
    this.redraw();
    if (was) this.play();
  }

  redraw() {
    this.draw();
  }

  private currentTime(): number {
    if (!this.playing || !audioCtx) return this.time;
    return Math.min(this.duration, this.startTimelineTime + Math.max(0, audioCtx.currentTime - this.startCtxTime));
  }

  private isImageClip(assetId: string) {
    return this.assets[assetId]?.kind === 'image';
  }

  private activePips(t: number) {
    return (this.project?.overlays ?? []).filter((o) => o.kind === 'video' && o.assetId && isOverlayActive(o, t));
  }

  private forEachPip(fn: (v: HTMLVideoElement) => void) {
    for (const o of this.activePips(this.time)) {
      const v = getPooledVideo(o.assetId!, 'pip:' + o.id);
      if (v) fn(v);
    }
  }

  private setActive(v: HTMLVideoElement, clipId: string) {
    if (this.activeVideo && this.activeVideo !== v) this.activeVideo.pause();
    this.activeVideo = v;
    this.activeClipId = clipId;
  }

  private syncVideos(force = false) {
    const t = this.currentTime();
    const loc = locate(this.placed, t);
    if (loc && !this.isImageClip(loc.placed.clip.assetId)) {
      const { clip } = loc.placed;
      const v = getPooledVideo(clip.assetId);
      if (v) {
        const switched = this.activeClipId !== clip.id || this.activeVideo !== v;
        if (switched) this.setActive(v, clip.id);
        if ((force || switched || Math.abs(v.currentTime - loc.sourceTime) > 0.2) && !v.seeking) v.currentTime = loc.sourceTime;
        if (v.paused) void v.play().catch(() => {});
        const next = this.placed[loc.placed.index + 1];
        if (next && loc.placed.end - t < 0.8) {
          const nv = getPooledVideo(next.clip.assetId);
          if (nv && nv !== v && nv.paused && Math.abs(nv.currentTime - next.clip.in) > 0.05 && !nv.seeking) nv.currentTime = next.clip.in;
          getPooledVideo(clip.assetId);
        }
      }
    }
    for (const o of this.activePips(t)) {
      const v = getPooledVideo(o.assetId!, 'pip:' + o.id);
      if (!v) continue;
      const st = (o.in ?? 0) + (t - o.start);
      if ((force || Math.abs(v.currentTime - st) > 0.25) && !v.seeking) v.currentTime = st;
      if (v.paused) void v.play().catch(() => {});
    }
  }

  private loop = () => {
    if (!this.playing) return;
    const t = this.currentTime();
    this.time = t;
    if (this.stopAt != null && t >= this.stopAt) {
      this.pause();
      this.stopAt = null;
      return;
    }
    if (t >= this.duration - 1e-3) {
      this.pause();
      this.time = this.duration;
      usePlayer.getState().setTime(this.time);
      return;
    }
    this.syncVideos();
    this.draw();
    const now = performance.now();
    if (now - this.lastUiUpdate > 50) {
      this.lastUiUpdate = now;
      usePlayer.getState().setTime(t);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw() {
    const { canvas, ctx, project, renderer } = this;
    if (!canvas || !ctx || !project || !renderer) return;
    renderer.resize(canvas.width, canvas.height);
    const v = this.activeVideo;
    const loc = locate(this.placed, this.time);
    let main: FrameSource | null = null;
    if (loc && this.isImageClip(loc.placed.clip.assetId)) {
      const bmp = imagesMap().get(loc.placed.clip.assetId);
      if (bmp) main = { image: bmp, width: bmp.width, height: bmp.height };
      else void loadImage(loc.placed.clip.assetId).then(() => this.redraw());
    } else if (v && v.readyState >= 2 && v.videoWidth > 0 && this.activeClipId === loc?.placed.clip.id) {
      main = { image: v, width: v.videoWidth, height: v.videoHeight };
    }
    const videos = new Map<string, FrameSource>();
    for (const o of this.activePips(this.time)) {
      const pv = getPooledVideo(o.assetId!, 'pip:' + o.id);
      if (pv && pv.readyState >= 2 && pv.videoWidth) videos.set(o.id, { image: pv, width: pv.videoWidth, height: pv.videoHeight });
    }
    renderer.render(ctx, project, this.time, { main, videos, images: imagesMap() }, { compare: this.compare });
    this.onFrame?.();
  }
}

export const player = new PreviewPlayer();
