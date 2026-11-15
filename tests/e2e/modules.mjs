// Studio module tests (captions, colour, graphics, audio, AI). Imported by studio.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { check, decodesClean, exportAndDownload, lum, newPage, OUT, pixel, probe, region, rms, seekTo, setRange } from './lib.mjs';
import { startAiServer } from './mockServer.mjs';

async function download(page, trigger, name) {
  const dl = page.waitForEvent('download');
  await trigger();
  const d = await dl;
  const p = path.join(OUT, name);
  await d.saveAs(p);
  return readFileSync(p, 'utf8');
}

async function connectServer(page, srv) {
  await page.getByTestId('info').click();
  await page.getByTestId('svc-url').fill(srv.url);
  await page.getByTestId('svc-pass').fill(srv.passcode);
  await page.getByTestId('svc-test').click();
  await page.getByTestId('svc-status').filter({ hasText: 'Connected' }).waitFor({ timeout: 10000 });
  const st = await page.getByTestId('svc-status').textContent();
  await page.getByLabel('Close').click();
  return st;
}

// ------------------------------------------------------------------ Module 2: captions
const WORDS = [
  { text: 'Hello', start: 0.2, end: 0.5 }, { text: 'world.', start: 0.5, end: 0.9 },
  { text: 'This', start: 1.2, end: 1.4 }, { text: 'is', start: 1.4, end: 1.5 }, { text: 'a', start: 1.5, end: 1.6 }, { text: 'test.', start: 1.6, end: 2.0 },
  { text: 'Selamat', start: 2.2, end: 2.5 }, { text: 'datang', start: 2.5, end: 2.8 },
];

async function moduleCaptions(browser, { A, C, importClips }) {
  console.log('\n▶ Module 2: transcription, caption editor, styles, SRT, burned-in captions');
  const srv = await startAiServer({ words: WORDS, hooksResult: {} });
  const { ctx, page, errors } = await newPage(browser);
  try {
    await importClips(page, [A, C]);
    const st = await connectServer(page, srv);
    check(/Transcription: ready/.test(st), `app connects to the AI server (${st})`);

    await page.getByTestId('tab-captions').click();
    await page.getByRole('radio', { name: 'English' }).click();
    await page.getByRole('radio', { name: 'My AI server' }).click();
    await page.getByTestId('transcribe').click();
    await page.getByTestId('consent-audio').click(); // explicit consent before upload
    await page.getByTestId('caption-item').nth(2).waitFor({ timeout: 30000 });
    const n = await page.getByTestId('caption-item').count();
    check(n === 3, `transcript grouped into 3 caption lines (${n})`);
    const req = srv.log.transcribe[0];
    check(!!req && req.rate === 16000 && req.channels === 1 && Math.abs(req.bytes - (44 + 3 * 16000 * 2)) < 4000,
      `server received only audio: mono 16 kHz WAV of the 3 s clip (${req?.bytes} bytes)`);
    check(srv.log.transcribe.length === 1, `only the clip with sound was sent (${srv.log.transcribe.length} upload)`);
    check(req?.language === 'en', 'chosen language sent to the provider');

    // Edit a caption's text.
    await page.getByTestId('caption-text').nth(1).fill('This is a TEST.');
    // Choose a template with a background box (easy to detect in the video).
    await page.getByTestId('template-boxed').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'm2-captions.png') });

    let srt = await download(page, () => page.getByRole('button', { name: 'Download .srt' }).click(), 'm2-1.srt');
    check(/1\n00:00:00,200 --> 00:00:01,200\nHello world\./.test(srt), 'SRT cue 1 has correct text and timing');
    check(srt.includes('This is a TEST.'), 'SRT contains the edited text');

    // Burned-in captions: export with and without, compare the caption band.
    const withCaps = await exportAndDownload(page, 'm2-with-captions', { Resolution: '720p' });
    await page.getByTestId('captions-enabled').evaluate((el) => el.click());
    const noCaps = await exportAndDownload(page, 'm2-no-captions', { Resolution: '720p' });
    await page.getByTestId('captions-enabled').evaluate((el) => el.click());
    const band = (f, t) => region(f, t, 230, 900, 260, 40);
    const a = band(withCaps, 1.5), b = band(noCaps, 1.5);
    const diff = Math.abs(lum(a) - lum(b));
    check(diff > 25, `caption burned into the MP4 at 1.5s (band luma ${lum(a).toFixed(0)} vs ${lum(b).toFixed(0)})`);
    const quiet = Math.abs(lum(band(withCaps, 1.05)) - lum(band(noCaps, 1.05)));
    check(quiet > 25, 'previous caption stays on screen until the next phrase starts (no flicker gap)');
    check(decodesClean(withCaps), 'captioned file decodes with zero errors');

    // Sync after editing: trim clip 1 to start at 1.0 s → captions move with the speech.
    await page.getByTestId('tab-edit').click();
    await page.getByTestId('clip-card').nth(0).click();
    await setRange(page, 'trim-in-slider', 1.0);
    await page.getByTestId('tab-captions').click();
    srt = await download(page, () => page.getByRole('button', { name: 'Download .srt' }).click(), 'm2-2.srt');
    check(!srt.includes('Hello world') && /1\n00:00:00,200 --> /.test(srt) && srt.split('\n')[2] === 'This is a TEST.',
      'after trimming 1 s, captions stay in sync (first cue now at 0.2 s)');

    // Manual caption.
    await seekTo(page, 2.5);
    await page.getByTestId('add-caption').click();
    check((await page.getByTestId('caption-item').count()) === 4, 'manual caption added (3 transcript lines kept, 1 marked "not in edit", + 1 manual)');
    check((await page.getByText('not in edit').count()) === 1, 'caption trimmed out of the edit is flagged, not deleted');

    // On-device engine fails honestly when the model can't be downloaded (no network in this test env).
    await page.getByRole('radio', { name: 'On this device' }).click();
    await page.getByTestId('transcribe').click();
    const failed = await page.getByText(/Transcription failed/).waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
    check(failed, 'on-device engine reports a clear error when the speech model cannot be downloaded (no fake captions)');
    check(errors.filter((e) => !/Failed to load resource|net::|fetch|huggingface|onnx|wasm|Transcription failed|ERR_/i.test(e)).length === 0,
      `no unexpected page errors${errors.length ? ' (' + errors.length + ' network errors from blocked model download)' : ''}`);
  } finally {
    await ctx.close();
    srv.close();
  }
}

