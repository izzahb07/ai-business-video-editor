import {
  ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import type { Asset, ExportSettings, Project } from '../../types';
import { layoutClips, outputSize, totalDuration, videoBitrate } from '../timeline';
import type { FrameSource } from '../compositor';
import { getAudio, getFile, imagesMap, loadImage, waitForAudio } from '../registry';
import { Renderer } from '../../engine/render';
import { renderMix } from '../../engine/audio';
import { ensureFonts } from '../fonts';
import { createElementProvider, createWebCodecsProvider, type FrameProvider } from './frameProviders';

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'finishing' | 'verifying';
  progress: number;
  framesDone: number;
  framesTotal: number;
  speed: number;
  note?: string;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  usedAacFallback: boolean;
  usedElementFallback: boolean;
  seconds: number;
}

export class ExportCancelled extends Error {
  constructor() { super('Export cancelled'); }
}

const AUDIO_SEGMENT = 10;
let aacRegistered = false;

/** Decodes the frames one layer (a main clip or a picture-in-picture video) needs, in order. */
class LayerStream {
  private provider: FrameProvider | null = null;
  private iter: AsyncGenerator<FrameSource | null> | null = null;
  private k = 0;
  private last: FrameSource | null = null;
  usedFallback = false;
  constructor(
    readonly key: string,
    readonly first: number,
    readonly last_: number,
    private readonly times: number[],
    private readonly file: Blob,
    private readonly asset: Asset | undefined,
    private readonly decodeWidth: number | undefined,
  ) {}

  covers(i: number) { return i >= this.first && i < this.last_; }

  private async open(fromK: number, forceElement: boolean) {
    this.provider?.dispose();
    const rest = this.times.slice(fromK);
    if (this.asset?.kind === 'image') {
      const bmp = await loadImage(this.asset.id);
      if (!bmp) throw new Error(`Could not load the photo "${this.asset.name}".`);
      const frame = { image: bmp, width: bmp.width, height: bmp.height };
      this.provider = { async *frames(ts) { for (let i = 0; i < ts.length; i++) yield frame; }, dispose() {} };
    } else if (!forceElement && this.asset?.webCodecsDecodable) {
      this.provider = await createWebCodecsProvider(this.file, this.decodeWidth);
    } else {
      this.usedFallback = true;
      this.provider = await createElementProvider(this.file);
    }
    this.iter = this.provider.frames(rest);
  }

  async next(): Promise<FrameSource | null> {
    if (!this.iter) await this.open(0, false);
    try {
      const r = await this.iter!.next();
      this.k++;
      if (!r.done && r.value) this.last = r.value;
      return this.last;
    } catch (err) {
      if (this.usedFallback) throw err;
      console.warn('WebCodecs decode failed; switching to compatibility mode', err);
      await this.open(this.k, true);
      const r = await this.iter!.next();
      this.k++;
      if (!r.done && r.value) this.last = r.value;
      return this.last;
    }
  }

  dispose() {
    this.provider?.dispose();
    this.provider = null;
    this.iter = null;
  }
}

function hasProjectAudio(project: Project): boolean {
  return project.clips.some((c) => !c.muted && c.volume > 0 && getAudio(c.assetId)) ||
    project.audio.items.some((i) => i.volume > 0 && getAudio(i.assetId));
}

