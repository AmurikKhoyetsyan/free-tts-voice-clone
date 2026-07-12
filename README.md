# TTS Studio — Text-to-Speech, Voice Cloning & Video Editor (Windows)

> **Offline speech synthesis · neural voice cloning · subtitle editor · image/video editor**  
> Runs 100% locally. No API keys. No cloud.

[![Python](https://img.shields.io/badge/Python-3.10+-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)](https://fastapi.tiangolo.com/)
[![XTTS v2](https://img.shields.io/badge/Voice%20Cloning-XTTS%20v2-green)](https://github.com/coqui-ai/TTS)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)](https://www.microsoft.com/windows)

---

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](docs/user-guide.md) | How to use each tab — TTS, cloning, subtitles, video, Image Video Editor |
| [Architecture](docs/architecture.md) | Backend routers, service packages, frontend modules, SSE pipeline |
| [API Reference](docs/api.md) | All endpoints, request/response schemas, export options |
| [Developer Guide](docs/developer-guide.md) | Adding routes, tabs, transitions, effects; SSE pattern; project format |

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
| **Редактор** | Full image/video editor — timeline, transitions, effects, subtitles, audio with sound effects, PIP, template system, export |

---

## Features (highlights)

- **Windows TTS** — SAPI5 / OneCore voices, adjustable rate and volume, optional SRT generation
- **XTTS v2 voice cloning** — Coqui neural TTS, 8 languages, GPU-accelerated (CPU fallback)
- **Subtitle burning** — full styling (font, colour, karaoke), style templates, FFmpeg output
- **Image Video Editor** — non-linear timeline, 22 transitions, per-clip effects, ASS subtitles, PIP layers, audio split/trim, cursor-relative zoom (Ctrl+Scroll)
- **Audio effects** — 14 per-track sound effects (echo, reverb, bass boost, treble, compressor, phone, radio, low/high-pass filter, chorus, flanger, distortion, noise gate, pitch shift); speed 0.25×–4× + custom
- **Custom audio player** — waveform drag-to-scrub, synchronized seekbar with progress fill, skip ±5 s, speed 0.5×–2×, download
- **Template system** — save any project as a reusable template; apply via a drag-and-drop modal (single multi-file zone for slides, individual DnD zones for audio/PIP)
- **Export** — 11 video formats (MP4 / MOV / MKV / AVI / WebM / GIF / …), 7 codecs (H.264 / H.265 / VP9 / …), audio-only export (MP3 / WAV / FLAC / AAC / OGG / M4A / OPUS)
- **Projects** — save/load as `.project` archives (JSON + all media packed into a ZIP)
- **SSE streaming** — real-time synthesis and export progress in the browser

---

## Requirements

| Component | Version |
|-----------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10+ |
| FFmpeg | Required for Video tab and Image Video Editor export |
| GPU | NVIDIA CUDA (optional — speeds up XTTS and Whisper) |
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

## Project Structure

```
tts/
├── app.py                       # FastAPI entry point, middleware, router mounting
├── requirements.txt
├── install.bat / run.bat / add_voices_admin.bat
│
├── routers/
│   ├── voices.py  synthesis.py  xtts.py  subtitles.py
│   ├── video.py  transcribe.py  templates.py  history.py  log_router.py
│   ├── image_video.py           # /api/imgvid/* — Image Video Editor (routes only)
│   └── imgvid/                  # Image Video Editor service package
│       ├── ffmpeg_utils.py      # FFmpeg binary resolution, transition/effect maps, probe helpers
│       ├── ass_writer.py        # ASS subtitle file generator
│       └── project_ops.py       # Project archive pack/unpack/finalize
│
├── core/          audio.py  history_manager.py  voice_manager.py  log.py  schemas.py
├── services/      tts_windows.py  tts_xtts.py  sse.py
├── middleware/    no_cache.py
│
└── static/
    ├── index.html               # Single page, all 8 tabs + modals
    ├── css/
    └── js/
        ├── app.js  api.js  audio-manager.js  events.js  icons.js
        ├── audio-player.js      # waveform drag-to-scrub, seekbar, play/download
        ├── wave-renderer.js     # canvas waveform renderer used by AudioPlayer
        ├── loader.js  logger.js  modal.js  toast.js  tabs.js
        ├── tabs/
        │   ├── windows.js  cloning.js  saved.js  subtitles.js
        │   ├── video.js  ffmpeg.js  templates.js  history.js  logs.js
        │   └── image-video.js   # Редактор tab (imports from imgvid/)
        └── imgvid/              # Image Video Editor frontend sub-modules
            ├── constants.js     # TRANSITIONS, EFFECTS_DEF, FONTS, ANIMS
            ├── utils.js         # Pure utility functions (uid, fmt, snap, totalDur, …)
            ├── waveform.js      # drawWaveform(), probeAudioDuration() with cache
            ├── export.js        # export helpers stub
            └── preview.js       # preview zoom helpers stub
```

Full module descriptions → [Architecture](docs/architecture.md)  
All API endpoints → [API Reference](docs/api.md)

---

## Supported Languages (XTTS v2 + Whisper)

Russian · English · German · French · Spanish · Italian · Polish · Ukrainian

---

## License

MIT — free to use, modify, and distribute.
