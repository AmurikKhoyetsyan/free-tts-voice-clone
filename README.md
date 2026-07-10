# TTS Studio — Text-to-Speech, Voice Cloning & Video Editor (Windows)

> **Offline speech synthesis · neural voice cloning · subtitle editor · image/video editor**  
> Runs 100% locally. No API keys. No cloud.

[![Python](https://img.shields.io/badge/Python-3.10+-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)](https://fastapi.tiangolo.com/)
[![XTTS v2](https://img.shields.io/badge/Voice%20Cloning-XTTS%20v2-green)](https://github.com/coqui-ai/TTS)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)](https://www.microsoft.com/windows)

---

## What is this?

A local **text-to-speech and video production web app** with eight tabs, served by **FastAPI** and a hand-written **HTML / CSS / ES-module** frontend — no React, no Gradio, no external UI framework.

| Tab | What it does |
|-----|-------------|
| **Windows голоса** | TTS with Windows SAPI / OneCore built-in voices |
| **Клонирование (XTTS v2)** | Zero-shot neural voice cloning from a 10–30 s audio sample |
| **Мои голоса** | Library of saved voice profiles — synthesise without re-uploading |
| **Субтитры** | SRT subtitle editor with Whisper transcription |
| **Видео** | Upload video, style subtitles visually, burn to MP4 with FFmpeg |
| **История** | File browser for audio, subtitles, video, and style templates |
| **Логи** | Server log viewer with per-file edit support |
| **Image Video** | Full image/video editor — timeline, transitions, effects, subtitles, audio, PIP, export |

---

## Features

### Text-to-Speech
- **Windows voices** — built-in SAPI5 / OneCore (Irina, Pavel, Zira, David, …), adjustable rate and volume
- **XTTS v2 voice cloning** — Coqui neural TTS, 8 languages, GPU-accelerated (CPU fallback)
- **Saved voices** — store cloned voice profiles by name and reuse without re-uploading
- **SSE progress streaming** — real-time synthesis progress streamed to the browser

### Subtitle Editor
- Create and edit SRT subtitle tracks with start/end times
- Waveform display of video audio — click or drag to seek
- Whisper speech-to-text transcription from audio file or uploaded video
- Save subtitles as versioned SRT files (`name_vYYYYMMDD_HHMMSS.srt`)
- Load any saved SRT from a dropdown and edit it

### Video Subtitle Burning (FFmpeg)
- Upload any video format; preview with subtitle overlay in the browser
- Full subtitle styling: font, size, bold/italic/underline, colour, outline, shadow, background box
- **Karaoke mode** — animated word-by-word colour highlight
- Style templates — save any style combination as a named template
- Output: MP4, WebM, MKV, MOV, M4V; optional resize / letterbox / crop

### Image Video Editor
A full-featured non-linear video editor running in the browser:

**Timeline**
- Drag-and-drop image and video clips on the video track
- Resize clips by dragging their right edge (duration control)
- Left-trim video clips to set in-point
- **Independent audio track** — audio blocks have their own duration, unaffected by image parameters
- **Audio Split / Cut** — place the playhead inside an audio block and click ✂ Разделить to split into two independent segments
- Subtitle track with drag-to-move and resize handles
- PIP (picture-in-picture) track with start/end handles
- Time ruler scrubbing, Ctrl+scroll to zoom the timeline

**Image Transform**
- **Scale** — zoom the image from 10% to 500%
- **Offset X/Y** — pan the image within the frame
- **Crop** — open the crop dialog to select a rectangular region (Original, 16:9, 9:16, 1:1, 4:3 presets or custom X/Y/W/H)
- All transforms are applied in FFmpeg export using `crop`, `scale`, and `pad` filters — what you see in the Preview is what you get in the video

**Transitions**
- 22 transition types: Fade, Cross Fade, Dissolve, Fade Black/White, Slide Left/Right/Up/Down, Wipe Left/Right/Up/Down, Zoom In, Pixelize, Blur, Circle, Radial, Fade Grays, H/V Slice
- Per-transition duration control
- xfade-based compositing in FFmpeg

**Effects (per clip)**
- Brightness, Contrast, Saturation, Blur, Sharpen, Film Grain
- Grayscale, Sepia, Vignette, Invert toggles
- Effects are composited in FFmpeg via `eq`, `gblur`, `unsharp`, `noise` filters

**Subtitles (independent track)**
- Per-subtitle: text, start/end time, position X/Y, font, size, colour, outline, shadow, background
- Width% and Height px controls — match exactly what you see in Preview
- Animation: fade-in, fade-out, slide-up/down, typewriter, zoom-in
- **Karaoke / Word Highlight** — word-by-word or cumulative colour highlight, exported via ASS format with integer centisecond timing
- Drag subtitles on timeline and in the preview; resize handles for width/height

**PIP (Picture-in-Picture)**
- Add image or video overlay layers
- Drag to position, resize handles, per-layer opacity and volume
- Time range controls (start/end) on timeline
- Exported via FFmpeg `overlay` filter with `enable='between(t,…)'`

**Audio**
- Add multiple audio tracks; each has its own start offset, duration, fade-in/out, volume, speed
- **Independent from image parameters** — changing image scale, offset, or crop never affects audio blocks
- Waveform rendering from decoded audio data (canvas, 4000-sample resolution)
- Audio split: split at playhead into two independent segments with correct trimIn/startOffset
- Export: mixed with `amix`, trimmed with `atrim`, offset with `adelay`

**Export (FFmpeg)**
- Resolutions: 1280×720, 1920×1080, 2560×1440, 3840×2160, custom
- FPS: 24 / 25 / 30 / 60
- Quality: Low / Medium / High / Lossless
- Video formats: MP4, MOV, MKV, M4V, AVI, WebM (VP9), OGV (Theora), FLV, WMV, MPEG, GIF (animated, with palette optimisation)
- Video codecs: H.264, H.265 (HEVC), VP9, VP8, AV1, ProRes, MPEG-4 (auto-detected from format by default)
- Audio-only export: MP3, WAV, FLAC, AAC, OGG, M4A, OPUS — audio tracks mixed and trimmed with FFmpeg
- SSE progress streaming during export

**Projects**
- Save and load named projects (JSON + media packed into `.project` zip archive)
- **Save as Template** — mark any project as a reusable template (visible in the Templates section of the sidebar)
- Load template into editor as a new unsaved project to use as a starting point
- Browse and load `.project` files from the file system
- Projects stored in `.outputs/imgvid/projects/`

---

## Architecture

### Backend

`app.py` starts Uvicorn, applies the no-cache ASGI middleware, then mounts 10 `APIRouter` modules:

| Router | Prefix | Purpose |
|--------|--------|---------|
| `voices.py` | `/api/voices` | Windows SAPI voice list; saved voices CRUD + WAV serve |
| `synthesis.py` | `/api/synthesize` | SSE synthesis streams (windows, xtts, saved) |
| `xtts.py` | `/api/xtts` | XTTS install status + language map |
| `history.py` | `/api/history` | Audio file browser (list/play/rename/delete) |
| `subtitles.py` | `/api/subtitles` | SRT CRUD |
| `video.py` | `/api/video` | Upload, subtitle-burn, video history |
| `transcribe.py` | `/api/transcribe` | Whisper transcription |
| `templates.py` | `/api/templates` | Style template CRUD |
| `log_router.py` | `/api/logs` | Server log streaming |
| `image_video.py` | `/api/imgvid` | Image-to-video processing |

#### Image Video Editor backend package (`routers/imgvid/`)

`image_video.py` contains only route handlers. All heavy logic lives in the service package:

| Module | Contents |
|--------|----------|
| `ffmpeg_utils.py` | Locates `ffmpeg`/`ffprobe` binaries (PATH → project `ffmpeg/`), `_XFADE` transition map (22 types), `_EFFECTS` map, `_probe_duration_clip()`, `_extract_thumb()`, `_compute_video_dur()` |
| `ass_writer.py` | `_ass_time()` centisecond formatter; `_write_ass()` — generates ASS subtitle files with per-subtitle karaoke, animation (fade/slide/zoom/typewriter), word-highlight timing |
| `project_ops.py` | `_make_project_buf()` — packs project JSON + media into a `.project` zip; `_extract_project_zip()` — unpacks and rewrites media URLs; `_finalize_project()` — saves to disk |

#### SSE synthesis pipeline

`services/sse.py::run_synth_stream(core_fn, args)` runs synthesis in a worker thread. Progress is pushed through a `queue.Queue` and yielded as SSE frames:

```
event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/<name>/audio", "filename": "<name>", "status": "✓ ..."}

event: error
data: {"status": "❌ ..."}
```

### Frontend

Single HTML page (`static/index.html`) with eight tabs. No UI framework — plain ES modules loaded via `<script type="module">`.

**Lazy initialisation** — `app.js` initialises only the Windows tab on page load. Each other tab initialises on first click and is tracked in a `ready` Set to prevent re-init.

**Shared utilities**

| Module | Role |
|--------|------|
| `api.js` | `apiFetch()` wrapper; `synthesizeStream()` SSE consumer |
| `audio-manager.js` | Singleton — exactly one `AudioPlayer` plays at a time |
| `events.js` | Cross-tab `EventTarget` bus (`voices-changed`, `history-changed`, `video-changed`) |
| `modal.js` | Promise-based `openConfirm()` / `openPrompt()` |
| `toast.js` | Transient notifications (info / ok / warn / err) |
| `logger.js` | Floating draggable log panel + progress bar |

#### Image Video Editor frontend modules (`static/js/imgvid/`)

`tabs/image-video.js` imports shared logic from:

| Module | Exports |
|--------|---------|
| `constants.js` | `TRANSITIONS` (22 types), `EFFECTS_DEF`, `FONTS`, `ANIMS` |
| `utils.js` | `uid`, `eh`, `fmt`, `fmtShort`, `buildCSSFilter`, `hexToRgba`, `_makeTextShadow`, `getSnapTargets`, `snap`, `totalDur`, `clipAtTime` |
| `waveform.js` | `drawWaveform(canvas, url)`, `probeAudioDuration(url)` with module-level LRU cache |

---

## Requirements

| Component | Version |
|-----------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10+ |
| FFmpeg | Required for Video tab and Image Video Editor export |
| GPU | NVIDIA CUDA (optional, speeds up XTTS and Whisper) |
| Disk | ~500 MB base · ~4 GB with XTTS v2 model |

---

## Installation

### 1. Clone or download

```
git clone https://github.com/AmurKhoyetsyan/tts.git
cd tts
```

### 2. Run the installer

Double-click **`install.bat`**. It will:
- Find Python automatically (PATH → py launcher → common install paths)
- Install all packages from `requirements.txt`
- Check if XTTS v2 is installed — installs it if not, skips if already present

### 3. (Optional) Unlock additional Windows voices

Windows hides OneCore voices (Irina, Pavel, …) from SAPI by default.  
Run **once as administrator**:

```
add_voices_admin.bat
```

Restart the app after running — new voices appear in the dropdown.

### 4. Install FFmpeg

Download from https://ffmpeg.org/download.html and either:
- Add `ffmpeg.exe` to your system PATH, **or**
- Place `ffmpeg.exe` in the `ffmpeg/` folder inside the project directory

---

## Running

Double-click **`run.bat`**, or:

```bash
python app.py
```

The server starts at **http://127.0.0.1:7860** and opens the browser automatically.  
Stop with `Ctrl+C`.

---

## File Storage

```
.outputs/
├── audio/              # Generated TTS audio files (.wav)
├── subtitle/           # SRT subtitle versions (.srt)
├── templates/          # Video subtitle style templates (.json)
├── video/
│   ├── src/            # Uploaded source videos (temporary)
│   └── *_sub.*         # Processed videos with burned subtitles
├── imgvid/
│   ├── images/         # Uploaded images for Image Video Editor
│   ├── clips/          # Uploaded video clips
│   ├── audio/          # Audio tracks for Image Video Editor
│   ├── thumbs/         # Video thumbnails
│   ├── projects/       # Project JSON files (includes templates)
│   └── output/         # Exported videos from Image Video Editor
└── saved_projects/     # .project archives saved by user

saved_voices/           # Saved XTTS voice profiles (.wav)
.logs/                  # Server log files (YYYY-MM-DD.log)
```

---

## Project Structure

```
tts/
├── app.py                       # FastAPI entry point, middleware, router mounting
├── requirements.txt             # Python dependencies
├── install.bat                  # Smart installer
├── run.bat                      # Launch the app
├── add_voices_admin.bat         # Register OneCore voices (run as admin)
│
├── routers/
│   ├── voices.py                # /api/voices/* — Windows + saved voices
│   ├── synthesis.py             # /api/synthesize/* — SSE synthesis streams
│   ├── xtts.py                  # /api/xtts/status
│   ├── subtitles.py             # /api/subtitles/* — SRT CRUD
│   ├── video.py                 # /api/video/* — upload, burn subtitles
│   ├── transcribe.py            # /api/transcribe/* — Whisper transcription
│   ├── templates.py             # /api/templates/* — style templates
│   ├── history.py               # /api/history/* — audio history
│   ├── log_router.py            # /api/logs — log files
│   ├── image_video.py           # /api/imgvid/* — Image Video Editor (routes only)
│   └── imgvid/                  # Image Video Editor service package
│       ├── __init__.py          # Package marker
│       ├── ffmpeg_utils.py      # FFmpeg/FFprobe binary resolution, transition/effect maps,
│       │                        #   _probe_duration_clip(), _extract_thumb(), _compute_video_dur()
│       ├── ass_writer.py        # ASS subtitle file generator (_ass_time(), _write_ass())
│       └── project_ops.py       # Project archive pack/unpack/finalize helpers
│
├── core/
│   ├── audio.py                 # WAV I/O, timestamped export
│   ├── history_manager.py       # Audio history CRUD
│   ├── voice_manager.py         # Saved voices CRUD
│   ├── log.py                   # app_log(), print_progress()
│   └── schemas.py               # Pydantic shared models
│
├── services/
│   ├── tts_windows.py           # pyttsx3 (SAPI) synthesis
│   ├── tts_xtts.py              # Coqui XTTS v2 — lazy model load
│   └── sse.py                   # run_synth_stream(), sse_frame()
│
├── middleware/
│   └── no_cache.py              # No-cache headers for JS/CSS (pure ASGI)
│
└── static/
    ├── index.html               # Single page, all 8 tabs + modals
    ├── css/
    │   ├── base.css             # Tokens, layout, grid
    │   ├── image-video.css      # Image Video Editor styles
    │   └── ...
    └── js/
        ├── app.js               # Entry — lazy tab initialisation
        ├── api.js               # fetch helpers + SSE parser
        ├── audio-manager.js     # Singleton — one AudioPlayer at a time
        ├── events.js            # Cross-tab EventTarget bus
        ├── icons.js             # Inline SVG icons
        ├── logger.js            # Floating activity log panel
        ├── modal.js             # Promise-based confirm / prompt modals
        ├── toast.js             # Toast notifications
        ├── tabs/
        │   ├── windows.js       # Windows Voices tab
        │   ├── cloning.js       # XTTS Voice Cloning tab
        │   ├── saved.js         # My Voices tab
        │   ├── subtitles.js     # Subtitles tab
        │   ├── video.js         # Video tab
        │   ├── history.js       # History tab
        │   ├── logs.js          # Logs tab
        │   └── image-video.js   # Image Video Editor tab (imports from imgvid/)
        └── imgvid/              # Image Video Editor frontend modules
            ├── constants.js     # TRANSITIONS, EFFECTS_DEF, FONTS, ANIMS lookup tables
            ├── utils.js         # Pure utility functions: uid, fmt, buildCSSFilter,
            │                    #   hexToRgba, snap, totalDur, clipAtTime, getSnapTargets
            ├── waveform.js      # drawWaveform(), probeAudioDuration() with module cache
            ├── export.js        # Export helpers (stub — extraction in progress)
            └── preview.js       # Preview zoom helpers (stub — extraction in progress)
```

---

## API Reference

### Voices

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/voices/windows` | List Windows SAPI voices |
| `GET` | `/api/voices/saved` | List saved voice profiles |
| `GET` | `/api/voices/saved/{name}/audio` | Download saved voice WAV |
| `POST` | `/api/voices/saved` | Upload and save a voice profile |
| `PUT` | `/api/voices/saved/{name}` | Rename saved voice |
| `DELETE` | `/api/voices/saved/{name}` | Delete saved voice |

### Synthesis (SSE streams)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/synthesize/windows` | `{ text, voice, rate, volume }` | Windows voice synthesis |
| `POST` | `/api/synthesize/xtts` | multipart: `audio, text, language` | XTTS voice cloning + synthesis |
| `POST` | `/api/synthesize/saved` | `{ text, voice, language }` | Saved voice synthesis |

All synthesis endpoints return `text/event-stream`.  
Events: `progress { value, desc }` · `done { audio_url, filename, status }` · `error { status }`

### Subtitles

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/subtitles` | List SRT files |
| `POST` | `/api/subtitles` | Save SRT `{ name, content }` |
| `GET` | `/api/subtitles/{name}` | Get SRT content |
| `GET` | `/api/subtitles/{name}/vtt` | Convert SRT → WebVTT |
| `PUT` | `/api/subtitles/{name}` | Rename SRT file |
| `DELETE` | `/api/subtitles/{name}` | Delete SRT file |

### Transcription (SSE)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/transcribe/audio` | Transcribe audio → SRT (Whisper) |
| `POST` | `/api/transcribe/video` | Extract audio from video → SRT (Whisper) |

### Video

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/video/ffmpeg-status` | Check FFmpeg availability |
| `POST` | `/api/video/upload` | Upload source video |
| `GET` | `/api/video/file/{name}` | Stream uploaded video for preview |
| `POST` | `/api/video/burn` | Burn subtitles into video (SSE, 24+ style params) |
| `GET` | `/api/video/output/{name}` | Download processed video |
| `GET` | `/api/video/history` | List processed videos |
| `PUT` | `/api/video/history/{name}` | Rename processed video |
| `DELETE` | `/api/video/history/{name}` | Delete processed video |

### Image Video Editor

**Media Upload**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/images` | Upload image (JPG/PNG/WebP/BMP) |
| `GET` | `/api/imgvid/images/{name}` | Serve uploaded image |
| `POST` | `/api/imgvid/clips` | Upload video clip; returns thumbnail URL + duration |
| `GET` | `/api/imgvid/clips/{name}` | Serve uploaded clip |
| `GET` | `/api/imgvid/thumbs/{name}` | Serve clip thumbnail |
| `POST` | `/api/imgvid/audio` | Upload audio track |
| `GET` | `/api/imgvid/audio/{name}` | Serve audio track |
| `POST` | `/api/imgvid/extract-audio` | Extract audio from video clip as WAV |

**Projects**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/imgvid/projects` | List projects (excludes templates) |
| `POST` | `/api/imgvid/projects` | Create project |
| `GET` | `/api/imgvid/projects/{pid}` | Get project data |
| `PUT` | `/api/imgvid/projects/{pid}` | Update project |
| `PATCH` | `/api/imgvid/projects/{pid}` | Rename project |
| `DELETE` | `/api/imgvid/projects/{pid}` | Delete project |
| `POST` | `/api/imgvid/projects/{pid}/save-as-template` | Copy project and mark as template |
| `GET` | `/api/imgvid/projects/{pid}/pack` | Download project as `.project` archive |

**Templates**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/imgvid/templates` | List saved templates |

**Project Files (.project format)**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/project/unpack` | Load `.project` file (upload) |
| `POST` | `/api/imgvid/project/save-to-path` | Save `.project` to a path on disk |
| `GET` | `/api/imgvid/project/browse` | Browse directory for `.project` files |
| `POST` | `/api/imgvid/project/load-from-path` | Load `.project` from disk path |

**Export**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/export` | Export video (SSE stream) |
| `POST` | `/api/imgvid/export-audio` | Export audio-only mix (SSE stream) |
| `GET` | `/api/imgvid/output/{name}` | Download exported file |

Video export request body (multipart form):
- `project_json` — JSON string: `{ slides, audio, subtitles, pip }`
- `output_format` — `mp4` / `mov` / `mkv` / `m4v` / `avi` / `webm` / `ogv` / `flv` / `wmv` / `mpeg` / `gif`
- `codec` — `h264` / `h265` / `vp9` / `vp8` / `av1` / `prores` / `mpeg4` / `` (empty = auto)
- `resolution` — e.g. `1920x1080`
- `fps` — `24` / `25` / `30` / `60`
- `quality` — `low` / `medium` / `high` / `lossless`
- `audio_only` — `false` (always false for this endpoint; use `/export-audio` for audio-only)

Audio export request body (multipart form):
- `project_json` — JSON string with `audio` array
- `audio_format` — `mp3` / `wav` / `flac` / `aac` / `ogg` / `m4a` / `opus`
- `quality` — `low` / `medium` / `high` / `lossless`

**Slide object schema** (in `slides` array):

```json
{
  "id": "abc123",
  "type": "image",
  "file": "uuid.jpg",
  "fileUrl": "/api/imgvid/images/uuid.jpg",
  "duration": 3.0,
  "transition": { "type": "fade", "duration": 0.5 },
  "effects": [{ "type": "brightness", "value": 20 }],
  "imgScale": 100,
  "imgOffsetX": 0,
  "imgOffsetY": 0,
  "crop": { "x": 10, "y": 10, "w": 80, "h": 80 }
}
```

**Audio track schema**:

```json
{
  "id": "def456",
  "file": "uuid.mp3",
  "fileUrl": "/api/imgvid/audio/uuid.mp3",
  "volume": 1.0,
  "fadeIn": 0,
  "fadeOut": 2,
  "startOffset": 5.0,
  "trimIn": 0,
  "duration": 30.0,
  "speed": 1.0,
  "originalDuration": 120.0
}
```

**Subtitle schema** (in top-level `subtitles` array):

```json
{
  "id": "ghi789",
  "text": "Привет мир",
  "start": 1.0,
  "end": 4.0,
  "x": 50,
  "y": 88,
  "w": 0,
  "h": 0,
  "fontFamily": "Arial",
  "fontSize": 40,
  "color": "#ffffff",
  "bold": false,
  "italic": false,
  "underline": false,
  "outline": 2,
  "outlineColor": "#000000",
  "shadow": 1,
  "shadowColor": "#000000",
  "bgColor": "#000000",
  "bgOpacity": 0,
  "animation": "fade-in",
  "animDuration": 0.6,
  "karaokeEnable": true,
  "karaokeColor": "#ffdd00",
  "karaokeMode": "word"
}
```

### Style Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates` | List video subtitle style templates |
| `POST` | `/api/templates` | Save template `{ name, settings }` |
| `GET` | `/api/templates/{name}` | Get template settings |
| `PUT` | `/api/templates/{name}` | Rename template |
| `DELETE` | `/api/templates/{name}` | Delete template |

### Audio History

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/history` | List generated audio files |
| `GET` | `/api/history/{name}/audio` | Download audio file |
| `PUT` | `/api/history/{name}` | Rename audio file |
| `DELETE` | `/api/history/{name}` | Delete audio file |

### XTTS

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/xtts/status` | XTTS install status + supported languages |

### Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/logs` | List log files |
| `GET` | `/api/logs/{name}` | Read log file content |
| `PUT` | `/api/logs/{name}` | Save edited log content |
| `PATCH` | `/api/logs/{name}` | Rename log file |
| `DELETE` | `/api/logs/{name}` | Delete log file |

---

## Supported Languages (XTTS v2 + Whisper)

| Language | Code |
|----------|------|
| Russian | `ru` |
| English | `en` |
| German | `de` |
| French | `fr` |
| Spanish | `es` |
| Italian | `it` |
| Polish | `pl` |
| Ukrainian | `uk` |

---

## Troubleshooting

**No voices in Windows Voices dropdown**  
Run `add_voices_admin.bat` as administrator, then restart the app.

**Voice Cloning tab shows "XTTS not installed"**  
Run `install.bat` — it checks and installs XTTS automatically.  
The model (~1.8 GB) is downloaded on first use.

**Video tab — "FFmpeg not found"**  
Place `ffmpeg.exe` in the `ffmpeg/` folder or add it to your system PATH.  
Download: https://ffmpeg.org/download.html

**Image Video Editor — export fails**  
Check that FFmpeg is installed. Open the Логи tab to see the full FFmpeg error output.

**Whisper transcription is slow**  
Whisper runs on CPU by default if no CUDA GPU is detected.  
A NVIDIA GPU with CUDA dramatically speeds up transcription.

**Port 7860 already in use**  
Change the port at the bottom of `app.py`:
```python
uvicorn.run(app, host="127.0.0.1", port=7861, ...)
```

**Old JS/CSS still loading after a code change**  
The server sends `Cache-Control: no-store` for all JS and CSS.  
Do a hard refresh: `Ctrl + Shift + R`.

---

## License

MIT — free to use, modify, and distribute.