export async function exportProject(
  project: Project,
  assets: Record<string, Asset>,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const started = performance.now();
  const clips = project.clips;
  if (clips.length === 0) throw new Error('Add at least one clip before exporting.');
  const duration = totalDuration(clips);
  const { fps } = settings;
  const { width: W, height: H } = outputSize(project.settings.aspect, settings.resolution);
  const bitrate = videoBitrate(W, H, fps, settings.quality);
  const framesTotal = Math.max(1, Math.round(duration * fps));
  const report = (p: Partial<ExportProgress>) =>
    onProgress({ phase: 'rendering', progress: 0, framesDone: 0, framesTotal, speed: 0, ...p });

  report({ phase: 'preparing', note: 'Checking your device can encode H.264…' });
  for (const c of clips) {
    if (!getFile(c.assetId)) throw new Error(`The video "${assets[c.assetId]?.name ?? c.assetId}" is missing. Please re-import it.`);
  }
  if (!(await canEncodeVideo('avc', { width: W, height: H, bitrate }))) {
    throw new Error(settings.resolution === 2160
      ? 'This device cannot encode 4K H.264 in the browser. Please choose 1080p.'
      : `This browser cannot encode H.264 video at ${W}×${H}. Try 720p, or update to the latest iOS (16.4+ required).`);
  }

  report({ phase: 'preparing', note: 'Preparing audio, fonts and images…' });
  for (const id of new Set([...clips.map((c) => c.assetId), ...project.audio.items.map((i) => i.assetId)])) await waitForAudio(id);
  for (const o of project.overlays) if (o.kind === 'image' && o.assetId) await loadImage(o.assetId);
  await ensureFonts(project);

  const hasAudio = hasProjectAudio(project);
  let usedAacFallback = false;
  if (hasAudio && !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: settings.audioBitrate }))) {
    report({ phase: 'preparing', note: 'Loading audio encoder…' });
    if (!aacRegistered) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      aacRegistered = true;
    }
    usedAacFallback = true;
  }
  if (signal.aborted) throw new ExportCancelled();

  // ---- Layer streams ----
  const streams: LayerStream[] = [];
  const decodeWidthFor = (a: Asset | undefined, targetW: number, targetH: number, fill: boolean) => {
    if (!a || !a.width) return undefined;
    const s = fill ? Math.max(targetW / a.width, targetH / a.height) : Math.min(targetW / a.width, targetH / a.height);
    // Decode a bit larger than needed when zoomed/cropped, never above the source.
    return s < 0.7 ? Math.max(2, Math.round((a.width * s * 1.4) / 2) * 2) : undefined;
  };
  for (const p of layoutClips(clips)) {
    const c = p.clip;
    const first = Math.ceil(p.start * fps - 1e-6);
    const last = Math.min(framesTotal, Math.ceil(p.end * fps - 1e-6));
    if (last <= first) continue;
    const times: number[] = [];
    for (let i = first; i < last; i++) times.push(Math.min(c.out - 1e-4, c.in + (i / fps - p.start)));
    const zoomed = c.transform.scale > 1.01 || c.transform.cropW < 0.99 || c.transform.cropH < 0.99;
    streams.push(new LayerStream('clip:' + c.id, first, last, times, getFile(c.assetId)!, assets[c.assetId], zoomed ? undefined : decodeWidthFor(assets[c.assetId], W, H, c.fit === 'fill'), ));
  }
  for (const o of project.overlays) {
    if (o.kind !== 'video' || !o.assetId || !getFile(o.assetId)) continue;
    const a = assets[o.assetId];
    const first = Math.max(0, Math.ceil(o.start * fps - 1e-6));
    const last = Math.min(framesTotal, Math.ceil((o.start + o.duration) * fps - 1e-6));
    if (last <= first) continue;
    const times: number[] = [];
    for (let i = first; i < last; i++) times.push(Math.min((a?.duration ?? 1e9) - 1e-3, (o.in ?? 0) + (i / fps - o.start)));
    streams.push(new LayerStream('pip:' + o.id, first, last, times, getFile(o.assetId)!, a, decodeWidthFor(a, (o.w ?? 0.4) * W * 2, H, false)));
  }

  // ---- Output ----
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const renderer = new Renderer(W, H);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate, keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource: AudioBufferSource | null = null;
  if (hasAudio) {
    audioSource = new AudioBufferSource({ codec: 'aac', bitrate: settings.audioBitrate });
    output.addAudioTrack(audioSource);
  }
  output.setMetadataTags({ title: project.name, comment: 'Made with AI Business Video Studio' });
  await output.start();

  let audioDoneUntil = 0;
  const pumpAudio = async (untilTime: number) => {
    if (!audioSource) return;
    while (audioDoneUntil < Math.min(untilTime, duration) - 1e-9) {
      const t0 = audioDoneUntil;
      const t1 = Math.min(duration, t0 + AUDIO_SEGMENT);
      await audioSource.add(await renderMix(project, t0, t1));
      audioDoneUntil = t1;
    }
  };

  let framesDone = 0;
  const renderStart = performance.now();
  const images = imagesMap();
  try {
    for (let i = 0; i < framesTotal; i++) {
      if (signal.aborted) throw new ExportCancelled();
      const t = i / fps;
      let main: FrameSource | null = null;
      const videos = new Map<string, FrameSource>();
      for (const s of streams) {
        if (!s.covers(i)) continue;
        const f = await s.next();
        if (s.key.startsWith('clip:')) main = f;
        else if (f) videos.set(s.key.slice(4), f);
        if (i === s.last_ - 1) s.dispose();
      }
      renderer.render(ctx, project, t, { main, videos, images });
      await pumpAudio(t + 1);
      await videoSource.add(t, 1 / fps);
      framesDone++;
      if (framesDone % 3 === 0 || framesDone === framesTotal) {
        const el = (performance.now() - renderStart) / 1000;
        report({
          phase: 'rendering', progress: (framesDone / framesTotal) * 0.95, framesDone,
          speed: framesDone / Math.max(0.001, el),
          note: streams.some((s) => s.usedFallback) ? 'Compatibility mode (slower)' : undefined,
        });
      }
    }
    await pumpAudio(duration);
    if (signal.aborted) throw new ExportCancelled();
    report({ phase: 'finishing', progress: 0.96, framesDone, note: 'Writing MP4 file…' });
    await output.finalize();
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw err;
  } finally {
    for (const s of streams) s.dispose();
    renderer.dispose();
    canvas.width = canvas.height = 0;
  }

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error('The encoder produced an empty file.');
  const blob = new Blob([buffer], { type: 'video/mp4' });

  report({ phase: 'verifying', progress: 0.98, framesDone, note: 'Checking the finished file…' });
  await verifyMp4(blob, { width: W, height: H, duration, hasAudio });

  const safeName = (project.name || 'video').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'video';
  return {
    blob, fileName: `${safeName}-${W}x${H}-${fps}fps.mp4`, width: W, height: H, fps, duration, hasAudio, usedAacFallback,
    usedElementFallback: streams.some((s) => s.usedFallback), seconds: (performance.now() - started) / 1000,
  };
}

