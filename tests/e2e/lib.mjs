// Shared helpers for end-to-end tests.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
export const { chromium, devices } = pw;

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const FIX = path.join(ROOT, 'tests/e2e/fixtures');
export const OUT = path.join(ROOT, 'tests/e2e/output');
export const BASE = 'http://localhost:4180/ai-business-video-editor/';
mkdirSync(FIX, { recursive: true });
mkdirSync(OUT, { recursive: true });

export const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
export const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());

export let failures = 0;
export function check(cond, msg) {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
  return cond;
}

export function fixture(name, make) {
  const p = path.join(FIX, name);
  if (!existsSync(p)) make(p);
  return p;
}

/** Standard fixtures used by both suites. */
export function baseFixtures() {
  const a = fixture('A_landscape_440hz.mp4', (p) => ff('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p));
  const b = fixture('B_iphone_portrait_880hz.mov', (p) => {
    const tmp = path.join(FIX, 'b_tmp.mp4');
    ff('-f', 'lavfi', '-i', 'color=c=red:size=1280x720:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2:sample_rate=48000',
      '-vf', 'drawbox=x=640:y=0:w=640:h=720:color=lime:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', tmp);
    ff('-display_rotation', '90', '-i', tmp, '-c', 'copy', p);
  });
  const c = fixture('C_square_silent.mp4', (p) => ff('-f', 'lavfi', '-i', 'color=c=blue:size=1080x1080:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p));
  return [a, b, c];
}

export function pixel(file, t, x, y) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-vf', `scale=iw:ih,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [buf[0], buf[1], buf[2]];
}
/** Mean RGB of a region. */
export function region(file, t, x, y, w, h) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-vf', `scale=iw:ih,crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const s = [0, 0, 0];
  for (let i = 0; i < buf.length; i += 3) { s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; }
  const n = buf.length / 3;
  return s.map((v) => v / n);
}
export const isRed = ([r, g, b]) => r > 170 && g < 80 && b < 80;
export const isGreen = ([r, g, b]) => g > 170 && r < 80 && b < 80;
export const isBlue = ([r, g, b]) => b > 170 && r < 80 && g < 80;
export const colorName = (p) => (isRed(p) ? 'red' : isGreen(p) ? 'green' : isBlue(p) ? 'blue' : `rgb(${p.map((v) => Math.round(v))})`);
export const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

export function rms(file, from, to) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', file, '-vn',
    '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-']);
  const m = r.stderr.toString().match(/RMS level dB:\s*(-?[\d.]+|-inf)/);
  return m ? (m[1] === '-inf' ? -Infinity : parseFloat(m[1])) : NaN;
}

export function freq(file, from, dur) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(from), '-t', String(dur), '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const s = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  let z = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) z++;
  return (z / 2) / (s.length / 48000);
}

export function decodesClean(file) {
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  return dec.status === 0 && dec.stderr.toString().trim() === '';
}

export async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', '4180', '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) return proc; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error('Preview server did not start (did you run npm run build?)');
}

/** Set a React-controlled <input type=range> by test id. */
export async function setRange(page, testId, value) {
  await page.getByTestId(testId).first().evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

export async function seekTo(page, t) {
  await page.getByLabel('Playhead position').evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
  await page.waitForTimeout(250);
}

/** Open export, run it with the given choices, download and return the file path. */
export async function exportAndDownload(page, label, choices = {}) {
  await page.getByTestId('open-export').click();
  await page.getByTestId('start-export').waitFor();
  for (const [group, text] of Object.entries(choices)) {
    await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: new RegExp('^' + text) }).click();
  }
  const t0 = Date.now();
  await page.getByTestId('start-export').click();
  await Promise.race([
    page.getByTestId('export-done').waitFor({ timeout: 300000 }),
    page.getByTestId('export-error').waitFor({ timeout: 300000 }).then(async () => {
      throw new Error('Export failed in app: ' + (await page.getByTestId('export-error').textContent()));
    }),
  ]);
  console.log(`  … export took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  const download = await dl;
  const outFile = path.join(OUT, `${label}.mp4`);
  await download.saveAs(outFile);
  await page.getByLabel('Close').click();
  return outFile;
}

export async function newPage(browser, query = '') {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + query);
  return { ctx, page, errors };
}

/** Raw RGB of a region → { frac(pred), centroidX(pred) }. */
export function regionStats(file, t, x, y, w, h) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-vf', `scale=iw:ih,crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const px = (i) => [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
  const n = buf.length / 3;
  return {
    frac(pred) { let c = 0; for (let i = 0; i < n; i++) if (pred(px(i))) c++; return c / n; },
    centroidX(pred) { let s = 0, c = 0; for (let i = 0; i < n; i++) if (pred(px(i))) { s += x + (i % w); c++; } return c ? s / c : NaN; },
  };
}
export const isWhite = ([r, g, b]) => r > 225 && g > 225 && b > 225;
