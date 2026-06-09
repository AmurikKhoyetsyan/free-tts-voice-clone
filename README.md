# TTS — Speech Synthesis & Voice Cloning

A web application built with **Gradio** with two modes:

- **Windows Voices** — offline synthesis using built-in Windows voices (SAPI / pyttsx3)
- **Voice Cloning (XTTS v2)** — neural network synthesis with voice cloning from an audio sample

---

## Requirements

| Component | Version |
|---|---|
| Windows | 10 / 11 |
| Python | 3.10 (recommended) |

> **Note:** `run.bat` and `install_xtts.bat` are configured for the `Python 3.10` path.  
> If your Python is installed elsewhere — edit those files before running.

---

## Installation — Step by Step

### Step 1 — Clone the repository

```bash
git clone https://github.com/AmurKhoyetsyan/tts.git
cd tts
```

Or download the ZIP from GitHub and extract it to any folder.

---

### Step 2 — Install dependencies

Open a terminal in the project folder and run:

```bash
pip install -r requirements.txt
```

This installs:
- `gradio` — web UI
- `pyttsx3` — Windows voices
- `numpy` — audio processing
- `soundfile` — WAV file reading/writing

---

### Step 3 — (Optional) Add more Windows voices

By default `pyttsx3` only sees SAPI voices.  
To add **Windows OneCore** voices (Irina, Pavel, etc.):

1. Run `add_voices_admin.bat` — it will automatically request administrator privileges
2. Wait for the message `Done! Added X voices`
3. Restart the application

> This is a one-time operation. No need to run it again.

---

### Step 4 — (Optional) Install XTTS v2 for voice cloning

If you want to use the **"Voice Cloning"** tab:

1. Run `install_xtts.bat`
2. Wait for the Coqui TTS installation to finish (~2–3 GB)
3. On first launch the `xtts_v2` model will download automatically (~2 GB)

> A **CUDA-capable GPU** (NVIDIA) is recommended for faster cloning.  
> CPU mode works but is significantly slower.

---

## Running the App

### Option 1 — via BAT file (recommended)

Double-click `run.bat`

The browser will open automatically with the application interface.

---

### Option 2 — via terminal

```bash
python app.py
```

Then open in your browser: `http://127.0.0.1:7860`

---

## Usage

### Tab "Windows Voices"

| Field | Description |
|---|---|
| Text | Enter any text to synthesize |
| Voice | Choose a voice from the list (Russian voices appear at the top) |
| Speed | From 50 to 350 words/min (default 150) |
| Volume | From 0 to 100% (default 90%) |

Click **"Synthesize"** — the audio will appear on the right and can be downloaded.

---

### Tab "Voice Cloning (XTTS v2)"

| Field | Description |
|---|---|
| Text | Enter text in the selected language |
| Voice sample | Upload a WAV/MP3 file 10–30 seconds long or record from microphone |
| Text language | Russian, English, Deutsch, Français, Español, Italiano, Polski, Українська |

> **Sample requirements:** clean speech with no music or background noise, 10–30 seconds.  
> Cloning quality depends directly on the quality of the recording.

Click **"Clone and Synthesize"** — generation takes from 10 seconds to a few minutes depending on your hardware.

---

## Project Structure

```
tts/
├── app.py                  # Main application
├── requirements.txt        # Base dependencies
├── run.bat                 # Launch the application
├── install_xtts.bat        # Install Coqui TTS / XTTS v2
├── add_voices.py           # Script to register OneCore voices
├── add_voices_admin.bat    # Run add_voices.py with administrator privileges
└── voice_for_copy/         # Sample audio files for voice cloning
    ├── voice_1.wav
    └── voice_2.wav
```

---

## Troubleshooting

### No voices in the list
Run `add_voices_admin.bat` as administrator and restart the application.

### XTTS not installed
The app status will show: _"XTTS v2 is not installed"_.  
Run `install_xtts.bat` and restart the application.

### Cloning error: `RuntimeError`
Usually caused by a PyTorch version mismatch. Make sure you are using Python 3.10 and try:
```bash
pip install torch==2.1.0 --index-url https://download.pytorch.org/whl/cpu
```

### App does not open in the browser
Open it manually: [http://127.0.0.1:7860](http://127.0.0.1:7860)
