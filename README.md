# TTS — Free Text to Speech & AI Voice Cloning (Windows)

> **Offline speech synthesis + neural voice cloning** on your local machine.  
> No API keys. No internet required for basic TTS. Runs 100% locally.

[![Python](https://img.shields.io/badge/Python-3.10-blue)](https://www.python.org/)
[![Gradio](https://img.shields.io/badge/UI-Gradio-orange)](https://gradio.app/)
[![XTTS v2](https://img.shields.io/badge/Voice%20Cloning-XTTS%20v2-green)](https://github.com/coqui-ai/TTS)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue)](https://www.microsoft.com/windows)

---

## What is this?

A local **text-to-speech (TTS) web app** with four tabs:

| Tab                         | Engine                           | Internet                      |
|-----------------------------|----------------------------------|-------------------------------|
| **Windows Voices**          | pyttsx3 + Windows SAPI / OneCore | Not required                  |
| **Voice Cloning (XTTS v2)** | Coqui XTTS v2 (neural network)   | Only for first model download |
| **My Voices**               | Reuses saved voice profiles      | Not required                  |
| **History**                 | File manager for generated audio | Not required                  |

**Voice cloning** lets you upload a 10–30 second voice sample and synthesize any text in that voice — in Russian,
English, German, French, Spanish, Italian, Polish, or Ukrainian.  
**My Voices** lets you save a cloned voice once and reuse it anytime without re-uploading the sample.  
**History** shows every generated audio file in a scrollable list with per-row play, rename, and delete controls.

---

## Features

- **Free & open source** — no subscriptions, no cloud, no data sent anywhere
- **Offline TTS** — works without internet using built-in Windows voices (Irina, Pavel, David, Zira, and more)
- **AI voice cloning** — powered by [Coqui XTTS v2](https://github.com/coqui-ai/TTS), one of the best open-source
  multilingual TTS models
- **Saved voice profiles** — save a cloned voice by name and reuse it instantly without re-uploading
- **Rename & delete voices** — manage your saved voice library from the UI
- **Gradio web UI** — simple browser interface, no coding required
- **Multilingual** — Russian, English, German, French, Spanish, Italian, Polish, Ukrainian
- **GPU acceleration** — CUDA support for fast voice cloning on NVIDIA GPUs
- **Named WAV export** — generated files saved as `audio-YYYY-MM-DD_HH-MM-SS.wav`
- **History tab** — scrollable list of all generated audio files; play, rename, or delete each file in-place with confirmation modals
- **Microphone recording** — record a voice sample directly in the browser
- **Real-time progress** — floating activity log panel shows synthesis stages and estimated time
- **Singleton audio manager** — only one audio source plays at a time across all tabs

---

## Supported Languages (Voice Cloning)

| Label      | Code |
|------------|------|
| Русский    | `ru` |
| English    | `en` |
| Deutsch    | `de` |
| Français   | `fr` |
| Español    | `es` |
| Italiano   | `it` |
| Polski     | `pl` |
| Українська | `uk` |

---

## Requirements

| Component  | Version                                    |
|------------|--------------------------------------------|
| OS         | Windows 10 / 11                            |
| Python     | 3.10 (recommended)                         |
| GPU        | NVIDIA CUDA (optional, for faster cloning) |
| Disk space | ~500 MB base, ~4 GB with XTTS v2 model     |

---

## Installation

### 1. Clone or download the repository

```bash
git clone https://github.com/AmurKhoyetsyan/tts.git
cd tts
```

Or download the ZIP and extract it.

### 2. Install base dependencies

```bash
pip install -r requirements.txt
```

This installs:

| Package               | Purpose                              |
|-----------------------|--------------------------------------|
| `gradio >= 6.0`       | Web UI framework                     |
| `pyttsx3 >= 2.90`     | Windows SAPI wrapper for offline TTS |
| `numpy >= 1.22.0`     | Audio array operations               |
| `soundfile >= 0.12.0` | WAV file read/write                  |

### 3. (Optional) Unlock additional Windows voices

Windows includes **OneCore voices** (Irina, Pavel, Zira, David, etc.) that are hidden from SAPI by default. To unlock
them, run once as administrator:

```
add_voices_admin.bat
```

This runs `add_voices.py` with elevated privileges and registers all available OneCore voices in the Windows registry
under `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices`. After running, restart the app — new voices will appear in
the dropdown.

### 4. (Optional) Install XTTS v2 for voice cloning

```bash
install_xtts.bat
```

This installs Coqui TTS and downloads the XTTS v2 model (~2 GB library + ~1.8 GB model weights on first launch).
Requires internet. After installation, restart the app.

**Manual install:**

```bash
pip install TTS
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
# or for CPU only:
pip install torch torchaudio
```

---

## Running

```bash
# Option 1 — double-click:
run.bat

# Option 2 — terminal:
python app.py
```

The app opens automatically at `http://127.0.0.1:7860`

To stop: close the terminal window or press `Ctrl+C`.

---

## How It Works

### Tab: Windows Voices

Uses **Windows SAPI via pyttsx3** — fully offline, near-instant synthesis.

**Controls:**

| Setting | Range         | Default              | Description        |
|---------|---------------|----------------------|--------------------|
| Text    | —             | —                    | Text to synthesize |
| Voice   | System voices | Irina (if available) | Windows SAPI voice |
| Speed   | 50–350 wpm    | 150                  | Words per minute   |
| Volume  | 0–100%        | 90%                  | Output volume      |

**How synthesis works internally:**

1. `pyttsx3` initializes the Windows SAPI5 engine
2. A `started-word` event listener tracks per-word progress (used for the progress bar)
3. Audio is synthesized into a temporary WAV file via `engine.save_to_file()`
4. The temp file is read, converted to a numpy array, and saved as a timestamped file in `.output_audio/`
5. The result is streamed back to the browser in real time

---

### Tab: Voice Cloning (XTTS v2)

Uses **Coqui XTTS v2** — a state-of-the-art multilingual zero-shot TTS model.

**Steps:**

1. Upload a clean voice sample (WAV/MP3, 10–30 seconds recommended, no background noise or music)
2. Or record directly from your microphone
3. Enter the text you want synthesized
4. Select the target language
5. Click **"Clone and Synthesize"**
6. (Optional) Enter a name and click **"Save"** to store the voice for future reuse

**Performance:**

| Hardware          | Approximate time                     |
|-------------------|--------------------------------------|
| NVIDIA GPU (CUDA) | ~5–15 seconds                        |
| CPU only          | 1–5 minutes depending on text length |

**How voice cloning works internally:**

1. The model is loaded lazily on first use and cached globally (`_tts_model`)
2. `torch.load()` and `Xtts.load_checkpoint()` are temporarily patched for compatibility with newer PyTorch versions
3. CUDA is detected automatically; falls back to CPU if unavailable
4. `tts.tts_to_file(text, speaker_wav, language, file_path)` generates the audio
5. Output is post-processed through `core/audio.py` and saved with a timestamp

---

### Tab: History

Browse and manage every audio file generated by the app.

**Controls (per row):**

| Button | Action                                                               |
|--------|----------------------------------------------------------------------|
| ▶      | Loads the file into the player on the right and starts playback      |
| ✏      | Opens a rename modal — enter a new name and click "Save"             |
| 🗑     | Opens a delete confirmation modal — click "Delete" to confirm        |

The list is sorted newest-first and refreshes automatically each time the tab is opened.  
After a rename or delete the row updates in-place without a full page reload.  
Flash messages and activity log entries are shown for every action.

---

### Tab: My Voices

Reuse previously saved voice profiles — no need to re-upload an audio sample.

**Steps:**

1. Select a saved voice from the dropdown (click ▶ to preview it inline)
2. Enter the text and select the language
3. Click **"Synthesize"**

**Voice management:**

| Action  | How                                                                 |
|---------|---------------------------------------------------------------------|
| Save    | In the "Voice Cloning" tab — enter a name and click "Save"          |
| Preview | Click the ▶ button next to the voice name in the dropdown           |
| Rename  | Select a voice, type a new name in the rename field, click "Rename" |
| Delete  | Select a voice and click 🗑                                         |
| Refresh | Click ⟳ to reload the list (useful after saving in another tab)     |

Saved voices are stored as WAV files in the `saved_voices/` directory.

---

## UI Features

### Activity Log Panel

A floating panel (toggled with the **ЛОГ** button on the right edge) shows:

- Real-time synthesis progress with percentage and estimated time remaining
- Click events on UI elements
- Synthesis stage labels (e.g. "Loading model", "Synthesizing word 12/45")
- Completion and error states

The panel is draggable and resizable. Its position and size persist across page reloads via `sessionStorage`.

### Equalizer Loader

While synthesis is running, an animated equalizer overlay appears on Gradio loading components. It turns green on
success and red on error.

### Singleton Audio Manager (`window.__ttsAudio`)

A JavaScript singleton ensures only one audio source plays at a time across all tabs. It:

- Intercepts `HTMLMediaElement.play()` at the prototype level
- Intercepts `AudioBufferSourceNode.start()` for Web Audio API sources (WaveSurfer)
- Suspends/resumes all registered `AudioContext` instances
- Exposes a public API: `play(url)`, `stop()`, `subscribe(fn)`, `isPlaying`, `currentAudio`

Switching tabs automatically stops all playback.

---

## Project Structure

```
tts/
├── app.py                      # Entry point — assembles tabs, loads CSS/JS, launches Gradio
├── requirements.txt            # Base Python dependencies
├── run.bat                     # One-click launch script
├── install_xtts.bat            # XTTS v2 installer script
├── add_voices.py               # OneCore voice registration (run via add_voices_admin.bat)
├── add_voices_admin.bat        # Launches add_voices.py with administrator rights
│
├── static/                     # Static front-end assets (loaded at runtime)
│   ├── styles.css              # All CSS: logger panel, EQ loader, dropdown play buttons
│   └── js/
│       ├── global.js           # Audio manager singleton + activity logger + progress bar
│       └── inject_options.js   # Injects ▶/⏹ play buttons into voice dropdown options
│
├── core/                       # Business logic (no UI dependencies)
│   ├── audio.py                # WAV file I/O, timestamped file export
│   └── voice_manager.py        # Save / load / rename / delete voice profiles
│
├── services/                   # TTS synthesis engines
│   ├── tts_windows.py          # Windows SAPI synthesis via pyttsx3
│   └── tts_xtts.py             # Coqui XTTS v2 neural voice cloning
│
├── ui/                         # Gradio tab components
│   ├── constants.py            # Shared JS snippets (STOP_ALL_JS, PLAY_PREVIEW_JS) + file loaders
│   ├── progress_stream.py      # Worker-thread progress streaming bridge for Gradio
│   ├── windows_tab.py          # "Windows Voices" tab layout and event handlers
│   ├── cloning_tab.py          # "Voice Cloning (XTTS v2)" tab layout and event handlers
│   ├── my_voices_tab.py        # "My Voices" tab layout and event handlers
│   └── history_tab.py          # "History" tab — file list, play/rename/delete modals
│
├── saved_voices/               # User-saved voice profiles (WAV files, git-ignored)
├── voice_for_copy/             # Sample WAV files for testing voice cloning
│   ├── voice_1.wav
│   └── voice_2.wav
└── .output_audio/              # Generated audio output (git-ignored)
```

---

## Code Architecture

### Data Flow: Windows TTS

```
User input (text, voice, rate, volume)
    │
    ▼
ui/windows_tab.py  →  _synthesize()  [input validation]
    │
    ▼
ui/progress_stream.py  →  stream()
    ├── spawns worker thread
    ├── worker calls: services/tts_windows.synthesize(text, voice, rate, volume, progress=cb)
    │       ├── pyttsx3.init()  →  set voice / rate / volume
    │       ├── connect('started-word', on_word)  →  word-by-word progress
    │       ├── engine.save_to_file()  →  temp WAV
    │       ├── core/audio.wav_to_numpy()  →  read temp WAV
    │       └── core/audio.save_named_audio()  →  .output_audio/audio-YYYY-MM-DD_HH-MM-SS.wav
    └── main thread yields progress events to Gradio status textbox
    │
    ▼
Browser: JS polls status textbox every 200ms → updates progress bar + activity log
    │
    ▼
Final yield: (audio_path, "✓ Done — VoiceName (X.Xs)")
```

### Data Flow: XTTS Voice Cloning

```
User input (text, speaker_audio, language)
    │
    ▼
ui/cloning_tab.py  →  _synthesize()  [input validation]
    │
    ▼
ui/progress_stream.py  →  stream()
    ├── spawns worker thread
    ├── worker calls: services/tts_xtts.synthesize(text, speaker_wav, language, progress=cb)
    │       ├── _get_model()  →  lazy-load XTTS v2, cache in _tts_model global
    │       │       ├── patch torch.load() for weights_only compatibility
    │       │       ├── patch Xtts.load_checkpoint() for strict=False
    │       │       ├── TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    │       │       └── .to("cuda") or .to("cpu")
    │       ├── tts.tts_to_file(text, speaker_wav, language, file_path=tmp)
    │       ├── core/audio.wav_to_numpy()  →  read temp WAV
    │       └── core/audio.save_named_audio()  →  .output_audio/audio-YYYY-MM-DD_HH-MM-SS.wav
    └── main thread yields progress events to Gradio
    │
    ▼
(Optional) User clicks "Save" →  core/voice_manager.save_voice(audio_path, name)
    └── copies WAV to saved_voices/{name}.wav
```

### Data Flow: My Voices Preview

```
User clicks ▶ on a dropdown option
    │
    ▼
static/js/inject_options.js  →  playVoice(name)
    ├── reads URL map from #voice_urls_data hidden textbox
    ├── builds candidate URL list:
    │       /gradio_api/file={abs_path}
    │       /file={abs_path}
    │       /gradio_api/file=saved_voices/{name}.wav
    │       /file=saved_voices/{name}.wav
    └── window.__ttsAudio.play(url)  →  tries each URL in order
            ├── stops all other audio (pause + currentTime=0)
            ├── suspends all AudioContext instances
            └── plays via internal <audio> element
```

### `ui/progress_stream.py` — Streaming Bridge

Bridges blocking synthesis functions with Gradio's async generator interface:

```python
def stream(core_fn, args):
    # Runs core_fn(*args, progress=cb) in a worker thread.
    # Worker puts progress events into a Queue.
    # Main thread (generator) yields from the Queue without sleep-polling.
    # Yields:  (None, "[NN%] description")  for each progress event
    # Yields:  (audio_path, final_status)   as the final result
```

Progress format: `[NNN%] description` — parsed by browser JS to update the progress bar.

### `ui/constants.py` — Shared JS Snippets

| Name              | Type   | Description                                                                                  |
|-------------------|--------|----------------------------------------------------------------------------------------------|
| `STOP_ALL_JS`     | `str`  | JS that stops all audio before synthesis starts. Used as `js=` on every synthesize button.   |
| `PLAY_PREVIEW_JS` | `str`  | JS that plays the hidden preview audio through `window.__ttsAudio` when a voice is selected. |
| `_load_css()`     | `func` | Reads `static/styles.css` and returns its content as a string.                               |
| `_load_js(name)`  | `func` | Reads `static/js/{name}` and returns its content as a string.                                |

---

## Output Files

| Location         | Pattern                         | Created by                         |
|------------------|---------------------------------|------------------------------------|
| `.output_audio/` | `audio-YYYY-MM-DD_HH-MM-SS.wav` | Every synthesis (Windows or XTTS)  |
| `saved_voices/`  | `{name}.wav`                    | "Save" button in Voice Cloning tab |

Both directories are created automatically on first run and excluded from git.

---

## Troubleshooting

**No voices appear in the Windows Voices dropdown**

Run `add_voices_admin.bat` as administrator, then restart the app. This registers OneCore voices in the Windows
registry.

**Voice Cloning tab shows "XTTS v2 is not installed"**

Run `install_xtts.bat` and restart the app. The model (~1.8 GB) is downloaded on first synthesis.

**`RuntimeError` or `TypeError` during voice cloning**

PyTorch version mismatch. The app patches `torch.load()` automatically, but if issues persist:

```bash
pip install torch==2.1.0 torchaudio==2.1.0 --index-url https://download.pytorch.org/whl/cu118
# or for CPU:
pip install torch==2.1.0 torchaudio==2.1.0
```

**Synthesis starts but produces no audio / empty file**

- Windows TTS: check that the selected voice is installed in `Control Panel → Speech Recognition → Text to Speech`
- XTTS: the speaker WAV sample must be mono or stereo PCM, at least 3 seconds long

**The browser doesn't open automatically**

Open manually: [http://127.0.0.1:7860](http://127.0.0.1:7860)

**Port 7860 is already in use**

Another Gradio app is running. Stop it or change the port in `app.py`:

```python
app.launch(inbrowser=True, server_port=7861, allowed_paths=[VOICES_DIR, OUTPUT_DIR])
```

**Activity log panel is missing**

The JS may not have loaded (old browser cache). Press `Ctrl+Shift+R` to hard-reload, or restart the server.

---

## Related Projects

- [Coqui TTS](https://github.com/coqui-ai/TTS) — the underlying XTTS v2 engine
- [Gradio](https://github.com/gradio-app/gradio) — the web UI framework used

---

## License

MIT — free to use, modify, and distribute.
