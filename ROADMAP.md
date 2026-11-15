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

## Status

| Module | Status |
|---|---|
| Phase 1 — mobile editor + real MP4 export | ✅ Done |
| 1. Timeline, trim, split, crop/rotate/position, transitions, reorder, zoom, undo | ✅ Done, verified in exported MP4s |
| 2. Transcription (on-device Whisper / cloud), caption editor, templates, karaoke, SRT, burn-in | ✅ Done (on-device model needs a real-device test) |
| 3. Colour grading (14 controls), 9 presets, `.cube` LUTs, before/after | ✅ Done |
| 4. Motion graphics: animated text, shapes, stickers, logo, PiP, keyframes, intro/outro | ✅ Done |
| 5. Audio: music & SFX library, import, fades, ducking, voice enhance, noise gate, waveforms | ✅ Done |
| 6. Smart editing (silence, dead air, scenes, repeats, best opening, pacing, order) + AI hooks | ✅ Done (hooks need the optional server) |
| 7. Export: 720p/1080p/4K, 24–60 fps, bitrate & audio quality, size estimate | ✅ Done |

## Architecture additions (studio upgrade)
- **One renderer** (`src/engine/render.ts`) is used by preview and export, so every edit is identical in the MP4.
- **Colour grading** runs as a WebGL2 shader on the GPU, applied to the video layer only (text stays crisp).
- **Export** decodes each layer (main clips, picture-in-picture) as an ordered stream with WebCodecs, falling back to Safari's player per layer.
- **Audio** uses one Web Audio graph builder for both live preview and offline export (rendered in 10 s segments with pre-roll to keep memory flat).
- **Captions** are stored against each clip's *source* timing, so trims, splits and silence removal never break sync.
- **AI** is split honestly: measured analysis runs on-device; generative features (hooks) and cloud transcription go through the user's own server so API keys never ship in the app.
- ffmpeg.wasm was re-evaluated and is still not used: hardware WebCodecs is far faster and lighter on iPhone.

## Next ideas
- Cross-dissolve transitions (two decoders overlapping)
- Clip speed (slow motion / speed ramps) and clip keyframes (Ken Burns)
- ML noise suppression (e.g. RNNoise WASM)
- Export in a Web Worker with OffscreenCanvas (Safari 17+) for even smoother UI during export
- Brand kit (saved fonts, colours, logo)
