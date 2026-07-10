# Architecture

## Overview

TTS Studio is a local, offline web application. The backend is **FastAPI** (Python); the frontend is hand-written **HTML / CSS / ES modules** — no React, no Gradio, no bundler.

```
Browser  ←→  FastAPI (Uvicorn, port 7860)
                 │
                 ├── /static/*         served from static/
                 └── /api/*            10 APIRouter modules
```

---

## Backend

### Entry point — `app.py`

- Forces UTF-8 stdout/stderr (prevents Cyrillic crash on cp1251 consoles)
- Applies `middleware/no_cache.py` — pure ASGI middleware that adds `Cache-Control: no-store` to all `/static/js/` and `/static/css/` responses
- Mounts 10 `APIRouter` modules and starts Uvicorn

### Routers (`routers/`)

| File | Prefix | Responsibility |
|------|--------|----------------|
| `voices.py` | `/api/voices` | Windows SAPI voice list; saved voice profiles CRUD + WAV serve |
| `synthesis.py` | `/api/synthesize` | SSE synthesis streams (windows / xtts / saved) |
| `xtts.py` | `/api/xtts` | XTTS install status + language map |
| `history.py` | `/api/history` | Audio file browser: list / play / rename / delete |
| `subtitles.py` | `/api/subtitles` | SRT file CRUD |
| `video.py` | `/api/video` | Video upload, subtitle-burn (FFmpeg), video history |
| `transcribe.py` | `/api/transcribe` | Whisper speech-to-text transcription |
| `templates.py` | `/api/templates` | Video subtitle style template CRUD |
| `log_router.py` | `/api/logs` | Server log file streaming and editing |
| `image_video.py` | `/api/imgvid` | Image Video Editor — media upload, projects, export |

### Image Video Editor service package (`routers/imgvid/`)

`image_video.py` contains **only route handlers**. Business logic is split into:

| Module | Contents |
|--------|----------|
| `ffmpeg_utils.py` | Locates `ffmpeg`/`ffprobe` (PATH → `ffmpeg/` folder). `_XFADE` — 22-entry dict mapping transition names to xfade filter names. `_EFFECTS` — per-effect FFmpeg filter strings. `_probe_duration_clip()` — runs ffprobe to get clip duration. `_extract_thumb()` — extracts a JPEG thumbnail via FFmpeg. `_compute_video_dur()` — sums slide durations minus xfade overlaps. |
| `ass_writer.py` | `_ass_time(s)` — converts seconds to `H:MM:SS.cs` centiseconds. `_write_ass()` — generates full ASS subtitle file with karaoke word-timing, per-subtitle animations (fade-in/out, slide-up/down, typewriter, zoom-in), and style overrides. |
| `project_ops.py` | `_make_project_buf()` — packs project JSON + all referenced media into a `.project` ZIP archive in memory. `_extract_project_zip()` — unpacks archive, saves media to server directories, rewrites `fileUrl` fields in project JSON. `_finalize_project()` — writes project JSON to disk and returns the project record. |

### Core (`core/`)

| File | Role |
|------|------|
| `audio.py` | WAV I/O; `save_named_audio()` writes to `.output/audio/` with timestamp filename |
| `history_manager.py` | List / load / rename / delete files in `.output/audio/` |
| `voice_manager.py` | Saved voices CRUD under `saved_voices/` |
| `log.py` | `app_log(msg, level, source)` — writes to stdout + `.logs/YYYY-MM-DD.log`; `print_progress()` — terminal progress bar |
| `schemas.py` | Pydantic shared models (`RenameBody`, `SaveSRTBody`) |

### Services (`services/`)

| File | Role |
|------|------|
| `tts_windows.py` | pyttsx3 (SAPI) synthesis. Russian voices sorted first, default Irina. Accepts `progress=None` callback. |
| `tts_xtts.py` | Coqui XTTS v2. Lazy-loads ~1.8 GB model on first call. Monkey-patches `torch.load` (weights_only=False) and `Xtts.load_checkpoint` (strict=False) for compatibility. |
| `sse.py` | `run_synth_stream(core_fn, args)` runs synthesis in a worker thread. Progress is pushed through a `queue.Queue` and yielded as SSE frames. `sse_frame(event, data)` formats a single frame. |

### SSE streaming pattern

```
POST /api/synthesize/*
  │
  └── run_synth_stream(core_fn, args)
        ├── worker thread: core_fn(*args, progress=callback)
        │     └── callback(value, desc) → queue.put(...)
        └── async generator → yields SSE frames:

event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/<name>/audio", "filename": "<name>", "status": "✓ ..."}

event: error
data: {"status": "❌ ..."}
```

