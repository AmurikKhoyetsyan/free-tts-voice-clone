# TTS — Text-to-Speech, Voice Cloning & Subtitle Editor (Windows)

> **Offline speech synthesis + neural voice cloning + video subtitle burning** on your local machine.
> No API keys. No cloud. Runs 100% locally.

[![Python](https://img.shields.io/badge/Python-3.10+-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)](https://fastapi.tiangolo.com/)
[![XTTS v2](https://img.shields.io/badge/Voice%20Cloning-XTTS%20v2-green)](https://github.com/coqui-ai/TTS)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)](https://www.microsoft.com/windows)

---

## What is this?

A local **text-to-speech and subtitle web app** with six tabs, served by **FastAPI** and a
hand-written **HTML / CSS / ES-module** frontend — no React, no Gradio, no external UI framework.

| Tab | What it does |
|-----|-------------|
| **Windows голоса** | TTS with Windows SAPI / OneCore built-in voices |
| **Клонирование (XTTS v2)** | Zero-shot neural voice cloning from a 10–30 s audio sample |
| **Мои голоса** | Library of saved voice profiles — synthesise without re-uploading |
| **Субтитры** | SRT subtitle editor, Whisper audio transcription, saved subtitles |
| **Видео** | Upload video, edit subtitles visually, burn to video with FFmpeg |
| **История** | File browser for audio, subtitles, video and style templates |

---

## Features

### Text-to-Speech
- **Windows voices** — built-in SAPI5 / OneCore (Irina, Pavel, Zira, David, …), adjustable rate and volume
- **XTTS v2 voice cloning** — Coqui neural TTS, 8 languages, GPU-accelerated
- **Saved voices** — store cloned voice profiles by name and reuse them
- **SSE progress streaming** — real-time synthesis progress streamed to browser

### Subtitle Editor
- Create and edit SRT subtitle tracks with start/end times and per-row duration
- Waveform display of the loaded video audio — click or drag to seek
- Whisper speech-to-text transcription from audio file or uploaded video
- Save subtitles as versioned SRT files (`name_vYYYYMMDD_HHMMSS.srt`) — never overwrites
- Load any saved SRT from a dropdown and edit it

### Video Subtitle Burning (FFmpeg)
- Upload any video format; preview with subtitle overlay in the browser
- Full subtitle styling:
  - Font family, size, **bold**, *italic*, underline
  - Text colour, outline, drop shadow
  - Background box — colour, opacity, padding, border radius
  - Position preset (top / middle / bottom) or pixel-exact X/Y
  - Text wrap max-width, vertical margin, subtitle box width/height in px
  - **Karaoke mode** — animated word-by-word colour highlight
- Style templates — save any style combination as a named template; apply from Video tab
- Output format: MP4, WebM, MKV, MOV, M4V; optional resize / letterbox / crop

### History
- **Audio** — play, rename, download, delete generated WAV files
- **Subtitles** — preview SRT content, restore any version to the Video editor, download, rename, delete
- **Video** — preview, download, rename, delete processed videos
- **Templates** — view style templates as JSON with visual text preview, delete

---

## Requirements

| Component | Version |
|-----------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10+ |
| FFmpeg | Optional — required for video burning and video transcription |
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

Double-click **`install.bat`**.

It will:
- Find Python automatically (PATH → py launcher → common install paths)
- Install all packages from `requirements.txt` (skips already-installed ones)
- Check if XTTS v2 is installed — installs it if not, skips if already present

### 3. (Optional) Unlock additional Windows voices

Windows hides OneCore voices (Irina, Pavel, …) from SAPI by default.
Run **once as administrator**:

```
add_voices_admin.bat
```

Restart the app after running — new voices appear in the dropdown.

### 4. Install FFmpeg (for Video tab)

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

All output is stored inside the project directory:

```
.output/
├── audio/          # Generated TTS audio files (.wav)
├── subtitle/       # SRT subtitle versions (.srt)
├── templates/      # Style templates (.json)
└── video/
    ├── src/        # Uploaded source videos (temporary)
    └── *_sub.*     # Processed videos with burned subtitles

saved_voices/       # Saved XTTS voice profiles (.wav)
```

---

## Project Structure

```
tts/
├── app.py                      # FastAPI entry point, middleware, router mounting
├── requirements.txt            # Python dependencies
├── install.bat                 # Smart installer (checks before installing)
├── run.bat                     # Launch the app
├── add_voices_admin.bat        # Register OneCore voices in SAPI (run as admin)
├── add_voices.py               # Registry script used by the bat above
│
├── routers/                    # FastAPI route handlers
│   ├── voices.py               # /api/voices/* — Windows + saved voices
│   ├── synthesis.py            # /api/synthesize/* — SSE synthesis streams
│   ├── xtts.py                 # /api/xtts/status
│   ├── subtitles.py            # /api/subtitles/* — SRT CRUD
│   ├── video.py                # /api/video/* — upload, burn, history
│   ├── transcribe.py           # /api/transcribe/* — Whisper transcription
│   ├── templates.py            # /api/templates/* — style templates
│   ├── history.py              # /api/history/* — audio history
│   └── log_router.py           # /api/log
│
├── core/
│   ├── audio.py                # WAV I/O, timestamped file export
│   ├── history_manager.py      # Audio history CRUD
│   └── voice_manager.py        # Saved voices CRUD
│
├── services/
│   ├── tts_windows.py          # pyttsx3 synthesis with progress callback
│   └── tts_xtts.py             # Coqui XTTS v2 — lazy model load, GPU/CPU
│
├── middleware/
│   └── no_cache.py             # Forces no-cache on all JS/CSS (dev convenience)
│
└── static/                     # Frontend — plain HTML/CSS/ES modules
    ├── index.html              # Single page, all 6 tabs + modals
    ├── css/
    │   ├── base.css            # Tokens, layout, toasts, grid utilities
    │   ├── tabs.css
    │   ├── forms.css
    │   ├── audio.css
    │   ├── voices.css
    │   ├── history.css
    │   ├── subtitles.css       # Subtitle editor, waveform, templates
    │   ├── modal.css
    │   ├── logger.css
    │   ├── file-upload.css
    │   ├── custom-select.css
    │   └── loader.css
    └── js/
        ├── app.js              # Entry — lazy tab init
        ├── api.js              # fetch helpers + SSE parser
        ├── audio-manager.js    # Singleton — one player at a time
        ├── audio-player.js     # Custom <audio> wrapper
        ├── wave-renderer.js    # Canvas waveform renderer
        ├── custom-select.js    # Custom dropdown component
        ├── file-upload.js      # Drag-and-drop upload component
        ├── events.js           # Cross-tab EventTarget bus
        ├── icons.js            # Inline SVG icons
        ├── loader.js           # Skeleton loaders
        ├── logger.js           # Floating activity log panel
        ├── modal.js            # Promise-based confirm / prompt modals
        ├── tabs.js             # Tab switching
        ├── toast.js            # Toast notifications
        └── tabs/
            ├── windows.js      # Windows Voices tab
            ├── cloning.js      # XTTS Voice Cloning tab
            ├── saved.js        # My Voices tab
            ├── subtitles.js    # Subtitles tab
            ├── video.js        # Video tab
            └── history.js      # History tab (audio / subtitles / video / templates)
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
| `POST` | `/api/synthesize/windows` | JSON: `text, voice, rate, volume` | Synthesise with Windows voice |
| `POST` | `/api/synthesize/xtts` | multipart: `audio, text, language` | Clone and synthesise with XTTS |
| `POST` | `/api/synthesize/saved` | JSON: `text, voice, language` | Synthesise with saved voice |

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

### Transcription (SSE streams)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/transcribe/audio` | Transcribe uploaded audio → SRT (Whisper) |
| `POST` | `/api/transcribe/video` | Extract audio from uploaded video → SRT (Whisper) |

### Video

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/video/ffmpeg-status` | Check FFmpeg availability |
| `POST` | `/api/video/upload` | Upload source video |
| `GET` | `/api/video/file/{name}` | Stream uploaded video for preview |
| `POST` | `/api/video/burn` | Burn subtitles into video (SSE stream, 24+ style params) |
| `GET` | `/api/video/output/{name}` | Download processed video |
| `GET` | `/api/video/history` | List processed videos |
| `PUT` | `/api/video/history/{name}` | Rename processed video |
| `DELETE` | `/api/video/history/{name}` | Delete processed video |

### Style Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates` | List templates |
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
Run `install.bat` — it checks and installs XTTS automatically if missing.
The model (~1.8 GB) is downloaded on first use.

**Video tab — "FFmpeg not found"**
Place `ffmpeg.exe` in the `ffmpeg/` folder or add it to your system PATH.
Download: https://ffmpeg.org/download.html

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
