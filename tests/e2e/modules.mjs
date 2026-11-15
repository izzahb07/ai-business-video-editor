// Studio module tests (captions, colour, graphics, audio, AI). Imported by studio.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { check, decodesClean, exportAndDownload, ff, fixture, isWhite, lum, newPage, OUT, pixel, probe, region, regionStats, rms, rmsFiltered, seekTo, setRange, silences } from './lib.mjs';
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

// ------------------------------------------------------------------ Module 4: motion graphics
async function moduleGraphics(browser, { A, C, importClips }) {
  console.log('\n▶ Module 4: animated text, keyframes, shapes, logo, picture-in-picture, templates');
  const logo = fixture('E_logo_green.png', (p) => ff('-f', 'lavfi', '-i', 'color=c=0x00ff00:size=200x200', '-frames:v', '1', p));
  const { ctx, page, errors } = await newPage(browser);
  const pick = async (testId, file) => {
    const ch = page.waitForEvent('filechooser');
    await page.getByTestId(testId).click();
    await (await ch).setFiles(file);
  };
  try {
    await importClips(page, [C, C]);
    await page.getByTestId('tab-text').click();
    await page.getByTestId('add-hook').click();
    await page.getByTestId('overlay-panel').waitFor();
    await page.getByText('Done').click();

    // Keyframed text: moves from left (x=20%) to right (x=80%).
    await seekTo(page, 0);
    await page.getByTestId('add-text').click();
    await page.getByTestId('overlay-text').fill('MOVE');
    await setRange(page, 'overlay-y', 70);
    await page.getByTestId('enable-keyframes').click();
    await setRange(page, 'overlay-x', 20);
    await seekTo(page, 2.5);
    await setRange(page, 'overlay-x', 80);
    const kfCount = await page.getByRole('button', { name: /^◆/ }).count();
    check(kfCount === 2, `two keyframes created (${kfCount})`);
    await page.screenshot({ path: path.join(OUT, 'm4-inspector.png') });
    await page.getByText('Done').click();

    await seekTo(page, 2.0);
    await page.getByTestId('add-circle').click();
    await page.getByText('Done').click();
    await pick('add-logo', logo);
    await page.getByTestId('overlay-panel').waitFor();
    await page.getByText('Done').click();
    await seekTo(page, 2.0);
    await pick('add-pip', A);
    await page.getByTestId('overlay-panel').waitFor();
    await setRange(page, 'overlay-y', 85);
    await page.getByText('Done').click();
    await page.getByTestId('add-intro').click();
    await page.getByText('Done').click();
    const bars = await page.getByTestId('overlay-bar').count();
    check(bars === 7, `graphics on the timeline: hook, text, circle, logo, PiP, intro title + subtitle (${bars})`);
    // Remove the intro (2 items) via undo to keep pixels below clean.
    await page.getByTestId('undo').click();
    await seekTo(page, 1.0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'm4-preview.png') });

    const file = await exportAndDownload(page, 'm4-graphics');
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

    const hookAt = (t) => regionStats(file, t, 60, 470, 460, 220).frac(isWhite);
    const h1 = hookAt(1.0), h0 = hookAt(0.04), h4 = hookAt(3.5);
    check(h1 > 0.04 && h4 < 0.005, `hook text visible 0–3 s, gone after (${(h1 * 100).toFixed(1)}% → ${(h4 * 100).toFixed(1)}%)`);
    check(h0 < h1 * 0.6, `hook pops in (first frame ${(h0 * 100).toFixed(1)}% vs ${(h1 * 100).toFixed(1)}%)`);
    const cx = (t) => regionStats(file, t, 0, 1264, 1080, 160).centroidX(isWhite);
    const x0 = cx(0.5), x1 = cx(2.45);
    check(x0 < 420 && x1 > 660, `keyframes move the text left → right (centre x ${x0.toFixed(0)} → ${x1.toFixed(0)})`);
    const reddish = ([r, g, b]) => r > 180 && g < 120 && b < 140;
    const ring = regionStats(file, 3.2, 300, 720, 480, 480).frac(reddish), ringEarly = regionStats(file, 1.5, 300, 720, 480, 480).frac(reddish);
    check(ring > 0.01 && ringEarly === 0, `circle appears at 2 s and not before (${(ringEarly * 100).toFixed(2)}% → ${(ring * 100).toFixed(2)}% red)`);
    const lg = pixel(file, 1.0, 907, 154);
    check(lg[1] > 200 && lg[0] < 60 && lg[2] < 60, `logo shown top-right (${lg})`);
    const notBlue = ([r, g, b]) => !(b > 200 && r < 60 && g < 60);
    const pip0 = regionStats(file, 1.0, 600, 1560, 340, 150).frac(notBlue), pip1 = regionStats(file, 3.2, 600, 1560, 340, 150).frac(notBlue);
    check(pip0 < 0.01 && pip1 > 0.5, `picture-in-picture video appears at 2 s (${(pip0 * 100).toFixed(1)}% → ${(pip1 * 100).toFixed(1)}% video pixels)`);
    check(decodesClean(file), 'file decodes with zero errors');
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ Module 5: audio
async function moduleAudio(browser, { A, C, importClips }) {
  console.log('\n▶ Module 5: music, sound effects, ducking, fades, event-matched SFX, import');
  const F = fixture('F_music_300hz.m4a', (p) => ff('-f', 'lavfi', '-i', 'sine=frequency=300:duration=4', '-c:a', 'aac', p));
  const { ctx, page, errors } = await newPage(browser);
  try {
    await importClips(page, [A, C, C]); // 3 s "speech" (440 Hz) + 4 s silence = 7 s
    await page.getByTestId('tab-audio').click();
    await page.getByTestId('add-sound-pad').click();
    await page.getByTestId('audio-panel').waitFor({ timeout: 15000 });
    check(await page.getByTestId('audio-duck').isChecked(), 'music ducking is on by default');
    await page.getByText('Done').click();
    await seekTo(page, 4.0);
    await page.getByTestId('add-sound-impact').click();
    await page.getByTestId('audio-panel').waitFor({ timeout: 15000 });
    await page.getByText('Done').click();

    let bars = await page.getByTestId('audio-bar').count();
    await page.getByTestId('whoosh-cuts').click();
    await page.waitForTimeout(1500);
    const afterWhoosh = await page.getByTestId('audio-bar').count();
    check(afterWhoosh === bars + 2, `whoosh placed on each of the 2 cuts (${afterWhoosh - bars})`);
    await page.getByTestId('undo').click();
    await page.waitForTimeout(200);

    const ch = page.waitForEvent('filechooser');
    await page.getByTestId('import-music').click();
    await (await ch).setFiles(F);
    await page.getByTestId('audio-panel').waitFor({ timeout: 15000 });
    check((await page.getByTestId('audio-bar').count()) === bars + 1, 'imported music appears on the music track');
    await page.getByTestId('delete-audio').click();
    bars = await page.getByTestId('audio-bar').count();
    check(bars === 2, `music + impact remain (${bars})`);
    await page.screenshot({ path: path.join(OUT, 'm5-audio.png') });

    const file = await exportAndDownload(page, 'm5-audio', { Resolution: '720p' });
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    const notch = 'bandreject=f=440:width_type=q:w=12,bandreject=f=440:width_type=q:w=12';
    const ducked = rmsFiltered(file, 0.6, 2.4, notch), open = rmsFiltered(file, 3.45, 3.95, notch);
    check(open > -40, `music is audible in the export (${open.toFixed(1)} dB)`);
    check(open - ducked > 8, `music ducks under speech (${ducked.toFixed(1)} dB while speaking vs ${open.toFixed(1)} dB)`);
    const hit = rms(file, 4.0, 4.3);
    check(hit > open + 6, `impact sound effect at 4.0 s (${hit.toFixed(1)} dB vs music ${open.toFixed(1)} dB)`);
    const end = rmsFiltered(file, 6.8, 6.98, notch);
    check(end < open - 12, `music fades out at the end (${end.toFixed(1)} dB)`);
    const speech = rmsFiltered(file, 0.6, 2.4, 'bandpass=f=440:width_type=q:w=12');
    check(speech > ducked, `speech stays on top of the music (${speech.toFixed(1)} dB vs ${ducked.toFixed(1)} dB)`);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ Module 6: AI smart editing + hooks
const HOOKS = {
  hooks: ['curiosity', 'problem-solution', 'emotional', 'controversial-truthful', 'educational', 'storytelling', 'question', 'curiosity', 'educational', 'question']
    .map((style, i) => ({ style, text: `Hook number ${i + 1}`, spoken: 'Say this', openingVisual: 'Show the before shot', why: 'Creates curiosity' })),
  bestHookIndex: 2,
  structure: [{ part: 'Hook', guidance: 'Open on the result', onScreenText: 'Wait for it' }, { part: 'Call to action', guidance: 'Ask to book', onScreenText: 'Book now' }],
  retentionTips: ['Cut every 2–3 seconds'], titles: ['Title A'], description: 'Desc', caption: 'Caption', hashtags: ['#clean'], cta: 'Book your slot today',
  claimsToVerify: ['"same-day service"'],
};

function talkingFixture() {
  return fixture('G_talking_with_pauses.mp4', (p) => ff(
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4', '-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=30:duration=4',
    '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*440*t)*(between(t,0,2)+between(t,3.5,5.5)+between(t,6.2,7.5))':s=48000:d=8",
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', p));
}

async function moduleAI(browser, { A, importClips }) {
  console.log('\n▶ Module 6: silence/dead-air removal, scene changes, repeated shots, accept/reject, AI hooks');
  const G = talkingFixture();
  const srv = await startAiServer({ words: [], hooksResult: HOOKS });
  const { ctx, page, errors } = await newPage(browser);
  const dur = async () => (await page.getByTestId('tl-time').textContent()).split('/')[1].trim();
  try {
    await importClips(page, [G, A, A]);
    check(await dur() === '0:14.0', `starting length 14.0 s (${await dur()})`);
    await page.getByTestId('tab-ai').click();
    await page.getByTestId('analyze').click();
    await page.getByTestId('accept-all-cuts').waitFor({ timeout: 60000 });
    const n = async (t) => page.getByTestId(`sugg-${t}`).count();
    const counts = { silence: await n('silence'), deadair: await n('deadair'), scene: await n('scene'), repeat: await n('repeat') };
    console.log('    suggestions:', JSON.stringify(counts));
    check(counts.silence === 2, `two pauses found inside speech (${counts.silence})`);
    check(counts.deadair === 1, `trailing dead air found (${counts.deadair})`);
    check(counts.scene >= 1, `scene change found (${counts.scene})`);
    check(counts.repeat === 1, `repeated shot found (clip 3 = clip 2) (${counts.repeat})`);
    const sceneText = await page.getByTestId('sugg-scene').first().textContent();
    check(/0:0[34]\.\d/.test(sceneText), `scene change located near 4 s ("${sceneText.match(/at [\d:.]+/)?.[0]}")`);
    await page.screenshot({ path: path.join(OUT, 'm6-suggestions.png') });

    // Reject the repeat suggestion.
    await page.getByTestId('sugg-repeat').getByTestId('reject').click();
    check((await n('repeat')) === 0, 'rejected suggestion disappears and nothing changes');
    check(await dur() === '0:14.0', 'reject leaves the edit untouched');

    // Accept all silence cuts in one step.
    await page.getByTestId('accept-all-cuts').click();
    await page.getByTestId('analyze').waitFor({ timeout: 60000 });
    const after = await dur();
    check(after === '0:11.9', `silences removed: 14.0 s → ${after} (expected 11.9 s: 1.26 + 0.46 + 0.38 s cut)`);
    await page.getByTestId('undo').click();
    check(await dur() === '0:14.0', 'Undo restores all removed silence');
    await page.getByTestId('redo').click();
    check(await dur() === '0:11.9', 'Redo re-applies it');

    // AI hooks through the real server code (Claude faked).
    await page.getByTestId('info').click();
    await page.getByTestId('svc-url').fill(srv.url);
    await page.getByTestId('svc-pass').fill(srv.passcode);
    await page.getByTestId('svc-test').click();
    await page.getByTestId('svc-status').filter({ hasText: 'Connected' }).waitFor({ timeout: 10000 });
    await page.getByLabel('Close').click();
    await page.getByRole('radio', { name: 'Sales' }).click();
    await page.getByTestId('hook-description').fill('Office cleaning service in Kuala Lumpur, weekly and monthly plans.');
    await page.getByTestId('generate-hooks').click();
    await page.getByTestId('consent-text').click();
    await page.getByTestId('hook-results').waitFor({ timeout: 20000 });
    check((await page.getByTestId('hook-item').count()) === 10, 'ten hook ideas shown');
    check(await page.getByText('Check before posting').isVisible(), 'claims to verify are flagged to the user');
    const call = srv.log.hooks[0];
    const userMsg = JSON.stringify(call?.messages);
    check(call?.model === 'claude-opus-5-5' && userMsg.includes('Kuala Lumpur') && userMsg.includes('Objective: sales'),
      'server asked Claude with the description and chosen objective');
    await page.getByTestId('use-hook').first().click();
    await page.getByTestId('tab-text').click();
    check((await page.getByTestId('overlay-bar').count()) === 1, 'chosen hook added as animated text in the first 3 s');

    const file = await exportAndDownload(page, 'm6-smart', { Resolution: '720p' });
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    const d = parseFloat(probe(file).format.duration);
    check(Math.abs(d - 11.9) < 0.15, `exported length matches the tightened edit (${d.toFixed(2)} s)`);
    const gaps = silences(file, -50, 0.3).filter(([s]) => s < 5.8);
    check(gaps.length === 0, `no pauses longer than 0.3 s remain in the speech section (${JSON.stringify(gaps)})`);
    const speech = rms(file, 0.2, 5.6);
    check(speech > -12, `speech kept intact (${speech.toFixed(1)} dB average)`);
  } finally {
    await ctx.close();
    srv.close();
  }
}

// ------------------------------------------------------------------ Module 7: export options + autosave of everything
async function moduleExport(browser, { A, C, importClips }) {
  console.log('\n▶ Module 7: export settings (fps, bitrate, audio quality, 4K), autosave & restore of all edits');
  const { ctx, page, errors } = await newPage(browser);
  try {
    await importClips(page, [A, C]);
    // Make one edit of every kind.
    await page.getByTestId('tab-text').click();
    await page.getByTestId('add-title').click();
    await page.getByText('Done').click();
    await page.getByTestId('tab-captions').click();
    await page.getByTestId('add-caption').click();
    await page.getByTestId('tab-audio').click();
    await page.getByTestId('add-sound-pulse').click();
    await page.getByTestId('audio-panel').waitFor({ timeout: 15000 });
    await page.getByText('Done').click();
    await page.getByTestId('tab-color').click();
    await page.getByTestId('clip-card').nth(0).click();
    await page.getByTestId('tab-color').click();
    await page.getByTestId('preset-film-look').click();
    await page.getByTestId('tab-edit').click();
    await page.getByTestId('clip-card').nth(1).click();
    await page.getByRole('radio', { name: 'Zoom punch' }).click();
    await page.waitForTimeout(1200); // autosave

    await page.reload();
    await page.getByTestId('clip-card').nth(1).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    check((await page.getByTestId('overlay-bar').count()) === 1, 'title graphic restored after reload');
    check((await page.getByTestId('caption-bar').count()) === 1, 'caption restored after reload');
    check((await page.getByTestId('audio-bar').count()) === 1, 'music restored after reload');
    await page.getByTestId('clip-card').nth(0).click();
    await page.getByTestId('tab-color').click();
    check(await page.getByTestId('preset-film-look').evaluate((el) => el.classList.contains('on')), 'colour grade restored after reload');
    await page.getByTestId('clip-card').nth(1).click();
    await page.getByTestId('tab-edit').click();
    check(await page.getByRole('radio', { name: 'Zoom punch' }).getAttribute('aria-checked') === 'true', 'transition restored after reload');

    // Estimated size reacts to settings.
    await page.getByTestId('open-export').click();
    const est = async () => (await page.getByTestId('est-size').textContent()).trim();
    await page.getByRole('radiogroup', { name: 'Quality' }).getByRole('radio', { name: /^Low/ }).click();
    const low = await est();
    await page.getByRole('radiogroup', { name: 'Quality' }).getByRole('radio', { name: /^High/ }).click();
    const high = await est();
    check(parseFloat(high.replace(/[^\d.]/g, '')) > parseFloat(low.replace(/[^\d.]/g, '')) * 2, `estimated size follows bitrate (${low} → ${high})`);
    const has4k = await page.getByRole('radiogroup', { name: 'Resolution' }).getByRole('radio', { name: /^4K/ }).count();
    await page.getByLabel('Close').click();
    console.log(`    4K option offered by this browser: ${has4k ? 'yes' : 'no'}`);

    const f60 = await exportAndDownload(page, 'm7-1080p60', { Resolution: '1080p', 'Frame rate': '60', Quality: 'High', 'Audio quality': '256k' });
    const i60 = probe(f60);
    const v = i60.streams.find((s) => s.codec_type === 'video'), a = i60.streams.find((s) => s.codec_type === 'audio');
    check(v.avg_frame_rate === '60/1' && v.width === 1080 && v.height === 1920, `1080p 60 fps export (${v.width}x${v.height} @ ${v.avg_frame_rate})`);
    check(Math.abs(parseInt(a.bit_rate, 10) - 256000) < 40000, `256 kbps AAC audio (${Math.round(a.bit_rate / 1000)} kbps)`);
    const vbr = parseInt(v.bit_rate, 10);
    check(vbr > 6e6, `high bitrate video (${(vbr / 1e6).toFixed(1)} Mbps)`);
    check(decodesClean(f60), '60 fps file decodes with zero errors');

    const f24 = await exportAndDownload(page, 'm7-720p24', { Resolution: '720p', 'Frame rate': '24', Quality: 'Low', 'Audio quality': '128k' });
    const v24 = probe(f24).streams.find((s) => s.codec_type === 'video');
    check(v24.avg_frame_rate === '24/1' && v24.width === 720, `720p 24 fps export (${v24.width}x${v24.height} @ ${v24.avg_frame_rate})`);
    if (has4k) {
      const f4k = await exportAndDownload(page, 'm7-4k', { Resolution: '4K', 'Frame rate': '24', Quality: 'Medium' });
      const v4 = probe(f4k).streams.find((s) => s.codec_type === 'video');
      check(v4.width === 2160 && v4.height === 3840, `4K export (${v4.width}x${v4.height})`);
    }
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ Auto Edit (one tap)
async function moduleAuto(browser, { A, importClips }) {
  console.log('\n▶ Auto Edit: one tap edits everything (with and without the AI server)');
  const G = talkingFixture();
  const srv = await startAiServer({ words: WORDS, hooksResult: HOOKS });
  const status = async (page, id) => page.getByTestId(`auto-step-${id}`).getAttribute('data-status');
  try {
    // 1) With the AI server connected.
    const { ctx, page, errors } = await newPage(browser);
    await importClips(page, [G, A]);
    await page.getByTestId('info').click();
    await page.getByTestId('svc-url').fill(srv.url);
    await page.getByTestId('svc-pass').fill(srv.passcode);
    await page.getByTestId('svc-test').click();
    await page.getByTestId('svc-status').filter({ hasText: 'Connected' }).waitFor({ timeout: 10000 });
    await page.getByLabel('Close').click();
    await page.getByTestId('goto-auto').click();
    await page.getByTestId('auto-topic').fill('Office cleaning service');
    await page.getByTestId('auto-run').click();
    await page.getByTestId('auto-run').filter({ hasText: 'Auto edit my video' }).waitFor({ timeout: 120000 });
    const st = {};
    for (const id of ['silence', 'captions', 'colour', 'transitions', 'music', 'sfx', 'hook']) st[id] = await status(page, id);
    console.log('    steps:', JSON.stringify(st));
    check(Object.values(st).every((v) => v === 'done'), 'every Auto Edit step completed with the server connected');
    await page.screenshot({ path: path.join(OUT, 'auto-1-done.png') });
    const dur = (await page.getByTestId('tl-time').textContent()).split('/')[1].trim();
    check(dur === '0:08.9', `silences removed automatically (11.0 s → ${dur})`);
    check((await page.getByTestId('caption-bar').count()) > 0, 'captions added automatically');
    check((await page.getByTestId('overlay-bar').count()) === 2, 'AI hook + call to action added');
    check((await page.getByTestId('audio-bar').count()) === 2, 'music + whoosh added');
    const file = await exportAndDownload(page, 'auto-edit', { Resolution: '720p' });
    check(decodesClean(file), 'auto-edited video exports and decodes cleanly');
    const music = rmsFiltered(file, 6.2, 8.4, 'bandreject=f=440:width_type=q:w=12,bandreject=f=440:width_type=q:w=12');
    check(music > -45, `music is in the exported video (${music.toFixed(1)} dB)`);
    const hook = regionStats(file, 1.0, 40, 300, 640, 180).frac(isWhite);
    check(hook > 0.02, `hook text burned into the first seconds (${(hook * 100).toFixed(1)}% text pixels)`);
    await page.getByTestId('undo').click();
    const back = (await page.getByTestId('tl-time').textContent()).split('/')[1].trim();
    check(back === '0:11.0' && (await page.getByTestId('overlay-bar').count()) === 0, 'one Undo reverts the whole auto edit');
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await ctx.close();

    // 2) No server: on-device captions can't download in this test environment → reported honestly, rest still done.
    const p2 = await newPage(browser);
    await importClips(p2.page, [G, A]);
    await p2.page.getByTestId('goto-auto').click();
    await p2.page.getByTestId('auto-topic').fill('office cleaning');
    await p2.page.getByTestId('auto-run').click();
    await p2.page.getByTestId('auto-run').filter({ hasText: 'Auto edit my video' }).waitFor({ timeout: 150000 });
    const cap = await status(p2.page, 'captions'), hookSt = await status(p2.page, 'hook'), sil = await status(p2.page, 'silence');
    const hookNote = await p2.page.getByTestId('auto-step-hook').textContent();
    check(cap === 'failed', `captions step reports a clear failure when the speech model can't download (${cap})`);
    check(sil === 'done' && hookSt === 'done' && /template/.test(hookNote), `other steps still done; hook honestly marked as template (${hookNote.slice(0, 60)}…)`);
    await p2.page.screenshot({ path: path.join(OUT, 'auto-2-no-server.png') });

    // 3) Crash protection: a normal run leaves no crash note…
    await p2.page.reload();
    await p2.page.getByTestId('clip-card').first().waitFor({ timeout: 20000 });
    await p2.page.waitForTimeout(800);
    check((await p2.page.getByText(/ran out of memory/).count()) === 0, 'no false crash warning after a normal run');
    // …and if Safari dies during on-device captions, the next start explains it and skips that step.
    await p2.page.evaluate(() => localStorage.setItem('crashguard-running', JSON.stringify({ task: 'transcribe:on-device', at: Date.now() })));
    await p2.page.reload();
    await p2.page.getByText(/ran out of memory during on-device captions/).waitFor({ timeout: 20000 });
    check(true, 'after a crash, the app explains which step crashed and that the project is safe');
    await p2.page.getByTestId('undo').waitFor();
    await p2.page.getByTestId('tab-ai').click();
    await p2.page.getByTestId('auto-run').click();
    await p2.page.getByTestId('auto-run').filter({ hasText: 'Auto edit my video' }).waitFor({ timeout: 150000 });
    const capAfter = await status(p2.page, 'captions');
    const capNote = await p2.page.getByTestId('auto-step-captions').textContent();
    check(capAfter === 'skipped' && /crashed Safari before/.test(capNote), `the crashing step is skipped next time, with the reason shown (${capAfter})`);
    check(['done', 'skipped'].includes(await status(p2.page, 'music')), 'the rest of Auto Edit still runs');
    await p2.ctx.close();
  } finally {
    srv.close();
  }
}

export const MODULES = { captions: moduleCaptions, color: moduleColor, graphics: moduleGraphics, audio: moduleAudio, ai: moduleAI, export: moduleExport, auto: moduleAuto };