The same pattern is used for video export and audio export in `image_video.py`.

---

## Frontend

### Single page (`static/index.html`)

All eight tabs live in one HTML file. Tabs are shown/hidden with CSS; no navigation or page reload.

### Lazy tab initialisation (`static/js/app.js`)

Only the **Windows Voices** tab is initialised on page load. Every other tab initialises on the first click and is recorded in a `ready` Set to prevent re-init. This keeps startup fast even when tabs load large libraries (e.g. waveform, project list).

### Shared modules

| Module | Role |
|--------|------|
| `api.js` | `apiFetch()` — thin `fetch` wrapper with JSON/FormData support. `synthesizeStream()` — reads SSE `ReadableStream`, dispatches `progress` / `done` / `error` handlers. |
| `audio-manager.js` | Singleton. Each `AudioPlayer` subscribes on creation; when one starts playback, all others pause. |
| `audio-player.js` | Custom `<audio>` wrapper — play / seek / download controls. |
| `custom-select.js` | Dropdown component with optional icon actions (rename, delete). |
| `file-upload.js` | Drag-and-drop single-file upload component. |
| `events.js` | Module-level `EventTarget`. Events: `voices-changed`, `history-changed`, `video-changed`. |
| `icons.js` | Single source of truth for all inline SVG strings. |
| `logger.js` | Floating draggable log panel + synthesis progress bar. |
| `modal.js` | `openConfirm(title, msg)` and `openPrompt(title, val)` — both return Promises. Escape closes, Enter confirms. |
| `tabs.js` | Tab switching; calls `audioManager.stopAll()` on every switch. |
| `toast.js` | Transient notifications: `info` / `ok` / `warn` / `err`. Auto-dismiss after 4 s. |

### Image Video Editor modules (`static/js/imgvid/`)

`tabs/image-video.js` imports shared logic from sub-modules to avoid a single 3000+ line file.

| Module | Exports |
|--------|---------|
| `constants.js` | `TRANSITIONS` — 22-entry object (name → `{ label, xfade }`). `EFFECTS_DEF` — per-effect defaults. `FONTS` — font list. `ANIMS` — animation presets. |
| `utils.js` | Pure functions with no DOM or state dependencies: `uid()`, `eh(str)` (HTML escape), `fmt(s)` / `fmtShort(s)` (time format), `buildCSSFilter(effects)`, `hexToRgba(hex, a)`, `_makeTextShadow(sub)`, `getSnapTargets(S, excludeIdx, type)`, `snap(value, targets, threshold)`, `totalDur(clips)`, `clipAtTime(clips, t)`. |
| `waveform.js` | `drawWaveform(canvas, url)` — fetches audio, decodes with Web Audio API, renders to canvas. `probeAudioDuration(url)` — returns duration in seconds. Both results cached in a module-level `Map`. |
| `export.js` | Stub — export functions currently live inside `image-video.js` `init()` closure. |
| `preview.js` | Stub — preview zoom functions currently live inside `image-video.js` `init()` closure. |

### Audio singleton flow

```
AudioPlayer A starts  →  audioManager.notifyPlay(A)
                            └── subscribers.forEach(fn => fn(A))
                                  ├── Player B: if (B !== A) B.pause()
                                  └── Player C: if (C !== A) C.pause()
```

### Cross-tab event bus

```javascript
import events from '../events.js';

// Fire
events.dispatchEvent(new CustomEvent('history-changed'));

// Listen (in another tab's init())
events.addEventListener('history-changed', () => loadHistory());
```

---

## File Storage

```
.output/
├── audio/              # Generated TTS .wav files
├── subtitle/           # Versioned .srt files
├── templates/          # Video subtitle style templates (.json)
├── video/
│   ├── src/            # Uploaded source videos (temporary)
│   └── *_sub.*         # Videos with burned subtitles
└── imgvid/
    ├── images/         # Images uploaded to Image Video Editor
    ├── clips/          # Video clips uploaded to Image Video Editor
    ├── audio/          # Audio tracks uploaded to Image Video Editor
    ├── thumbs/         # Video clip thumbnails
    ├── projects/       # Project JSON files (includes templates)
    └── output/         # Exported videos from Image Video Editor

saved_voices/           # Saved XTTS voice profiles (.wav)
.logs/                  # Server log files (YYYY-MM-DD.log)
```
