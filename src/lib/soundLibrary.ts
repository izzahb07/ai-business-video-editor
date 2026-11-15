/**
 * Built-in sounds, synthesised in the app (so they are royalty-free by construction).
 * Each sound renders once with Web Audio, is saved as a WAV asset, and reused.
 */
import type { Asset } from '../types';
import { useEditor } from '../store';
import { addMediaFile } from './projectIO';
import { encodeWav } from './transcribe/audioPrep';

const RATE = 48000;

export interface SoundDef {
  id: string;
  name: string;
  kind: 'sfx' | 'music';
  icon: string;
  duration: number;
  render: (ctx: OfflineAudioContext) => void;
}

function noise(ctx: BaseAudioContext, seconds: number): AudioBufferSourceNode {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}

function env(g: GainNode, pts: [number, number][]) {
  g.gain.setValueAtTime(pts[0][1], pts[0][0]);
  for (const [t, v] of pts.slice(1)) g.gain.linearRampToValueAtTime(v, t);
}

function tone(ctx: BaseAudioContext, type: OscillatorType, freq: number, t0: number, t1: number, gain: number, dest: AudioNode, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  const g = ctx.createGain();
  const a = Math.min(0.6, (t1 - t0) / 3);
  env(g, [[t0, 0], [t0 + a, gain], [t1 - a, gain], [t1, 0]]);
  o.connect(g).connect(dest);
  o.start(t0);
  o.stop(t1);
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export const SOUNDS: SoundDef[] = [
  {
    id: 'whoosh', name: 'Whoosh', kind: 'sfx', icon: '💨', duration: 0.7,
    render(ctx) {
      const n = noise(ctx, 0.7);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(3200, 0.35); bp.frequency.exponentialRampToValueAtTime(500, 0.7);
      const g = ctx.createGain();
      env(g, [[0, 0], [0.32, 0.9], [0.7, 0]]);
      n.connect(bp).connect(g).connect(ctx.destination);
      n.start(0);
    },
  },
  {
    id: 'swipe', name: 'Swipe', kind: 'sfx', icon: '➰', duration: 0.3,
    render(ctx) {
      const n = noise(ctx, 0.3);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2;
      bp.frequency.setValueAtTime(1500, 0); bp.frequency.exponentialRampToValueAtTime(7000, 0.25);
      const g = ctx.createGain();
      env(g, [[0, 0], [0.06, 0.8], [0.3, 0]]);
      n.connect(bp).connect(g).connect(ctx.destination);
      n.start(0);
    },
  },
  {
    id: 'pop', name: 'Pop', kind: 'sfx', icon: '🫧', duration: 0.18,
    render(ctx) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(950, 0); o.frequency.exponentialRampToValueAtTime(180, 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.17);
      o.connect(g).connect(ctx.destination);
      o.start(0); o.stop(0.18);
    },
  },
  {
    id: 'click', name: 'Click', kind: 'sfx', icon: '🖱', duration: 0.06,
    render(ctx) {
      const n = noise(ctx, 0.06);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.035);
      n.connect(hp).connect(g).connect(ctx.destination);
      n.start(0);
    },
  },
  {
    id: 'impact', name: 'Impact', kind: 'sfx', icon: '💥', duration: 1.3,
    render(ctx) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, 0); o.frequency.exponentialRampToValueAtTime(38, 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.001, 1.25);
      const n = noise(ctx, 0.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.7, 0); ng.gain.exponentialRampToValueAtTime(0.001, 0.4);
      const comp = ctx.createDynamicsCompressor();
      o.connect(g).connect(comp);
      n.connect(lp).connect(ng).connect(comp);
      comp.connect(ctx.destination);
      o.start(0); o.stop(1.3); n.start(0);
    },
  },
  {
    id: 'riser', name: 'Cinematic riser', kind: 'sfx', icon: '📈', duration: 2.5,
    render(ctx) {
      const n = noise(ctx, 2.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(400, 0); bp.frequency.exponentialRampToValueAtTime(6000, 2.45);
      const g = ctx.createGain();
      env(g, [[0, 0], [2.4, 0.7], [2.5, 0]]);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(880, 2.45);
      const og = ctx.createGain();
      env(og, [[0, 0], [2.4, 0.18], [2.5, 0]]);
      n.connect(bp).connect(g).connect(ctx.destination);
      o.connect(og).connect(ctx.destination);
      n.start(0); o.start(0); o.stop(2.5);
    },
  },
  {
    id: 'ding', name: 'Notification', kind: 'sfx', icon: '🔔', duration: 0.9,
    render(ctx) {
      for (const [f, t] of [[1318.5, 0], [1760, 0.12]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
        o.connect(g).connect(ctx.destination);
        o.start(t); o.stop(t + 0.78);
      }
    },
  },
  {
    id: 'room', name: 'Ambient room tone', kind: 'sfx', icon: '🌫', duration: 10,
    render(ctx) {
      const n = noise(ctx, 10);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 700;
      const g = ctx.createGain();
      env(g, [[0, 0], [1, 0.25], [9, 0.25], [10, 0]]);
      n.connect(lp).connect(g).connect(ctx.destination);
      n.start(0);
    },
  },
  {
    id: 'pad', name: 'Ambient pad (music bed)', kind: 'music', icon: '🎹', duration: 16,
    render(ctx) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      const master = ctx.createGain();
      master.gain.value = 0.16;
      lp.connect(master).connect(ctx.destination);
      const chords = [[48, 55, 59, 64], [45, 52, 57, 60], [41, 48, 52, 57], [43, 50, 55, 59]]; // Cmaj7 Am7 Fmaj7 G6
      chords.forEach((ch, i) => {
        const t0 = i * 4, t1 = t0 + 4.4;
        for (const n of ch) {
          tone(ctx, 'sawtooth', midi(n), t0, Math.min(16, t1), 0.25, lp, -6);
          tone(ctx, 'triangle', midi(n + 12), t0, Math.min(16, t1), 0.18, lp, 5);
        }
      });
    },
  },
  {
    id: 'pulse', name: 'Upbeat pulse (music bed)', kind: 'music', icon: '🥁', duration: 8,
    render(ctx) {
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const beat = 0.5; // 120 bpm
      for (let i = 0; i < 16; i++) {
        const t = i * beat;
        // kick
        const k = ctx.createOscillator();
        k.frequency.setValueAtTime(130, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.15);
        const kg = ctx.createGain();
        kg.gain.setValueAtTime(0.9, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        k.connect(kg).connect(master); k.start(t); k.stop(t + 0.32);
        // off-beat hat
        const h = noise(ctx, 0.06);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.25, t + beat / 2); hg.gain.exponentialRampToValueAtTime(0.001, t + beat / 2 + 0.05);
        h.connect(hp).connect(hg).connect(master); h.start(t + beat / 2);
        // bass
        const roots = [36, 33, 29, 31];
        tone(ctx, 'triangle', midi(roots[Math.floor(i / 4)]), t, t + beat * 0.9, 0.35, master);
      }
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1800;
      const pg = ctx.createGain(); pg.gain.value = 0.25;
      lp.connect(pg).connect(master);
      [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]].forEach((ch, i) => ch.forEach((n) => tone(ctx, 'sawtooth', midi(n), i * 2, i * 2 + 2, 0.12, lp)));
    },
  },
];

