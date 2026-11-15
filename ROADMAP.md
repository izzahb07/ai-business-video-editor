# Development Roadmap — AI Business Video Studio

Each phase is built, tested and shipped before the next one starts.

## Architecture (why it is built this way)

| Decision | Choice | Why |
|---|---|---|
| App type | Web app (React + TypeScript + Vite), installable to the Home Screen | Works on iPhone Safari with no App Store; managed from GitHub |
| Hosting | GitHub Pages (free HTTPS) | HTTPS is required for video encoding in Safari |
| Video encoding | **WebCodecs** (the iPhone's hardware H.264 encoder) via the Mediabunny library | Fast, low battery use, streams files instead of loading them whole |
| Why not ffmpeg.wasm | Evaluated and rejected as the main engine | ~30 MB download, CPU-only (very slow on phones), holds whole files in memory (Safari crashes), multi-thread mode needs server headers GitHub Pages can't send |
| Audio encoding | Built-in AAC when available, otherwise a small bundled AAC encoder (loaded only when needed) | Some iOS versions lack a built-in AAC encoder |
| Decoding fallback | If WebCodecs can't decode a clip, frames are read from Safari's own video player | Works with anything Safari can play (slower) |
| Preview = Export | Both use the same drawing code (`src/lib/compositor.ts`) | What you see is what you get |
| Storage | IndexedDB on the device (project + original clips) | Survives Safari reloading the tab; nothing uploaded |
| Privacy | All processing local. Cloud/AI features (Phase 6) need a small server so API keys are never in the app, and will always ask before sending anything | |

### Known iPhone limits (handled in the app)
- **Memory:** the export is built in memory. The app estimates the file size and warns above ~450 MB (choose 720p / "Small file").
- **Background:** iOS pauses Safari when you switch apps or lock the screen. The app keeps the screen awake while exporting (Wake Lock) and tells you if Safari was backgrounded.
- **iOS version:** iOS 16.4 or newer is required for hardware encoding. The Device check screen shows what your iPhone supports.
- **HDR clips:** iPhone HDR (Dolby Vision) footage may look slightly flatter after export. For the most consistent colour, set *Settings → Camera → Record Video → HDR Video* off.

## Phase 1 — Working mobile editor + real MP4 export ✅
- Import multiple clips (Photos / Files), thumbnails, metadata, iPhone rotation
- Preview player (audio-clock synced, instant cuts between clips)
- Reorder, duplicate, delete clips; per-clip volume / mute; Fill or Fit (blurred background)
- Aspect ratios 9:16, 1:1, 4:5, 16:9
- Undo / redo (100 steps), autosave on device
- Export: MP4 H.264 + AAC, 1080p/720p, 24/25/30/60 fps, 3 quality levels, progress + cancel
- Finished file is re-opened and verified (codec, size, length, audio, first frame) before "success" is shown
- Save to Photos (Share sheet) or Download to Files
- Device check screen

## Phase 2 — Timeline, trim, split, captions, text
- Visual timeline with zoom, playhead dragging, clip widths by duration
- Trim handles (drag in/out), split at playhead, drag to reorder
- Text overlays (title, lower-third) with position/size/colour
- Manual subtitles editor (add/edit/time lines), styled captions, TikTok/Reels/Shorts safe-zone guides
- Caption import/export (SRT)

## Phase 3 — Colour grading & visual effects
- WebGL compositor (GPU) replacing the 2D canvas
- Exposure, contrast, highlights, shadows, whites, blacks, saturation, vibrance, temperature, tint, sharpen, vignette
- .cube LUT import, cinematic presets, before/after split view; all adjustments non-destructive and per clip

## Phase 4 — Motion graphics & sound design
- Animated typography, kinetic subtitles, word highlight, title cards
- Punch-in / smooth zoom, callouts (arrows, circles, labels), animated backgrounds
- Keyframes for position, scale, rotation, opacity; transition presets
- Music & SFX tracks (built-in library + upload), fades, per-track volume, auto-ducking under speech, SFX snapped to cuts/transitions

## Phase 5 — Silence detection & smart editing
- Audio analysis (RMS/VAD) with adjustable threshold and minimum pause
- Auto jump-cuts with padding so words are not clipped; review list before applying (undoable)
- Speech transcription with word timestamps (on-device Whisper where the iPhone can handle it; optional cloud with consent)
- Strongest-opening suggestions

## Phase 6 — AI hooks, storytelling & automation
- Small secure server (e.g. Cloudflare Worker) holding the AI API key — never in the app
- 10 hooks per concept (curiosity, problem/solution, emotional, educational, controversial-but-true)
- Hook → Context → Content → Payoff → CTA structure, retention/pattern-interrupt suggestions
- Captions, titles, descriptions, CTA by objective (sales, awareness, education, engagement, storytelling)
- Guardrails: no invented claims or fake testimonials; text sent only with explicit consent, video never uploaded without consent
