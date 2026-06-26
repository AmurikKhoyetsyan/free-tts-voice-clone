# TTS — Text-to-Speech & AI Voice Cloning (Windows)

> **Offline speech synthesis + neural voice cloning** on your local machine.  
> No API keys. No cloud. Runs 100% locally.

[![Python](https://img.shields.io/badge/Python-3.10+-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688)](https://fastapi.tiangolo.com/)
[![XTTS v2](https://img.shields.io/badge/Voice%20Cloning-XTTS%20v2-green)](https://github.com/coqui-ai/TTS)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)](https://www.microsoft.com/windows)

---

## What is this?

A local **text-to-speech web app** with four tabs served by **FastAPI** and a hand-written
**HTML / CSS / ES-module** frontend — no React, no Gradio, no external UI framework.

| Tab | Engine | Internet required |
|-----|--------|-------------------|
| **Windows Voices** | pyttsx3 + Windows SAPI / OneCore | No |
| **Voice Cloning (XTTS v2)** | Coqui XTTS v2 (neural network) | Only for first model download |
| **My Voices** | Reuses saved voice profiles | No |
| **History** | File manager for generated audio | No |

---

## Features

- **Fully offline** — base TTS uses built-in Windows voices (Irina, Pavel, Zira, David, ...)
- **AI voice cloning** — [Coqui XTTS v2](https://github.com/coqui-ai/TTS): zero-shot multilingual synthesis
- **Saved voice profiles** — save a cloned voice by name, reuse without re-uploading
- **Canvas waveform player** — custom `<canvas>` audio player with WaveSurfer-style bars, no CDN, 60 fps smooth progress via `requestAnimationFrame`
- **SSE progress streaming** — real-time synthesis progress streamed from server to browser via Server-Sent Events
- **Lazy tab loading** — each tab initialises only when first visited; page load is instant
- **No external JS dependencies** — every module is a local ES module served from `static/js/`
- **Multilingual** — Russian, English, German, French, Spanish, Italian, Polish, Ukrainian
- **GPU acceleration** — CUDA auto-detected for fast XTTS cloning
- **History management** — play, rename, delete generated files from the UI

---

## Supported Languages (Voice Cloning)

| Label | Code |
|-------|------|
| Russian | `ru` |
| English | `en` |
| Deutsch | `de` |
| Francais | `fr` |
| Espanol | `es` |
| Italiano | `it` |
| Polski | `pl` |
| Ukrainian | `uk` |

---

## Requirements

| Component | Version |
|-----------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10+ |
| GPU | NVIDIA CUDA (optional, faster XTTS cloning) |
| Disk space | ~500 MB base / ~4 GB with XTTS v2 model |

---

## Installation

### 1. Clone or download

```bash
git clone https://github.com/AmurKhoyetsyan/tts.git
cd tts
```

### 2. Install base dependencies

```bash
pip install -r requirements.txt
```

### 3. (Optional) Unlock additional Windows voices

Windows hides OneCore voices (Irina, Pavel, ...) from SAPI by default.
Run **once as administrator**:

```
add_voices_admin.bat
```

After running, restart the app — new voices appear in the dropdown.

### 4. (Optional) Install XTTS v2 for voice cloning

```bash
install_xtts.bat
```

Downloads the Coqui TTS library and XTTS v2 model weights (~2 GB library + ~1.8 GB model on first launch).

**Manual install:**

```bash
pip install TTS

# GPU (CUDA 11.8):
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# CPU only:
pip install torch torchaudio
```

---

## Running

```bash
python app.py
```

The server starts at `http://127.0.0.1:7860` and opens the browser automatically.  
Stop with `Ctrl+C`.

---

## Project Structure

```
tts/
|-- app.py                      # FastAPI setup, middleware, router mounting, entrypoint
|-- requirements.txt
|-- install_xtts.bat            # XTTS v2 installer
|-- add_voices_admin.bat        # OneCore voice registration (requires admin)
|-- add_voices.py               # Registry script called by the bat above
|
|-- middleware/
|   `-- no_cache.py             # NoCacheStaticMiddleware -- forces fresh JS/CSS on reload
|
|-- routers/                    # FastAPI routers (one file per API group)
|   |-- voices.py               # GET/POST/PUT/DELETE /api/voices/*
|   |-- xtts.py                 # GET /api/xtts/status
|   |-- synthesis.py            # POST /api/synthesize/{windows,xtts,saved}
|   `-- history.py              # GET/PUT/DELETE /api/history/*
|
|-- core/                       # Business logic -- no FastAPI dependencies
|   |-- schemas.py              # Shared Pydantic models (RenameBody)
|   |-- audio.py                # WAV I/O: wav_to_numpy, save_named_audio
|   |-- history_manager.py      # History file CRUD
|   `-- voice_manager.py        # Saved voices CRUD
|
|-- services/                   # External integrations and synthesis engines
|   |-- sse.py                  # SSE streaming helper: run_synth_stream, sse_frame
|   |-- tts_windows.py          # Windows SAPI synthesis via pyttsx3
|   `-- tts_xtts.py             # Coqui XTTS v2 neural voice cloning
|
`-- static/                     # Frontend -- plain HTML/CSS/ES modules, no framework
    |-- index.html              # Single-page shell with all 4 tabs
    |-- css/
    |   |-- base.css            # CSS variables, layout, toasts
    |   |-- tabs.css
    |   |-- forms.css
    |   |-- audio.css           # Audio player styles (.ap-wave, .ap-play, ...)
    |   |-- custom-select.css
    |   |-- voices.css
    |   |-- history.css
    |   |-- modal.css
    |   |-- logger.css
    |   |-- file-upload.css
    |   `-- loader.css
    `-- js/
        |-- app.js              # Entry point -- lazy tab initialisation
        |-- api.js              # fetch helpers + SSE stream parser
        |-- audio-manager.js    # Singleton: only one AudioPlayer plays at a time
        |-- audio-player.js     # Custom audio player (play/pause/seek/download)
        |-- wave-renderer.js    # Canvas waveform renderer (WaveSurfer look-alike, no CDN)
        |-- custom-select.js    # Custom dropdown select component
        |-- events.js           # Cross-tab EventTarget bus
        |-- file-upload.js      # Drag-and-drop file upload component
        |-- icons.js            # Inline SVG strings
        |-- loader.js           # Spinner and skeleton helpers
        |-- logger.js           # Floating activity log panel
        |-- modal.js            # Promise-based confirm/prompt modals
        |-- tabs.js             # Tab switching
        |-- toast.js            # Toast notifications
        `-- tabs/
            |-- windows.js      # Windows Voices tab
            |-- cloning.js      # XTTS Voice Cloning tab
            |-- saved.js        # My Voices tab
            `-- history.js      # History tab
```

---

## Architecture

### Backend — FastAPI

`app.py` is a thin entry point. All logic lives in focused modules:

| Layer | Responsibility |
|-------|----------------|
| `routers/` | HTTP route handlers, request/response validation |
| `services/sse.py` | Runs synthesis in a worker thread, streams progress via SSE |
| `services/tts_*.py` | Synthesis engines -- accept `progress=cb` callback |
| `core/` | Pure business logic: file I/O, CRUD, Pydantic schemas |
| `middleware/` | HTTP-level concerns (cache headers) |

### SSE Synthesis Flow

```
POST /api/synthesize/{engine}
        |
        v
routers/synthesis.py  -->  run_synth_stream(core_fn, args)
        |
        |-- spawns worker thread
        |       `-- core_fn(*args, progress=cb)
        |               |-- cb(0.1, "Initialising...")  -->  queue.put(("progress", ...))
        |               |-- cb(0.5, "Synthesising...")  -->  queue.put(("progress", ...))
        |               `-- returns (audio_path, status)
        |
        `-- async generator polls queue --> yields SSE frames
                event: progress  data: {"value": 0.5, "desc": "Synthesising..."}
                event: done      data: {"audio_url": "...", "filename": "...", "status": "..."}
                event: error     data: {"status": "... error ..."}
```

### Frontend — ES Modules

`app.js` boots on page load. Only the **Windows** tab initialises immediately; all other tabs
initialise lazily the first time the user clicks them — reducing startup API calls from 4 to 1.

```
app.js
  |-- launch('windows')              <-- immediate on page load
  `-- on tab click --> launch(name)  <-- lazy init, once per tab
```

### Audio Player and Waveform

`AudioPlayer` (`audio-player.js`) owns a native `<audio>` element for playback and a
`WaveRenderer` (`wave-renderer.js`) for the canvas waveform.

- **Waveform**: fetches audio via `fetch` + Web Audio API `decodeAudioData`, computes per-bar
  peak amplitudes, draws with Canvas 2D -- same visual as WaveSurfer bar mode
  (`barWidth:2  barGap:1  barRadius:2  height:40`).
- **Smooth progress**: a `requestAnimationFrame` loop (60 fps) updates the waveform fill and
  time display while audio plays.
- **Singleton**: `audioManager` ensures only one player plays at a time across all tabs.

---

## API Reference

### Voices

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/voices/windows` | List Windows SAPI voices + default |
| `GET` | `/api/voices/saved` | List saved voice profiles |
| `GET` | `/api/voices/saved/{name}/audio` | Stream saved voice WAV |
| `POST` | `/api/voices/saved` | Upload + save a voice profile |
| `PUT` | `/api/voices/saved/{name}` | Rename a saved voice |
| `DELETE` | `/api/voices/saved/{name}` | Delete a saved voice |

### XTTS

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/xtts/status` | XTTS install status + language map |

### Synthesis (SSE)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/synthesize/windows` | `{text, voice, rate, volume}` | Synthesise with Windows SAPI |
| `POST` | `/api/synthesize/xtts` | multipart `{audio, text, language}` | Clone + synthesise with XTTS |
| `POST` | `/api/synthesize/saved` | `{text, voice, language}` | Synthesise with saved voice |

All synthesis endpoints return `text/event-stream` (SSE).

### History

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/history` | List generated audio files (newest first) |
| `GET` | `/api/history/{name}/audio` | Download a generated WAV |
| `PUT` | `/api/history/{name}` | Rename a history file |
| `DELETE` | `/api/history/{name}` | Delete a history file |

---

## Troubleshooting

**No voices in Windows Voices dropdown**  
Run `add_voices_admin.bat` as administrator, then restart the app.

**Voice Cloning tab shows "XTTS v2 not installed"**  
Run `install_xtts.bat` and restart. The model (~1.8 GB) is downloaded on first use.

**RuntimeError during voice cloning**  
PyTorch version mismatch. The app patches `torch.load` and `Xtts.load_checkpoint` automatically.
If errors persist:
```bash
pip install torch==2.1.0 torchaudio==2.1.0 --index-url https://download.pytorch.org/whl/cu118
```

**Waveform does not appear**  
The canvas waveform decodes audio via the Web Audio API (supported in all modern browsers).
If the waveform is flat, the audio file may be silent or corrupted.

**Port 7860 already in use**  
Change the port in `app.py`:
```python
uvicorn.run(app, host="127.0.0.1", port=7861, log_level="info")
```

**Old JS still loading after a code change**  
The server sends `Cache-Control: no-store` for all JS/CSS. Do a hard refresh: `Ctrl + Shift + R`.

---

## License

MIT -- free to use, modify, and distribute.
