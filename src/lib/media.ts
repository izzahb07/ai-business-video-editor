import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset } from '../types';
import { uid } from './defaults';
import { createVideoElement, destroyVideoElement, seekVideo, waitEvent } from './registry';

export const AUDIO_RATE = 48000;

/** Debug switch used by tests: ?forceFallback=1 pretends WebCodecs decoding is unavailable. */
export const FORCE_FALLBACK =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('forceFallback');

export function guessKind(file: Blob, name: string): 'video' | 'audio' | 'image' {
  const t = file.type || '';
  if (t.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|svg)$/i.test(name)) return 'image';
  if (t.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|caf)$/i.test(name)) return 'audio';
  return 'video';
}

/** Read basic information about a media file without loading it all into memory. */
export async function probeFile(file: File | Blob, name: string): Promise<Asset> {
  const id = uid();
  const kind = guessKind(file, name);
  const base = { id, kind, name, size: file.size, mime: file.type || 'video/mp4', stored: false } as const;

  if (kind === 'image') {
    const bmp = await createImageBitmap(file).catch(() => { throw new Error('This image format is not supported.'); });
    const thumb = drawThumb(bmp, bmp.width, bmp.height, 'image/png');
    const out: Asset = { ...base, duration: 0, width: bmp.width, height: bmp.height, codec: null, hasAudio: false, webCodecsDecodable: false, thumb };
    bmp.close();
    return out;
  }
  if (kind === 'audio') {
    const buf = await decodeAudio(file);
    if (!buf) throw new Error('Could not read this audio file.');
    return { ...base, duration: buf.duration, width: 0, height: 0, codec: null, hasAudio: true, webCodecsDecodable: false, thumb: '' };
  }

  // Path 1: Mediabunny (reads the container directly).
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new Error('This file has no video track.');
      const at = await input.getPrimaryAudioTrack();
      const first = await vt.getFirstTimestamp();
      const end = await vt.computeDuration();
      const duration = Math.max(0, end - first);
      const rotation = await vt.getRotation();
      const sw = await vt.getSquarePixelWidth();
      const sh = await vt.getSquarePixelHeight();
      const rotated = rotation === 90 || rotation === 270;
      const width = rotated ? sh : sw;
      const height = rotated ? sw : sh;
      const codec = await vt.getCodec();
      const decodable = !FORCE_FALLBACK && (await vt.canDecode());

      let thumb = '';
      if (decodable) {
        try {
          const sink = new CanvasSink(vt, { width: 240, fit: 'contain' });
          const wc = await sink.getCanvas(first + Math.min(0.5, duration / 2));
          if (wc) thumb = await canvasToDataUrl(wc.canvas);
        } catch { /* fall through to element thumbnail */ }
      }
      if (!thumb) thumb = await elementThumbnail(file, Math.min(0.5, duration / 2)).catch(() => '');

      if (duration <= 0) throw new Error('Video has zero length.');
      return { ...base, duration, width, height, codec, hasAudio: !!at, webCodecsDecodable: decodable, thumb };
    } finally {
      input.dispose();
    }
  } catch (err) {
    if (err instanceof Error && /no video track/.test(err.message)) throw err;
    console.warn('Mediabunny probe failed, using <video> element instead', err);
  }

  // Path 2: let Safari's own player read it.
  const url = URL.createObjectURL(file);
  const v = createVideoElement(url);
  try {
    await waitEvent(v, 'loadedmetadata');
    const duration = v.duration;
    if (!isFinite(duration) || duration <= 0) throw new Error('Could not read the video length.');
    const t = Math.min(0.5, duration / 2);
    await seekVideo(v, t);
    const thumb = drawThumb(v, v.videoWidth, v.videoHeight);
    return {
      ...base,
      duration,
      width: v.videoWidth,
      height: v.videoHeight,
      codec: null,
      hasAudio: true, // unknown; audio decode will tell us
      webCodecsDecodable: false,
      thumb,
    };
  } finally {
    destroyVideoElement(v);
    URL.revokeObjectURL(url);
  }
}

