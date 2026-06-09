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

A local **text-to-speech (TTS) web app** with three tabs:

| Tab | Engine | Internet |
|---|---|---|
| **Windows Voices** | pyttsx3 + Windows SAPI / OneCore | Not required |
| **Voice Cloning (XTTS v2)** | Coqui XTTS v2 (neural network) | Only for first model download |
| **My Voices** | Reuses saved voice profiles | Not required |

**Voice cloning** lets you upload a 10–30 second voice sample and synthesize any text in that voice — in Russian, English, German, French, Spanish, Italian, Polish, or Ukrainian.  
**My Voices** lets you save a cloned voice once and reuse it anytime — no need to re-upload the sample.

---

## Features

- **Free & open source** — no subscriptions, no cloud, no data sent anywhere
- **Offline TTS** — works without internet using built-in Windows voices (Irina, Pavel, David, Zira, and more)
- **AI voice cloning** — powered by [Coqui XTTS v2](https://github.com/coqui-ai/TTS), one of the best open-source multilingual TTS models
- **Saved voice profiles** — save a cloned voice by name and reuse it instantly without re-uploading
- **Rename & delete voices** — manage your saved voice library from the UI
- **Gradio web UI** — simple browser interface, no coding required
- **Multilingual** — Russian, English, German, French, Spanish, Italian, Polish, Ukrainian
- **GPU acceleration** — CUDA support for fast voice cloning on NVIDIA GPUs
- **Named WAV export** — downloads are saved as `audio-YYYY-MM-DD_HH-MM-SS.wav`
- **Microphone recording** — record a voice sample directly in the browser

---

## Supported Languages (Voice Cloning)

`Russian` `English` `Deutsch` `Français` `Español` `Italiano` `Polski` `Українська`

---

## Requirements

| Component | Version |
|---|---|
| OS | Windows 10 / 11 |
| Python | 3.10 (recommended) |
| GPU | NVIDIA CUDA (optional, for faster cloning) |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/AmurKhoyetsyan/tts.git
cd tts
```

Or download the ZIP and extract it.

### 2. Install base dependencies

```bash
pip install -r requirements.txt
```

Installs: `gradio`, `pyttsx3`, `numpy`, `soundfile`

### 3. (Optional) Add more Windows voices

Windows includes **OneCore voices** (Irina, Pavel, etc.) that are hidden from SAPI by default.  
Run `add_voices_admin.bat` as administrator to unlock them — one-time operation.

### 4. (Optional) Install XTTS v2 for voice cloning

```bash
# Double-click or run:
install_xtts.bat
```

Downloads Coqui TTS (~2 GB) + XTTS v2 model (~2 GB on first launch).

---

## Running

```bash
# Option 1 — double-click:
run.bat

# Option 2 — terminal:
python app.py
```

Opens automatically at `http://127.0.0.1:7860`

---

## How It Works

### Tab: Windows Voices

Uses **Windows SAPI / pyttsx3** — fully offline, instant synthesis.

| Setting | Range | Default |
|---|---|---|
| Voice | System voices | Irina (if available) |
| Speed | 50–350 wpm | 150 |
| Volume | 0–100% | 90% |

### Tab: Voice Cloning (XTTS v2)

Uses **Coqui XTTS v2** — a state-of-the-art multilingual neural TTS model.

1. Upload a clean voice sample (WAV/MP3, 10–30 seconds, no background noise)
2. Or record directly from your microphone
3. Enter text and select the language
4. Click **"Clone and Synthesize"**
5. (Optional) Enter a name and click **"Save"** to save the voice for future use

Generation time: ~10 seconds on GPU, up to a few minutes on CPU.

---

### Tab: My Voices

Reuse previously saved voice profiles — no need to re-upload an audio sample.

1. Select a saved voice from the dropdown
2. Enter text and select the language
3. Click **"Synthesize"**

**Managing voices:**

| Action | How |
|---|---|
| Save | In the "Voice Cloning" tab — enter a name and click "Save" |
| Rename | Type a new name in the rename field and click "Rename" |
| Delete | Select the voice and click 🗑 |
| Refresh list | Click ⟳ to reload voices added in another tab |

Saved voices are stored in the `saved_voices/` folder as WAV files.

---

## Project Structure

```
tts/
├── app.py                      # Entry point — assembles tabs and launches Gradio
├── requirements.txt            # Base dependencies
├── run.bat                     # Launch script
├── install_xtts.bat            # Coqui TTS / XTTS v2 installer
├── add_voices.py               # OneCore voice registration script
├── add_voices_admin.bat        # Run add_voices.py with admin rights
├── saved_voices/               # Saved voice profiles (WAV files)
├── voice_for_copy/             # Sample WAV files for voice cloning
│   ├── voice_1.wav
│   └── voice_2.wav
├── core/                       # Business logic
│   ├── audio.py                # WAV helpers, named file export
│   ├── tts_windows.py          # Windows SAPI / pyttsx3 synthesis
│   ├── tts_xtts.py             # Coqui XTTS v2 cloning
│   └── voice_manager.py        # Save / load / rename / delete voices
└── ui/                         # Gradio tab components
    ├── windows_tab.py          # "Windows Voices" tab
    ├── cloning_tab.py          # "Voice Cloning" tab
    └── my_voices_tab.py        # "My Voices" tab
```

---

## Troubleshooting

**No voices in the dropdown**  
→ Run `add_voices_admin.bat` as administrator and restart.

**XTTS not installed**  
→ The status bar will say _"XTTS v2 is not installed"_. Run `install_xtts.bat`.

**RuntimeError during cloning**  
→ PyTorch version mismatch. Fix:
```bash
pip install torch==2.1.0 --index-url https://download.pytorch.org/whl/cpu
```

**Browser doesn't open**  
→ Open manually: [http://127.0.0.1:7860](http://127.0.0.1:7860)

---

## Related Projects & Alternatives

> **Searching for:** free TTS Windows, offline text to speech Python, voice cloning open source, Coqui TTS GUI, XTTS v2 interface, pyttsx3 web UI, speech synthesis Russian, локальный синтез речи, клонирование голоса бесплатно

- [Coqui TTS](https://github.com/coqui-ai/TTS) — the underlying XTTS v2 engine
- [Gradio](https://github.com/gradio-app/gradio) — the web UI framework used

---

## License

MIT — free to use, modify, and distribute.
