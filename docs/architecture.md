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
- Adds bundled `ffmpeg/` directory to PATH for Whisper and video processing
- Applies `middleware/no_cache.py` — pure ASGI middleware that adds `Cache-Control: no-store` to all `/static/js/` and `/static/css/` responses
- Mounts 10 `APIRouter` modules under `/api/*` and starts Uvicorn on port 7860
- Opens the browser automatically on startup

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
| `image_video.py` | `/api/imgvid` | Thin aggregator — includes five Image Video Editor sub-routers |

### Image Video Editor — route sub-package (`routers/imgvid/routes/`)

`image_video.py` is a **thin aggregator** that simply includes five independent sub-routers:

| Sub-router | File | Routes |
|-----------|------|--------|
| Media | `routes/media.py` | Upload/serve images, video clips, audio, thumbnails |
| Projects | `routes/projects.py` | Project CRUD (list/create/read/update/rename/delete, save-as-template) |
| Templates | `routes/templates.py` | Template CRUD (list/get/update/delete/rename/duplicate) |
| Project files | `routes/project_files.py` | `.project` ZIP pack/unpack/browse/load |
| Export | `routes/export.py` | SSE-streamed video export, audio-only export, audio extraction |

### Image Video Editor — service modules (`routers/imgvid/`)

Heavy business logic is split into dedicated service modules:

