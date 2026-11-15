// End-to-end tests for the studio modules. Each module edits a project through the UI,
// exports a real MP4, and inspects the file with ffmpeg to prove the edit is in the output.
// Usage: npm run build && node tests/e2e/studio.mjs [module ...]
import path from 'node:path';
import {
  baseFixtures, check, chromium, colorName, decodesClean, exportAndDownload, failures, ff, fixture, freq, isBlue, isGreen, lum,
  newPage, OUT, pixel, probe, region, rms, seekTo, setRange, startServer,
} from './lib.mjs';
import { MODULES } from './modules.mjs';

const only = process.argv.slice(2);
const [A, B, C] = baseFixtures();
const D = fixture('D_photo_yellow.png', (p) => ff('-f', 'lavfi', '-i', 'color=c=yellow:size=800x600', '-frames:v', '1', p));

async function importClips(page, files) {
  await page.getByTestId('import-first').waitFor();
  await page.getByTestId('file-input').first().setInputFiles(files);
  await page.getByTestId('clip-card').nth(files.length - 1).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function clipOrder(page) {
  return page.getByTestId('clip-card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').replace(/^Clip \d+: /, '')));
}

// ------------------------------------------------------------------ Module 1
async function moduleTimeline(browser) {
  console.log('\n▶ Module 1: timeline, trim, split, crop/rotate, transitions, reorder, photo clips');
  const { ctx, page, errors } = await newPage(browser);
  await importClips(page, [A, B, C, D]);
  check((await page.getByTestId('clip-card').count()) === 4, 'four items imported (3 videos + 1 photo)');
  await page.screenshot({ path: path.join(OUT, 'm1-0-studio.png') });

  // Trim clip 1 (A) to start at 1.0s.
  await page.getByTestId('clip-card').nth(0).click();
  await page.getByTestId('clip-panel').waitFor();
  await setRange(page, 'trim-in-slider', 1.0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'm1-1-clip-panel.png') });

  // Split clip B at timeline 3.0 (1.0s into B).
  await page.getByText('Done').click();
  await seekTo(page, 3.0);
  await page.getByTestId('split').first().click();
  await page.waitForTimeout(200);
  check((await page.getByTestId('clip-card').count()) === 5, 'split turns 4 clips into 5');

  // Rotate clip C (now 4th) by 45°.
  await page.getByTestId('clip-card').nth(3).click();
  await setRange(page, 'clip-rotate', 45);

  // Fade transition into clip 2.
  await page.getByTestId('clip-card').nth(1).click();
  await page.getByRole('radio', { name: 'Fade black' }).click();

  // Drag-reorder: move the photo (last) to the front, verify, then undo.
  const before = await clipOrder(page);
  const last = page.getByTestId('clip-card').nth(4);
  await last.click();
  const bb = await last.boundingBox();
  const firstBb = await page.getByTestId('clip-card').nth(0).boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 - 20, bb.y + bb.height / 2, { steps: 3 });
  await page.mouse.move(firstBb.x - 30, bb.y + bb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await clipOrder(page);
  check(after[0] === before[4], `drag moves the photo to the front (${after.join(', ')})`);
  await page.getByTestId('undo').click();
  await page.waitForTimeout(150);
  check(JSON.stringify(await clipOrder(page)) === JSON.stringify(before), 'undo restores the original order');

  // Timeline zoom works.
  const w1 = (await page.getByTestId('clip-card').nth(0).boundingBox()).width;
  await page.getByLabel('Zoom in timeline').click();
  const w2 = (await page.getByTestId('clip-card').nth(0).boundingBox()).width;
  check(w2 > w1 * 1.3, `timeline zoom in widens clips (${w1.toFixed(0)}px → ${w2.toFixed(0)}px)`);
  await page.screenshot({ path: path.join(OUT, 'm1-2-timeline.png') });

  const file = await exportAndDownload(page, 'm1-timeline');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();

  // ---- Inspect the MP4 ----
  const info = probe(file);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const dur = parseFloat(info.format.duration);
  // A 2s (trimmed) + B 1s + B 1s + C 2s + photo 3s = 9s
  check(Math.abs(dur - 9) < 0.15, `duration reflects trim + split + photo = 9.0s (${dur.toFixed(2)}s)`);
  check(Math.abs(parseInt(v.nb_frames, 10) - 270) <= 1, `frame count 270 (${v.nb_frames})`);
  check(decodesClean(file), 'file decodes with zero errors');
  // Trim: output t=0.5 must show source t=1.5 of A.
  const o = pixel(file, 0.5, Math.round(540 + (730 - 640) * (1920 / 720)), Math.round(960 + (330 - 360) * (1920 / 720)));
  const s = pixel(A, 1.5, 730, 330);
  check(Math.max(...o.map((x, i) => Math.abs(x - s[i]))) < 30, `trim: output 0.5s shows source 1.5s (out ${o} vs src ${s})`);
  // Fade transition: just before the 2.0s cut the picture is nearly black.
  const fadeL = lum(region(file, 1.97, 340, 760, 400, 400));
  const normalL = lum(region(file, 1.0, 340, 760, 400, 400));
  check(fadeL < 25 && normalL > 60, `fade-to-black at the cut (luma ${fadeL.toFixed(0)} vs normal ${normalL.toFixed(0)})`);
  // Split clips both show B (green top half when rotated correctly).
  check(isGreen(pixel(file, 2.5, 540, 300)) && isGreen(pixel(file, 3.5, 540, 300)), 'both split halves show clip B');
  // Rotated 45°: centre blue, corner black.
  const centre = pixel(file, 5.0, 540, 960), corner = pixel(file, 5.0, 8, 8);
  check(isBlue(centre) && lum(corner) < 20, `45° rotation: centre ${colorName(centre)}, corner black (${corner})`);
  // Photo clip shows yellow.
  const y = pixel(file, 7.5, 540, 960);
  check(y[0] > 200 && y[1] > 200 && y[2] < 80, `photo clip appears (rgb ${y})`);
  // Sound follows the edit: A (440 Hz) for 0–2s, B (880 Hz) for 2–4s.
  const fA = freq(file, 0.2, 1.4), fB = freq(file, 2.4, 1.4);
  check(Math.abs(fA - 440) < 15 && Math.abs(fB - 880) < 25, `audio follows edits (${fA.toFixed(0)} Hz, ${fB.toFixed(0)} Hz)`);
  check(rms(file, 6.2, 8.8) < -60, 'photo section is silent');
}

const ALL = { timeline: moduleTimeline, ...MODULES };

const server = await startServer();
const browser = await chromium.launch();
try {
  for (const [name, fn] of Object.entries(ALL)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await fn(browser, { A, B, C, D, importClips });
    } catch (e) {
      console.error(e);
      check(false, `${name} module threw: ${e.message}`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n✘ ${failures} check(s) failed` : '\n✔ All studio checks passed');
process.exit(failures ? 1 : 0);
