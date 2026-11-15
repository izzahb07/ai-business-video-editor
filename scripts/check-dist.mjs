// Fails the build if dist/ is not a correctly built app for GitHub Pages.
import { existsSync, readFileSync } from 'node:fs';

const BASE = '/ai-business-video-editor/';
const errors = [];
const html = existsSync('dist/index.html') ? readFileSync('dist/index.html', 'utf8') : '';
if (!html) errors.push('dist/index.html is missing');
if (html.includes('/src/main.tsx')) errors.push('index.html still points at source code (/src/main.tsx) — app was not built');

const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|#)/.test(u));
if (!refs.some((r) => /assets\/index-.*\.js$/.test(r))) errors.push('no built JavaScript bundle referenced');
for (const r of refs) {
  if (!r.startsWith(BASE)) errors.push(`reference "${r}" does not start with ${BASE}`);
  const file = 'dist/' + r.slice(BASE.length);
  if (!existsSync(file)) errors.push(`referenced file missing: ${file}`);
}
for (const f of ['manifest.webmanifest', 'apple-touch-icon.png', 'icon.svg', '.nojekyll']) {
  if (!existsSync('dist/' + f)) errors.push(`dist/${f} missing`);
}

if (errors.length) {
  console.error('✘ Built site check failed:\n  - ' + errors.join('\n  - '));
  process.exit(1);
}
console.log(`✔ dist/ is a built app; ${refs.length} references all under ${BASE} and present`);
