// End-to-end test: builds real test videos, drives the app in a phone-sized browser,
// exports an MP4, and inspects the result with ffprobe/ffmpeg.
// Usage: npm run build && npm run e2e
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const { chromium, devices } = pw;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const FIX = path.join(ROOT, 'tests/e2e/fixtures');
const OUT = path.join(ROOT, 'tests/e2e/output');
mkdirSync(FIX, { recursive: true });
mkdirSync(OUT, { recursive: true });

const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
}

// ---------- 1. Fixtures ----------
function makeFixtures() {
  const a = path.join(FIX, 'A_landscape_440hz.mp4');
  const b = path.join(FIX, 'B_iphone_portrait_880hz.mov');
  const c = path.join(FIX, 'C_square_silent.mp4');
  if (!existsSync(a)) {
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', a);
  }
  if (!existsSync(b)) {
    // Coded landscape 1280x720: left half red, right half green; flagged as rotated like iPhone portrait video.
    const tmp = path.join(FIX, 'b_tmp.mp4');
    ff('-f', 'lavfi', '-i', 'color=c=red:size=1280x720:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2:sample_rate=48000',
      '-vf', 'drawbox=x=640:y=0:w=640:h=720:color=lime:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', tmp);
    ff('-display_rotation', '90', '-i', tmp, '-c', 'copy', b);
  }
  if (!existsSync(c)) {
    ff('-f', 'lavfi', '-i', 'color=c=blue:size=1080x1080:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', c);
  }
  return [a, b, c];
}

// RGB of a pixel (x,y) at time t in a video, as decoded (and auto-rotated) by ffmpeg.
function pixel(file, t, x, y) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-vf', `scale=iw:ih,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [buf[0], buf[1], buf[2]];
}
const isRed = ([r, g, b]) => r > 170 && g < 80 && b < 80;
const isGreen = ([r, g, b]) => g > 170 && r < 80 && b < 80;
const isBlue = ([r, g, b]) => b > 170 && r < 80 && g < 80;
const colorName = (p) => (isRed(p) ? 'red' : isGreen(p) ? 'green' : isBlue(p) ? 'blue' : `rgb(${p})`);

function rmsDb(file, from, to) {
  const out = execFileSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', file, '-vn',
    '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return out;
}
function rms(file, from, to) {
  try {
    const r = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', file, '-vn',
      '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-']);
    const m = r.stderr.toString().match(/RMS level dB:\s*(-?[\d.]+|-inf)/);
    return m ? (m[1] === '-inf' ? -Infinity : parseFloat(m[1])) : NaN;
  } catch { return NaN; }
}
void rmsDb;

// Dominant frequency estimate via zero crossings of the left channel.
function freq(file, from, dur) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(from), '-t', String(dur), '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const s = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  let z = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) z++;
  return (z / 2) / (s.length / 48000);
}

// ---------- 2. Server ----------
async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', '4180', '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch('http://localhost:4180/'); if (r.ok) return proc; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error('Preview server did not start (did you run npm run build?)');
}

// ---------- 3. Browser flow ----------
async function runFlow(browser, files, { query = '', label, checkPersistence = false }) {
  console.log(`\n▶ ${label}`);
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://localhost:4180/${query}`);
  await page.getByTestId('import-first').waitFor();
  await page.screenshot({ path: path.join(OUT, `${label}-0-empty.png`) });

  await page.getByTestId('file-input').first().setInputFiles(files);
  await page.getByTestId('clip-card').nth(2).waitFor({ timeout: 30000 });
  check((await page.getByTestId('clip-card').count()) === 3, 'three clips imported');
  await page.waitForTimeout(1500); // let audio decoding & storage finish
  await page.screenshot({ path: path.join(OUT, `${label}-1-imported.png`) });

  // Preview playback advances time and paints a non-black frame.
  await page.getByTestId('play').click();
  await page.waitForTimeout(1200);
  await page.getByTestId('play').click();
  const tc = await page.getByTestId('timecode').textContent();
  check(tc !== '0:00.0', `preview playback advanced (timecode ${tc})`);
  const lum = await page.getByTestId('preview-canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0; for (let i = 0; i < d.length; i += 400) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 400) / 3;
  });
  check(lum > 20, `preview canvas shows video (avg brightness ${lum.toFixed(0)})`);

  // Undo/redo with a delete.
  await page.getByTestId('clip-card').nth(1).click();
  await page.getByTestId('clip-panel').waitFor();
  await page.screenshot({ path: path.join(OUT, `${label}-2-clip-panel.png`) });
  await page.getByTestId('delete-clip').click();
  check((await page.getByTestId('clip-card').count()) === 2, 'delete removes a clip');
  await page.getByTestId('undo').click();
  check((await page.getByTestId('clip-card').count()) === 3, 'undo restores it');
  await page.getByTestId('redo').click();
  check((await page.getByTestId('clip-card').count()) === 2, 'redo deletes again');
  await page.getByTestId('undo').click();

  if (checkPersistence) {
    await page.waitForTimeout(1000);
    await page.reload();
    await page.getByTestId('clip-card').nth(2).waitFor({ timeout: 20000 });
    check((await page.getByTestId('clip-card').count()) === 3, 'project restored after reload (saved on device)');
    await page.waitForTimeout(1500);
  }

  // Device check sheet.
  await page.getByTestId('info').click();
  await page.locator('[data-testid=caps] li .dot').first().waitFor();
  await page.screenshot({ path: path.join(OUT, `${label}-3-info.png`) });
  await page.getByLabel('Close').click();

  // Export.
  await page.getByTestId('open-export').click();
  await page.getByTestId('start-export').waitFor();
  await page.screenshot({ path: path.join(OUT, `${label}-4-export-settings.png`) });
  const t0 = Date.now();
  await page.getByTestId('start-export').click();
  await page.getByTestId('export-progress').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${label}-5-exporting.png`) });
  await Promise.race([
    page.getByTestId('export-done').waitFor({ timeout: 180000 }),
    page.getByTestId('export-error').waitFor({ timeout: 180000 }).then(async () => {
      throw new Error('Export failed in app: ' + (await page.getByTestId('export-error').textContent()));
    }),
  ]);
  console.log(`  … export took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.screenshot({ path: path.join(OUT, `${label}-6-done.png`) });

  const dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  const download = await dl;
  const outFile = path.join(OUT, `${label}.mp4`);
  await download.saveAs(outFile);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
  return outFile;
}