/** Re-open the finished file and check it is a real, playable MP4. Throws if anything is wrong. */
export async function verifyMp4(
  blob: Blob,
  expected: { width: number; height: number; duration: number; hasAudio: boolean },
): Promise<void> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const fmt = await input.getFormat();
    if (!/mp4/i.test(fmt.name) && !/mp4/i.test(await input.getMimeType())) throw new Error(`Output is not MP4 (${fmt.name})`);
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('Exported file has no video track.');
    if ((await vt.getCodec()) !== 'avc') throw new Error('Exported video is not H.264.');
    const w = await vt.getDisplayWidth();
    const h = await vt.getDisplayHeight();
    if (w !== expected.width || h !== expected.height) throw new Error(`Exported size ${w}×${h} does not match ${expected.width}×${expected.height}.`);
    const dur = await input.computeDuration();
    if (Math.abs(dur - expected.duration) > Math.max(0.25, expected.duration * 0.02)) {
      throw new Error(`Exported length ${dur.toFixed(2)}s does not match expected ${expected.duration.toFixed(2)}s.`);
    }
    if (expected.hasAudio) {
      const at = await input.getPrimaryAudioTrack();
      if (!at) throw new Error('Exported file is missing its audio track.');
      if ((await at.getCodec()) !== 'aac') throw new Error('Exported audio is not AAC.');
    }
    if (await vt.canDecode()) {
      const sink = new CanvasSink(vt, { width: 64 });
      const wc = await sink.getCanvas(await vt.getFirstTimestamp());
      if (!wc) throw new Error('Could not decode the first frame of the exported video.');
    }
  } finally {
    input.dispose();
  }
}