async function elementThumbnail(file: Blob, t: number): Promise<string> {
  const url = URL.createObjectURL(file);
  const v = createVideoElement(url);
  try {
    await seekVideo(v, t);
    return drawThumb(v, v.videoWidth, v.videoHeight);
  } finally {
    destroyVideoElement(v);
    URL.revokeObjectURL(url);
  }
}

function drawThumb(src: CanvasImageSource, w: number, h: number, type = 'image/jpeg'): string {
  const c = document.createElement('canvas');
  const s = 240 / Math.max(w, h);
  c.width = Math.max(2, Math.round(w * s));
  c.height = Math.max(2, Math.round(h * s));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  const out = c.toDataURL(type, 0.7);
  c.width = c.height = 0;
  return out;
}

async function canvasToDataUrl(c: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  if (c instanceof HTMLCanvasElement) return c.toDataURL('image/jpeg', 0.7);
  return drawThumb(c, c.width, c.height);
}

/**
 * Decode a file's audio into one stereo AudioBuffer at 48 kHz, aligned so that
 * buffer time 0 = the first video frame. Returns null if the file has no audio.
 */
export async function decodeAudio(file: Blob): Promise<AudioBuffer | null> {
  // Path 1: WebCodecs (streams the file; does not load it all at once).
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const at = await input.getPrimaryAudioTrack();
      if (!at) return null;
      if (!FORCE_FALLBACK && (await at.canDecode())) {
        const vt = await input.getPrimaryVideoTrack();
        const origin = vt ? await vt.getFirstTimestamp() : await at.getFirstTimestamp();
        const sink = new AudioBufferSink(at);
        const rate = await at.getSampleRate();
        const chunks: { t: number; buf: AudioBuffer }[] = [];
        let endT = 0;
        for await (const wb of sink.buffers()) {
          chunks.push({ t: wb.timestamp - origin, buf: wb.buffer });
          endT = Math.max(endT, wb.timestamp - origin + wb.duration);
        }
        if (chunks.length === 0) return null;
        const length = Math.ceil(endT * rate);
        const L = new Float32Array(length);
        const R = new Float32Array(length);
        for (const { t, buf } of chunks) {
          const off = Math.round(t * rate);
          const l = buf.getChannelData(0);
          const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
          // Drop samples before the first video frame (negative offsets).
          const skip = off < 0 ? -off : 0;
          const n = Math.min(l.length - skip, length - Math.max(0, off));
          if (n <= 0) continue;
          L.set(l.subarray(skip, skip + n), Math.max(0, off));
          R.set(r.subarray(skip, skip + n), Math.max(0, off));
        }
        return await toStereo48k(L, R, rate);
      }
    } finally {
      input.dispose();
    }
  } catch (err) {
    console.warn('WebCodecs audio decode failed, trying decodeAudioData', err);
  }

  // Path 2: Web Audio's decoder (needs the whole file in memory briefly).
  const ab = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, AUDIO_RATE);
  try {
    const buf = await ctx.decodeAudioData(ab);
    const l = buf.getChannelData(0);
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
    return await toStereo48k(l, r, buf.sampleRate);
  } catch {
    return null; // no decodable audio
  }
}

async function toStereo48k(L: Float32Array, R: Float32Array, rate: number): Promise<AudioBuffer> {
  if (rate === AUDIO_RATE) {
    const out = new AudioBuffer({ length: Math.max(1, L.length), numberOfChannels: 2, sampleRate: AUDIO_RATE });
    out.copyToChannel(L as Float32Array<ArrayBuffer>, 0);
    out.copyToChannel(R as Float32Array<ArrayBuffer>, 1);
    return out;
  }
  const src = new AudioBuffer({ length: Math.max(1, L.length), numberOfChannels: 2, sampleRate: rate });
  src.copyToChannel(L as Float32Array<ArrayBuffer>, 0);
  src.copyToChannel(R as Float32Array<ArrayBuffer>, 1);
  const outLen = Math.max(1, Math.ceil((L.length / rate) * AUDIO_RATE));
  const ctx = new OfflineAudioContext(2, outLen, AUDIO_RATE);
  const node = ctx.createBufferSource();
  node.buffer = src;
  node.connect(ctx.destination);
  node.start();
  return ctx.startRendering();
}