| Module | Responsibility |
|--------|---------------|
| `ffmpeg_utils.py` | Locates `ffmpeg`/`ffprobe` (PATH → `ffmpeg/` folder). `_XFADE` — 22-entry dict mapping transition names to xfade filter names. `_EFFECTS` — per-effect FFmpeg filter strings. `_probe_duration_clip()` — runs ffprobe. `_extract_thumb()` — extracts a JPEG thumbnail. |
| `codec_selector.py` | Maps human codec names (h264, h265, vp9, …) to FFmpeg encoder argument lists. CRF quality scaling. Special handling for x264 lossless and GIF palette encoding. |
| `audio_processor.py` | `sfx_filter()` — single sound-effect → FFmpeg audio filter string (14 effects). `build_audio_filter()` — per-track filter chain (volume, trim, speed, fade, effects, offset). `build_audio_chain()` — multi-track assembly with `amix`. |
| `filter_builder.py` | `build_scale_filter()` — standardise all slides to output resolution. `build_slide_filter()` — per-slide filter (trim, speed, effects, start/end motion). `build_transition_filters_fps()` — xfade/concat with additive duration model. `build_pip_filters()` — PIP overlay with opacity and time-range `enable` expression. `build_subtitle_filter()` — write ASS file and return FFmpeg `subtitles=` filter. |
| `ass_writer.py` | `_ass_time()` — seconds → `H:MM:SS.cs`. `_write_ass()` — generates full ASS subtitle file with karaoke word-timing, per-subtitle animations, and style overrides. |
| `project_ops.py` | `_make_project_buf()` — packs project JSON + media into `.project` ZIP archive. `_extract_project_zip()` — unpacks archive, saves media to server directories, rewrites `fileUrl` fields. `_finalize_project()` — writes project JSON to disk. |

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
POST /api/synthesize/*  (or /api/imgvid/export)
  │
  └── worker thread: core_fn(*args, progress=callback)
        │   callback(value, desc) → queue.put(("progress", value, desc))
        └── async generator → yields SSE frames:

event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/<name>/audio", "filename": "<name>", "status": "✓ Готово"}

event: error
data: {"status": "❌ Ошибка: ..."}
```

---

## Frontend

### Entry point — `static/index.html`

Single-page HTML file containing all 8 tab panels plus modal markup. Loaded once; tab content is rendered by JS modules.

### Shared utilities (`static/js/`)

| File | Role |
|------|------|
| `app.js` | Entry — lazy tab init. Only Windows tab initialises on load; others init on first click. Tracked in a `ready` Set to prevent re-init. |
| `api.js` | `fetch` wrappers and `synthesizeStream()` — parses `event: ... / data: ...` frames from a `ReadableStream`. Handlers: `progress(value, desc)`, `done(payload)`, `error(msg)`. |
| `audio-manager.js` | Singleton that ensures exactly one `AudioPlayer` plays at a time. `subscribe(fn)` returns an unsubscribe function. |
| `audio-player.js` | Custom `<audio>` wrapper — waveform drag-to-scrub, seekbar with progress fill, skip ±5 s, speed presets, download. |
| `wave-renderer.js` | Canvas waveform renderer used by `AudioPlayer`. |
| `custom-select.js` | Dropdown component with optional action icons. |
| `file-upload.js` | Drag-and-drop single-file upload component. |
| `loader.js` | `withLoader()` spinner overlay + `makeSkeleton()` helpers. |
| `events.js` | Cross-tab `EventTarget` bus: `voices-changed`, `history-changed`, `video-changed`. |
| `icons.js` | Inline SVG strings (single source of truth for all icons). |
| `logger.js` | Floating draggable progress panel + terminal progress bar. |
| `modal.js` | Promise-based `openConfirm()` / `openPrompt()`. Escape closes, Enter confirms. |
| `tabs.js` | Tab switching (calls `audioManager.stopAll()`). |
| `toast.js` | Transient notifications (info / ok / warn / err). |

### Tab modules (`static/js/tabs/`)

| File | Tab |
|------|-----|
| `windows.js` | Windows SAPI5 TTS + optional subtitle generation |
| `cloning.js` | XTTS v2 upload + voice save |
| `saved.js` | Saved voices library + synthesis |
| `subtitles.js` | SRT editor + Whisper transcription |
| `video.js` | Video upload + subtitle burn (Видео tab) |
| `ffmpeg.js` | FFmpeg availability check used by the video tab |
| `templates.js` | Subtitle style template CRUD (used by video tab) |
| `history.js` | Section switcher: audio / subtitles / video / templates |
| `logs.js` | Server log viewer |
| `image-video.js` | **Редактор tab coordinator** — wires up all imgvid/ sub-modules, handles project load/save, keyboard shortcuts, undo/redo |

### Image Video Editor sub-modules (`static/js/imgvid/`)

All sub-modules use a dependency-injection pattern: each exports `init(dom, callbacks)` called once by the coordinator (`image-video.js`) with the needed DOM references and callback functions.

| Module | Size | Responsibility |
|--------|------|---------------|
| `constants.js` | 3 KB | `TRANSITIONS` (22 types), `EFFECTS_DEF` (10 types), `FONTS`, `ANIMS`, `START_EFFECTS`, `END_EFFECTS` |
| `state.js` | 3 KB | Shared state object `S`, undo history stack, audio element pool, `syncAudio()`, `pauseAllAudio()` |
| `utils.js` | 6 KB | `uid()`, `eh()`, `fmt()`, `fmtShort()`, `totalDur()`, `clipAtTime()`, `buildCSSFilter()`, `hexToRgba()`, `getSnapTargets()`, `snap()` |
| `waveform.js` | 2 KB | `drawWaveform()` (canvas waveform with cached peaks), `probeAudioDuration()` |
| `props.js` | 63 KB | Property panels: slide (type/duration/effects/transitions/crop/offset), audio (volume/speed/trim/fade/effects), subtitle (text/timing/font/color/position/animation/karaoke/background), PIP (position/size/opacity/speed/trim/time-window) |
| `timeline.js` | 34 KB | Timeline rendering; drag-drop for clips/audio/subtitles/PIP; resize handles; snap-to-grid; context menus |
| `playback.js` | 6 KB | `togglePlay()`, `startPlayback()`, `pausePlayback()`, `seek()`, `updateTransportUI()`, `applyZoom()`, `updatePreviewSize()` |
| `pip.js` | 9 KB | Picture-in-Picture layer overlay management and controls |
| `preview-render.js` | 22 KB | Canvas slide renderer: images, video frames, crop/scale/offset, CSS effects, subtitle overlays |
| `media-list.js` | 2 KB | Media browser: renders list of clips + audio tracks, handles delete |
| `exp-modal.js` | 34 KB | Export dialog UI: format/resolution/fps/quality/codec/audio settings, SSE progress streaming |
| `export.js` | 1 KB | Export helper stubs (thin wrappers for exp-modal) |
| `preview.js` | 1 KB | Preview zoom helper stubs |

### State management

All sub-modules import `S` from `state.js` and mutate it in-place. The coordinator (`image-video.js`) calls `renderAll()` after any mutation to propagate UI updates. There is no reactive framework — updates are explicit and synchronous.

### Audio element pool

`state.js` maintains a `Map<trackId, HTMLAudioElement>` (`_audioEls`). `syncAudio(t, force)` adjusts each element's `currentTime`, volume, speed, and play/pause state to match the current playhead position. Called every ~30 animation frames during playback to avoid stuttering.

---

## Data flow

```
User edits timeline / props
  └── mutates S (state.js)
  └── calls renderAll()
        ├── renderTimeline()    (timeline.js)
        ├── renderProps()       (props.js)
        ├── renderMediaList()   (media-list.js)
        └── renderPreview()     (preview-render.js + pip.js)

User clicks Export
  └── exp-modal.js collects settings
  └── POST /api/imgvid/export (multipart form)
        └── routes/export.py → filter_builder.py, audio_processor.py, codec_selector.py
        └── ffmpeg subprocess (background thread)
        └── SSE stream → browser progress bar
```

---

## Output directories

```
.outputs/
├── audio/           # Synthesised WAV files
├── subtitle/        # SRT files
├── video/src/       # Uploaded source videos
├── video/output/    # Subtitle-burned MP4 files
├── templates/       # Video subtitle style JSON templates
├── saved_projects/  # .project archives saved to disk
└── imgvid/
    ├── images/      # Uploaded images
    ├── clips/       # Uploaded video clips
    ├── audio/       # Uploaded audio tracks
    ├── thumbs/      # Extracted JPEG thumbnails
    ├── projects/    # Project JSON files
    ├── templates/   # Template JSON files
    └── output/      # Exported videos and audio
```
