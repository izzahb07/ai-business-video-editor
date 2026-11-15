/**
 * Two ways to get decoded frames from a source file for export:
 *  1. WebCodecs (fast, hardware decoding, frame-accurate) via Mediabunny's CanvasSink.
 *  2. Fallback: seek a hidden <video> element frame by frame (slower, works with anything Safari can play).
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { FrameSource } from '../compositor';
import { createVideoElement, destroyVideoElement, seekVideo, waitEvent } from '../registry';

export interface FrameProvider {
  /** Yields one frame per requested source time (seconds, 0 = first frame). */
  frames(times: number[]): AsyncGenerator<FrameSource | null>;
  dispose(): void;
}

export async function createWebCodecsProvider(
  file: Blob,
  decodeWidth: number | undefined,
): Promise<FrameProvider> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) throw new Error('No video track');
  if (!(await vt.canDecode())) throw new Error('Codec not decodable with WebCodecs');
  const origin = await vt.getFirstTimestamp();
  const sink = new CanvasSink(vt, { width: decodeWidth, poolSize: 3 });
  return {
    async *frames(times) {
      for await (const wc of sink.canvasesAtTimestamps(times.map((t) => t + origin))) {
        yield wc ? { image: wc.canvas, width: wc.canvas.width, height: wc.canvas.height } : null;
      }
    },
    dispose: () => input.dispose(),
  };
}

export async function createElementProvider(file: Blob): Promise<FrameProvider> {
  const url = URL.createObjectURL(file);
  const v = createVideoElement(url);
  await waitEvent(v, 'loadeddata', 15000).catch(async () => {
    if (v.readyState < 2) await waitEvent(v, 'canplay', 15000);
  });
  // iOS sometimes paints black frames until the element has played once (muted play is always allowed).
  try {
    await v.play();
    v.pause();
  } catch { /* ignore */ }
  return {
    async *frames(times) {
      for (const t of times) {
        await seekVideo(v, t, 10000);
        yield { image: v, width: v.videoWidth, height: v.videoHeight };
      }
    },
    dispose: () => {
      destroyVideoElement(v);
      URL.revokeObjectURL(url);
    },
  };
}
