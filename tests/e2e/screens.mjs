// Captures UI screenshots of every tool on iPhone and desktop sizes (for visual review / README).
import path from 'node:path';
import { baseFixtures, chromium, devices, OUT, BASE, startServer, seekTo } from './lib.mjs';
const [A, B, C] = baseFixtures();
const server = await startServer();
const browser = await chromium.launch();
for (const [label, opts] of [['iphone', { ...devices['iPhone 13'] }], ['desktop', { viewport: { width: 1440, height: 900 } }]]) {
  const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByTestId('import-first').waitFor();
  await page.getByTestId('file-input').first().setInputFiles([A, B, C]);
  await page.getByTestId('clip-card').nth(2).waitFor();
  await page.waitForTimeout(1500);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('add-hook').click();
  await page.getByText('Done').click();
  await page.getByTestId('tab-captions').click();
  await seekTo(page, 0.5);
  await page.getByTestId('add-caption').click();
  await page.getByTestId('caption-text').first().fill('Sparkling floors in *one* visit');
  await page.getByTestId('tab-audio').click();
  await page.getByTestId('add-sound-pad').click();
  await page.getByTestId('audio-panel').waitFor();
  await page.getByText('Done').click();
  await seekTo(page, 1.2);
  for (const tab of ['edit', 'captions', 'text', 'color', 'audio', 'ai', 'format']) {
    await page.getByTestId(`tab-${tab}`).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `ui-${label}-${tab}.png`) });
  }
  if (label === 'iphone') {
    await page.getByTestId('tab-captions').click();
    await page.getByTestId('panel-grabber').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `ui-iphone-captions-expanded.png`) });
    await page.getByTestId('panel-grabber').click();
  }
  await ctx.close();
}
await browser.close();
server.kill();
