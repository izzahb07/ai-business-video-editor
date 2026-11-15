/** Honest checks of what this device/browser can actually do. */
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

export interface Capability {
  label: string;
  ok: boolean;
  detail: string;
}

export async function checkCapabilities(): Promise<Capability[]> {
  const out: Capability[] = [];
  const hasWebCodecs = typeof VideoEncoder !== 'undefined';
  out.push({
    label: 'Secure connection (HTTPS)',
    ok: window.isSecureContext,
    detail: window.isSecureContext ? 'OK' : 'Video encoding needs HTTPS. Open the app from its https:// link.',
  });
  out.push({
    label: 'Hardware video encoder (WebCodecs)',
    ok: hasWebCodecs,
    detail: hasWebCodecs ? 'Available' : 'Not available — update to iOS 16.4 or newer.',
  });
  let h264 = false;
  try {
    h264 = hasWebCodecs && (await canEncodeVideo('avc', { width: 1080, height: 1920, bitrate: 8e6 }));
  } catch { /* no */ }
  out.push({ label: 'H.264 export 1080×1920', ok: h264, detail: h264 ? 'Supported' : 'Not supported in this browser' });
  let aac = false;
  try {
    aac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 });
  } catch { /* no */ }
  out.push({
    label: 'AAC audio encoder',
    ok: true,
    detail: aac ? 'Built-in (fast)' : 'Uses bundled encoder (works, slightly slower)',
  });
  const canShare = typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([new Uint8Array(1)], 't.mp4', { type: 'video/mp4' })] });
  out.push({
    label: 'Save to Photos (Share sheet)',
    ok: !!canShare,
    detail: canShare ? 'Available' : 'Not available — use Download instead',
  });
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) {
      out.push({
        label: 'On-device storage',
        ok: true,
        detail: `${fmtBytes(est.usage ?? 0)} used of ~${fmtBytes(est.quota)}`,
      });
    }
  } catch { /* ignore */ }
  return out;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtTime(sec: number, withTenths = false): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = withTenths ? s.toFixed(1).padStart(4, '0') : Math.floor(s).toString().padStart(2, '0');
  return `${m}:${ss}`;
}