// ---------- 4. Verify output ----------
function verify(file, fixtures) {
  console.log(`  Inspecting ${path.basename(file)} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
  const info = probe(file);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  check(/mp4/.test(info.format.format_name), `container is MP4 (${info.format.format_name})`);
  check(v?.codec_name === 'h264', `video codec H.264 (${v?.codec_name}, ${v?.profile})`);
  check(v?.width === 1080 && v?.height === 1920, `size 1080x1920 (${v?.width}x${v?.height})`);
  check(v?.avg_frame_rate === '30/1', `frame rate 30 (${v?.avg_frame_rate})`);
  check(/^yuvj?420p$/.test(v?.pix_fmt), `pixel format 4:2:0 (${v?.pix_fmt})`);
  check(a?.codec_name === 'aac', `audio codec AAC (${a?.codec_name})`);
  const dur = parseFloat(info.format.duration);
  check(Math.abs(dur - 7) < 0.15, `duration ≈ 7.0s (${dur.toFixed(3)}s)`);
  const nb = parseInt(v?.nb_frames || '0', 10);
  check(Math.abs(nb - 210) <= 1, `frame count ≈ 210 (${nb})`);

  // Full decode must be error-free.
  const dec = require('node:child_process').spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  check(dec.status === 0 && dec.stderr.toString().trim() === '', 'file decodes with zero errors');

  // Clip B: ffmpeg's own auto-rotation is the ground truth for which colour is on top.
  const [, fixB] = fixtures;
  const truthTop = colorName(pixel(fixB, 1, 360, 200));
  const truthBottom = colorName(pixel(fixB, 1, 360, 1080));
  const outTop = colorName(pixel(file, 4.0, 540, 300));
  const outBottom = colorName(pixel(file, 4.0, 540, 1620));
  check(truthTop !== truthBottom, `fixture B is split top/bottom when rotated (${truthTop}/${truthBottom})`);
  check(outTop === truthTop && outBottom === truthBottom, `iPhone rotation applied correctly (top ${outTop}, bottom ${outBottom})`);

  const c = pixel(file, 6.0, 540, 960);
  check(isBlue(c), `clip C (blue) appears at 6s (${colorName(c)})`);
  // Clip A: Fill scales 1280x720 by 2.667 around the centre. Sample inside two colour bars (not on the boundary)
  // and compare with the source clip's own pixels at the same moment.
  for (const [sx, sy] of [[550, 330], [730, 330]]) {
    const ox = Math.round(540 + (sx - 640) * (1920 / 720)), oy = Math.round(960 + (sy - 360) * (1920 / 720));
    const o = pixel(file, 1.5, ox, oy), src = pixel(fixtures[0], 1.5, sx, sy);
    const diff = Math.max(...o.map((v, i) => Math.abs(v - src[i])));
    check(diff < 30, `clip A colour matches source at (${sx},${sy}): out rgb(${o}) vs source rgb(${src})`);
  }

  // Sound: A=440Hz, B=880Hz, C silent.
  const fA = freq(file, 0.5, 2), fB = freq(file, 3.3, 1.4);
  check(Math.abs(fA - 440) < 15, `clip A audio is 440 Hz (${fA.toFixed(0)} Hz)`);
  check(Math.abs(fB - 880) < 25, `clip B audio is 880 Hz (${fB.toFixed(0)} Hz)`);
  const sil = rms(file, 5.2, 6.8);
  check(sil < -60, `clip C section is silent (${sil} dB)`);
  const loud = rms(file, 0.5, 2.5);
  check(loud > -30, `clip A section has sound (${loud.toFixed(1)} dB)`);
}

// ---------- main ----------
const fixtures = makeFixtures();
const server = await startServer();
const browser = await chromium.launch();
try {
  const f1 = await runFlow(browser, fixtures, { label: 'webcodecs', checkPersistence: true });
  verify(f1, fixtures);
  const f2 = await runFlow(browser, fixtures, { label: 'fallback', query: '?forceFallback=1' });
  verify(f2, fixtures);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n✘ ${failures} check(s) failed` : '\n✔ All end-to-end checks passed');
process.exit(failures ? 1 : 0);