// ------------------------------------------------------------------ Module 3: colour
async function moduleColor(browser, { A, B, C, importClips }) {
  console.log('\n▶ Module 3: colour grading, presets, LUT import, before/after');
  const { writeFileSync } = await import('node:fs');
  const lutPath = path.join(OUT, 'swap-red-blue.cube');
  const rows = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`);
  writeFileSync(lutPath, `TITLE "swap"\nLUT_3D_SIZE 2\n${rows.join('\n')}\n`);
  const { ctx, page, errors } = await newPage(browser);
  try {
    await importClips(page, [C, A, B]);
    await page.getByTestId('tab-color').click();
    // Clip 1 (blue square): Classic B&W preset.
    await page.getByTestId('clip-card').nth(0).click();
    await page.getByTestId('tab-color').click();
    await page.getByTestId('preset-black-white').click();
    // Clip 2 (test pattern): strong cool temperature.
    await page.getByTestId('clip-card').nth(1).click();
    await setRange(page, 'grade-temperature', -100);
    // Clip 3 (red/green): import a LUT that swaps red and blue.
    await page.getByTestId('clip-card').nth(2).click();
    await page.getByRole('button', { name: 'LUT (.cube)' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('import-lut').click();
    await (await chooser).setFiles(lutPath);
    await page.getByText(/LUT "swap-red-blue.cube" applied/).waitFor({ timeout: 5000 });
    // Before/after on (must not affect export).
    await page.getByTestId('clip-card').nth(0).click();
    await page.getByTestId('compare').evaluate((el) => el.click());
    await page.waitForTimeout(300);
    const split = await page.getByTestId('preview-canvas').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const px = (x, y) => { const i = (Math.floor(y) * c.width + Math.floor(x)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      return { left: px(c.width * 0.25, c.height / 2), right: px(c.width * 0.75, c.height / 2) };
    });
    check(split.left[2] > 150 && Math.abs(split.right[0] - split.right[2]) < 20, `before/after preview: left original (${split.left}), right graded (${split.right})`);
    await page.screenshot({ path: path.join(OUT, 'm3-color.png') });
    const file = await exportAndDownload(page, 'm3-color', { Resolution: '720p' });
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

    // 720x1280 output: clip1 0–2s, clip2 2–5s, clip3 5–7s
    const bw = pixel(file, 1.0, 100, 640), bw2 = pixel(file, 1.0, 620, 640);
    check(Math.max(...bw) - Math.min(...bw) < 12 && Math.max(...bw2) - Math.min(...bw2) < 12, `B&W preset: blue clip becomes grey on both halves (${bw} / ${bw2})`);
    const yGraded = pixel(file, 3.5, Math.round(360 + (550 - 640) * (1280 / 720)), Math.round(640 + (330 - 360) * (1280 / 720)));
    const ySrc = pixel(A, 1.5, 550, 330);
    check(yGraded[2] > ySrc[2] + 20 && yGraded[0] < ySrc[0] - 25, `temperature −100 cools the yellow bar (src ${ySrc} → ${yGraded})`);
    const top = pixel(file, 6.0, 360, 200), bottom = pixel(file, 6.0, 360, 1080);
    check(top[1] > 170 && bottom[2] > 170 && bottom[0] < 80, `LUT swaps red→blue (top ${top}, bottom ${bottom})`);
    check(decodesClean(file), 'graded file decodes with zero errors');
  } finally {
    await ctx.close();
  }
}

export const MODULES = { captions: moduleCaptions, color: moduleColor };
