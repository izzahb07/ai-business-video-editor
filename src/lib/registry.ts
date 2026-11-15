/**
 * Runtime-only media resources that must not live in React state:
 * original file Blobs, object URLs, decoded audio, and a small pool of <video> elements.
 */

const files = new Map<string, Blob>();
const urls = new Map<string, string>();
const audio = new Map<string, AudioBuffer | null>();
const audioPending = new Map<string, Promise<AudioBuffer | null>>();

export function setFile(assetId: string, blob: Blob) {
  files.set(assetId, blob);
}
export function getFile(assetId: string): Blob | undefined {
  return files.get(assetId);
}
export function getUrl(assetId: string): string | undefined {
  const f = files.get(assetId);
  if (!f) return undefined;
  let u = urls.get(assetId);
  if (!u) {
    u = URL.createObjectURL(f);
    urls.set(assetId, u);
  }
  return u;
}

export function setAudio(assetId: string, buf: AudioBuffer | null) {
  audio.set(assetId, buf);
}
export function getAudio(assetId: string): AudioBuffer | null | undefined {
  return audio.get(assetId);
}
export function setAudioPending(assetId: string, p: Promise<AudioBuffer | null>) {
  audioPending.set(assetId, p);
  p.finally(() => audioPending.delete(assetId));
}
/** Resolves with the decoded audio once available (null = no audio / failed). */
export async function waitForAudio(assetId: string): Promise<AudioBuffer | null> {
  if (audio.has(assetId)) return audio.get(assetId) ?? null;
  const p = audioPending.get(assetId);
  return p ? p : null;
}

// ---------- <video> element pool (iOS limits how many can be active at once) ----------

const POOL_MAX = 4;
const pool = new Map<string, HTMLVideoElement>(); // insertion order = LRU order
let host: HTMLDivElement | null = null;

function getHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    // Must stay in the DOM and not fully transparent, or iOS may stop updating frames.
    host.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(host);
  }
  return host;
}

export function createVideoElement(src: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = src;
  v.style.cssText = 'width:2px;height:2px';
  getHost().appendChild(v);
  return v;
}

export function destroyVideoElement(v: HTMLVideoElement) {
  v.pause();
  v.removeAttribute('src');
  v.load();
  v.remove();
}

export function getPooledVideo(assetId: string): HTMLVideoElement | null {
  let v = pool.get(assetId);
  if (v) {
    pool.delete(assetId);
    pool.set(assetId, v);
    return v;
  }
  const src = getUrl(assetId);
  if (!src) return null;
  v = createVideoElement(src);
  pool.set(assetId, v);
  while (pool.size > POOL_MAX) {
    const [oldId, oldV] = pool.entries().next().value as [string, HTMLVideoElement];
    pool.delete(oldId);
    destroyVideoElement(oldV);
  }
  return v;
}

export function clearRegistry() {
  for (const v of pool.values()) destroyVideoElement(v);
  pool.clear();
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  files.clear();
  audio.clear();
  audioPending.clear();
}

/** Wait for a media element event with timeout. */
export function waitEvent(el: HTMLMediaElement, ev: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error(`Video failed to load (${el.error?.message || 'unknown error'})`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for video "${ev}"`)); }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(ev, onOk);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener(ev, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

/** Seek a video element precisely and wait until the frame is ready. */
export async function seekVideo(v: HTMLVideoElement, t: number, timeoutMs = 8000): Promise<void> {
  if (v.readyState < 1) await waitEvent(v, 'loadedmetadata', timeoutMs);
  const target = Math.min(Math.max(0, t), Math.max(0, (v.duration || t) - 0.001));
  if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) return;
  const p = waitEvent(v, 'seeked', timeoutMs);
  v.currentTime = target;
  await p;
}
