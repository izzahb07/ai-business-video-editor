# AI Business Video Studio

A professional video editor that runs **entirely in Safari on your iPhone**. Your videos never leave your phone.

**Current version: Phase 1** — import clips, arrange them, choose a format, and export a real MP4 (H.264 + AAC) that you can save to Photos.
See [ROADMAP.md](ROADMAP.md) for what's coming (trim/split, captions, colour grading, motion graphics, sound design, silence removal, AI hooks).

---

## 📱 Using it on your iPhone

### Open the app
1. Open the app link in **Safari**: `https://izzahb07.github.io/ai-business-video-editor/` (works after the one-time setup below).
2. Optional: tap **Share** → **Add to Home Screen** to get an app icon.

### Make a video
1. Tap **Import videos** and choose clips from **Photo Library** or **Choose File**. You can pick several at once.
2. Clips appear in order in the **Clips** row. Tap the preview (or ▶) to watch.
3. Tap a clip to edit it:
   - **Earlier / Later** to change the order
   - **Duplicate** / **Delete**
   - **Framing:** *Fill* crops to fill the screen; *Fit* shows the whole clip on a blurred background
   - **Volume** slider, or the speaker button to mute
   - Tap **Done** to go back
4. With no clip selected you see **Format**: choose **9:16** (TikTok/Reels/Shorts), 1:1, 4:5 or 16:9.
5. Made a mistake? Use **↶ Undo** / **↷ Redo** at the top.
6. Your project saves itself automatically on the phone. If Safari reloads, your clips come back.

### Export and save to Photos
1. Tap **Export** (top right).
2. Choose **1080p**, a **frame rate** (30 is standard) and **quality**, then tap **Export MP4**.
3. **Keep Safari open and the screen on** until it reaches 100%. Switching apps pauses the export.
4. When you see **"Export complete and verified"**, tap **Save to Photos / Share** → **Save Video**.
   (Or **Download to Files**, then share it from the Files app.)

### If something goes wrong
- Tap the **ⓘ** button (top left) → **Device check** shows what your iPhone supports.
- Export failed or Safari reloaded? Try **720p** or **Small file** and close other apps.
- **iOS 16.4 or newer** is required to export.
- For the most accurate colours, turn off *Settings → Camera → Record Video → HDR Video*.

---

## One-time setup (publishing the app)

1. Merge the development branch into `main` (on GitHub: **Pull requests → New → compare `claude/…` → Create → Merge**).
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Open the **Actions** tab and wait for "Test and deploy to GitHub Pages" to finish (green tick). Your link is shown there.

Every later merge into `main` re-runs the tests and redeploys automatically.

> ⚠️ **Only one workflow should publish the site:** `.github/workflows/deploy.yml` ("Build and deploy video editor to GitHub Pages").
> Do **not** add GitHub's suggested "Jekyll" or "Static HTML" Pages workflows. They publish the raw source code instead of the built app, and the site shows a blank page.
> If the site is ever blank: open **Actions**, select "Build and deploy video editor to GitHub Pages", tap **Run workflow** on `main`.

---

## For developers

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (timeline maths, undo/redo)
npm run build
npm run e2e        # end-to-end: real test videos → app → export → inspected with ffprobe
```

The end-to-end test needs `ffmpeg`/`ffprobe` and Playwright's Chromium. It checks both export paths (hardware WebCodecs decoding and the `<video>` fallback): H.264/AAC, 1080×1920, 30 fps, exact length and frame count, error-free decode, correct iPhone rotation, correct clip order by pixel colour, and correct per-clip audio by frequency.

### Code map
| Path | What it does |
|---|---|
| `src/lib/export/exporter.ts` | Export pipeline: render frames → H.264, mix audio → AAC, MP4 mux, verification |
| `src/lib/export/frameProviders.ts` | Frame decoding: WebCodecs (fast) or `<video>` seeking (fallback) |
| `src/lib/compositor.ts` | Draws a frame (fill/fit/blurred background). Shared by preview and export |
| `src/lib/player.ts` | Preview player (Web Audio master clock) |
| `src/lib/media.ts` | File probing, thumbnails, audio decoding |
| `src/lib/storage.ts`, `projectIO.ts` | On-device saving, import, restore |
| `src/store.ts` | Project state + undo/redo |
| `src/components/` | UI |