const pending = new Map<string, Promise<Asset>>();

/** Get (rendering once) the asset for a built-in sound. */
export function getSoundAsset(def: SoundDef): Promise<Asset> {
  const existing = Object.values(useEditor.getState().assets).find((a) => a.generated && a.name === def.name);
  if (existing) return Promise.resolve(existing);
  let p = pending.get(def.id);
  if (!p) {
    p = (async () => {
      const ctx = new OfflineAudioContext(1, Math.ceil(def.duration * RATE), RATE);
      def.render(ctx);
      const buf = await ctx.startRendering();
      const wav = encodeWav(buf.getChannelData(0), RATE);
      return addMediaFile(wav, def.name, { generated: true });
    })();
    pending.set(def.id, p);
    p.finally(() => pending.delete(def.id));
  }
  return p;
}

let previewCtx: AudioContext | null = null;
/** Audition a sound (tap). */
export async function previewSound(def: SoundDef) {
  if (!previewCtx) previewCtx = new AudioContext();
  await previewCtx.resume();
  const ctx = new OfflineAudioContext(1, Math.ceil(Math.min(def.duration, 6) * RATE), RATE);
  def.render(ctx);
  const buf = await ctx.startRendering();
  const s = previewCtx.createBufferSource();
  s.buffer = buf;
  s.connect(previewCtx.destination);
  s.start();
}
