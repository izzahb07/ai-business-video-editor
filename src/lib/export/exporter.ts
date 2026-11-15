import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import type { Asset, ExportSettings, Project } from '../../types';
import { AUDIO_BITRATE, layoutClips, outputSize, totalDuration, videoBitrate } from '../timeline';
import { drawFrame, type FrameSource } from '../compositor';
import { getFile, waitForAudio } from '../registry';
import { renderAudioSegment } from '../audioMix';
import { createElementProvider, createWebCodecsProvider, type FrameProvider } from './frameProviders';

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'finishing' | 'verifying';
  /** 0..1 */
  progress: number;
  framesDone: number;
  framesTotal: number;
  /** Frames per second achieved so far. */
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
  constructor() {
    super('Export cancelled');
  }
}

const AUDIO_SEGMENT = 2; // seconds of audio mixed at a time

let aacRegistered = false;

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
    throw new Error(
      `This browser cannot encode H.264 video at ${W}×${H}. Try 720p, or update to the latest iOS (16.4 or newer is required).`,
    );
  }

  // ---- Audio preparation ----
  report({ phase: 'preparing', note: 'Preparing audio…' });
  const audioBuffers = new Map<string, AudioBuffer | null>();
  for (const c of clips) {
    if (!audioBuffers.has(c.assetId)) audioBuffers.set(c.assetId, await waitForAudio(c.assetId));
  }
  const hasAudio = clips.some((c) => !c.muted && c.volume > 0 && audioBuffers.get(c.assetId));
  let usedAacFallback = false;
  if (hasAudio && !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: AUDIO_BITRATE }))) {
    report({ phase: 'preparing', note: 'Loading audio encoder…' });
    if (!aacRegistered) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      aacRegistered = true;
    }
    usedAacFallback = true;
  }
  if (signal.aborted) throw new ExportCancelled();

  // ---- Output setup ----
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate, keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource: AudioBufferSource | null = null;
  if (hasAudio) {
    audioSource = new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE });
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
      const seg = await renderAudioSegment(clips, audioBuffers, t0, t1);
      await audioSource.add(seg);
      audioDoneUntil = t1;
    }
  };

  let usedElementFallback = false;
  let framesDone = 0;
  const renderStart = performance.now();

  try {
    for (const p of layoutClips(clips)) {
      const { clip } = p;
      const asset = assets[clip.assetId];
      const file = getFile(clip.assetId)!;
      // Output frames whose timestamp falls in this clip.
      const first = Math.ceil(p.start * fps - 1e-6);
      const last = Math.min(framesTotal, Math.ceil(p.end * fps - 1e-6));
      if (last <= first) continue;
      const indices: number[] = [];
      for (let i = first; i < last; i++) indices.push(i);
      const srcTimes = indices.map((i) => Math.min(clip.out - 1e-4, clip.in + (i / fps - p.start)));

      // Decode no larger than needed (saves memory and time on 4K iPhone footage).
      let decodeWidth: number | undefined;
      if (asset) {
        const s = clip.fit === 'fill' ? Math.max(W / asset.width, H / asset.height) : Math.min(W / asset.width, H / asset.height);
        if (s < 1) decodeWidth = Math.max(2, Math.round((asset.width * s) / 2) * 2);
      }

      let provider: FrameProvider | null = null;
      let k = 0; // frames of this clip done
      let lastFrame: FrameSource | null = null;

      const runWith = async (prov: FrameProvider) => {
        for await (const frame of prov.frames(srcTimes.slice(k))) {
          if (signal.aborted) throw new ExportCancelled();
          if (frame) lastFrame = frame;
          drawFrame(ctx, W, H, frame ?? lastFrame, clip.fit, project.settings);
          const idx = indices[k];
          const t = idx / fps;
          await pumpAudio(t + 1);
          await videoSource.add(t, 1 / fps);
          k++;
          framesDone++;
          if (framesDone % 3 === 0 || framesDone === framesTotal) {
            const el = (performance.now() - renderStart) / 1000;
            report({
              phase: 'rendering',
              progress: (framesDone / framesTotal) * 0.95,
              framesDone,
              speed: framesDone / Math.max(0.001, el),
              note: usedElementFallback ? 'Compatibility mode (slower)' : undefined,
            });
          }
        }
      };

      try {
        if (asset?.webCodecsDecodable) {
          try {
            provider = await createWebCodecsProvider(file, decodeWidth);
            await runWith(provider);
          } catch (err) {
            if (err instanceof ExportCancelled) throw err;
            console.warn('WebCodecs decode failed; switching to compatibility mode', err);
            provider?.dispose();
            provider = null;
          }
        }
        if (k < indices.length) {
          usedElementFallback = true;
          provider = await createElementProvider(file);
          await runWith(provider);
        }
      } finally {
        provider?.dispose();
      }
    }

    await pumpAudio(duration);
    if (signal.aborted) throw new ExportCancelled();

    report({ phase: 'finishing', progress: 0.96, framesDone, note: 'Writing MP4 file…' });
    await output.finalize();
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    canvas.width = canvas.height = 0;
    throw err;
  }
  canvas.width = canvas.height = 0;

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error('The encoder produced an empty file.');
  const blob = new Blob([buffer], { type: 'video/mp4' });

  report({ phase: 'verifying', progress: 0.98, framesDone, note: 'Checking the finished file…' });
  await verifyMp4(blob, { width: W, height: H, duration, hasAudio });

  const safeName = (project.name || 'video').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'video';
  return {
    blob,
    fileName: `${safeName}-${W}x${H}-${fps}fps.mp4`,
    width: W,
    height: H,
    fps,
    duration,
    hasAudio,
    usedAacFallback,
    usedElementFallback,
    seconds: (performance.now() - started) / 1000,
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
    // Decode the first frame to prove the video data is valid.
    if (await vt.canDecode()) {
      const sink = new CanvasSink(vt, { width: 64 });
      const wc = await sink.getCanvas(await vt.getFirstTimestamp());
      if (!wc) throw new Error('Could not decode the first frame of the exported video.');
    }
  } finally {
    input.dispose();
  }
}
