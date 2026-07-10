# User Guide

## Starting the app

Double-click **`run.bat`**, or from a terminal:

```bash
python app.py
```

The browser opens automatically at **http://127.0.0.1:7860**. Stop with `Ctrl+C`.

---

## Tab: Windows Voices

Synthesises text using built-in Windows SAPI voices (Irina, Pavel, Zira, David, …).

1. Select a voice from the dropdown.
2. Adjust **Rate** (speed) and **Volume** sliders.
3. Enter text in the text area.
4. Click **Синтезировать** — progress streams in real time.
5. The result appears as an audio player. Use **История** tab to manage saved files.

**Generate subtitles** — check the box before synthesising; an SRT file is generated alongside the audio.

> If the dropdown is empty, run `add_voices_admin.bat` as administrator and restart the app. See [Troubleshooting](#troubleshooting).

---

## Tab: Клонирование (XTTS v2)

Zero-shot voice cloning from a 10–30 second reference audio.

1. Upload a reference WAV or MP3 (drag-and-drop or click the upload zone).
2. Select the **language** of the text you will synthesise.
3. Enter text and click **Клонировать + Синтезировать**.
4. Optionally click **Сохранить голос** to save the profile for reuse.

The XTTS v2 model (~1.8 GB) downloads on first use. GPU (NVIDIA CUDA) dramatically speeds synthesis; CPU fallback works but is slow.

---

## Tab: Мои голоса

Library of saved voice profiles created in the Cloning tab.

- Select a profile from the list, enter text, click **Синтезировать**.
- **Rename** or **Delete** voices using the icons in the list.
- Changes fire a `voices-changed` event so the Cloning tab refreshes automatically.

---

## Tab: Субтитры

SRT subtitle editor with Whisper transcription.

1. **Transcribe** — upload audio or video; Whisper generates a draft SRT.
2. **Edit** — add, remove, or adjust subtitle blocks (start/end time, text).
3. **Save** — give it a name; saved as a versioned file (`name_vYYYYMMDD_HHMMSS.srt`).
4. **Load** — pick any saved SRT from the dropdown.

The waveform below the editor is rendered from the audio. Click or drag to seek.

---

## Tab: Видео

Burns styled subtitles into a video file using FFmpeg.

1. Upload a video (any format FFmpeg supports).
2. Select an SRT file or paste SRT content.
3. Adjust subtitle style: font, size, colour, bold/italic/underline, outline, shadow, background box, position.
4. Optionally enable **Karaoke** — animated word-by-word colour highlight.
5. Click **Записать субтитры** — progress streams in real time.
6. Download or preview the result.

**Style templates** — save any style combination as a named template and load it in future sessions.

---

## Tab: История

File browser with four sections (select in the top bar):

| Section | Contents |
|---------|----------|
| **Аудио** | Generated TTS audio files. Play, download, rename, delete. |
| **Субтитры** | Saved SRT files. Open in editor, rename, delete. |
| **Видео** | Processed videos. Preview, download, rename, delete. |
| **Шаблоны** | Video subtitle style templates. Load, rename, delete. |

---

## Tab: Image Video Editor

A full non-linear video editor in the browser. See sections below.

### Media panel (left sidebar)

- **Images** — upload JPG / PNG / WebP / BMP. Drag from the panel onto the timeline.
- **Clips** — upload video clips. A thumbnail and duration are shown.
- **Audio** — upload MP3 / WAV / FLAC / OGG / M4A. Drag onto the audio track.

### Timeline

| Action | How |
|--------|-----|
| Add clip | Drag image or video from the media panel onto the **Video** track |
| Reorder clips | Drag a clip left or right |
| Resize clip duration | Drag the right edge of a clip |
| Left-trim video | Drag the left edge of a video clip (sets in-point) |
| Move audio block | Drag the audio block |
| Resize audio block | Drag the right edge |
| Split audio | Place playhead inside an audio block, click ✂ **Разделить** |
| Add subtitle | Click **+ Субтитр** button |
| Move subtitle | Drag it on the subtitle track |
| Resize subtitle duration | Drag its right edge |
| Zoom timeline | `Ctrl + Scroll` — zooms relative to the cursor position |
| Scrub | Click or drag on the time ruler |

### Preview

- **Fit** / **100%** / **Custom%** — zoom buttons; or `Ctrl + Scroll` inside the preview to zoom relative to the cursor.
- Click anywhere in the preview to seek.
- Drag subtitle or PIP elements directly in the preview to reposition.

### Image Transform (right panel — Slide tab)

| Control | Effect |
|---------|--------|
| Scale % | Zoom the image (10–500%) |
| Offset X / Y | Pan within the frame |
| Crop | Open the crop dialog; drag handles or enter exact X/Y/W/H |

All transforms are applied in FFmpeg export — the preview matches the export exactly.

### Transitions

Select a transition for a clip from the **Transition** dropdown in the Slide panel. Set its **Duration** (seconds). The 22 available types:

Fade, Cross Fade, Dissolve, Fade Black, Fade White, Slide Left, Slide Right, Slide Up, Slide Down, Wipe Left, Wipe Right, Wipe Up, Wipe Down, Zoom In, Pixelize, Blur, Circle, Radial, Fade Grays, H Slice, V Slice.

### Effects (per clip)

In the **Effects** tab of the right panel:

- Brightness, Contrast, Saturation (sliders)
- Blur, Sharpen, Film Grain (sliders)
- Grayscale, Sepia, Vignette, Invert (toggles)

### Subtitles

Select a subtitle on the timeline or in the preview to open its properties:

- Text, Start / End time
- Position X / Y (%), Width %, Height px
- Font, Size, Colour, Bold / Italic / Underline
- Outline size + colour, Shadow size + colour
- Background colour + opacity
- Animation: fade-in / fade-out / slide-up / slide-down / typewriter / zoom-in
- **Karaoke** — enable word-by-word highlight; choose highlight colour and mode (word / cumulative)

### PIP (Picture-in-Picture)

Click **+ PIP** to add an overlay layer:

- Upload an image or video
- Drag to position; resize with handles in the preview
- Set Opacity and Volume
- Adjust Start / End time on the timeline

### Audio

Add audio tracks by dragging from the Audio media panel. Per track:

- Volume slider
- Fade-in / Fade-out (seconds)
- Start Offset — where the track starts in the video timeline
- Trim In — where playback starts within the audio file
- Speed (0.5×–2×)

### Export

Click **Экспорт** to open the export dialog:

| Option | Values |
|--------|--------|
| Format | MP4, MOV, MKV, M4V, AVI, WebM, OGV, FLV, WMV, MPEG, GIF, Аудио MP3/WAV/FLAC/AAC/OGG/M4A/OPUS |
| Codec | Auto, H.264, H.265, VP9, VP8, AV1, ProRes, MPEG-4 |
| Resolution | 1280×720, 1920×1080, 2560×1440, 3840×2160, Custom |
| FPS | 24, 25, 30, 60 |
| Quality | Low, Medium, High, Lossless |

Progress streams in real time. The exported file appears in **История → Видео**.

### Projects

- **Сохранить** — saves the current project (JSON + all media packed into a `.project` archive).
- **Загрузить** — open a saved project from the list.
- **Сохранить как шаблон** — marks the project as a template; appears in the Templates section for future reuse.
- **Обзор** — browse the file system for a `.project` file and load it.

---

## Troubleshooting

**No voices in Windows Voices dropdown**  
Run `add_voices_admin.bat` as administrator, then restart the app.

**Cloning tab shows "XTTS not installed"**  
Run `install.bat` — it checks and installs XTTS automatically. The model (~1.8 GB) downloads on first use.

**"FFmpeg not found"**  
Place `ffmpeg.exe` in the `ffmpeg/` folder inside the project, or add it to your system PATH.  
Download: https://ffmpeg.org/download.html

**Image Video Editor export fails**  
Open the **Логи** tab to see the full FFmpeg error output.

**Whisper transcription is slow**  
Whisper uses CPU if no CUDA GPU is detected. A NVIDIA GPU with CUDA dramatically speeds it up.

**Port 7860 already in use**  
Change the port at the bottom of `app.py`:
```python
uvicorn.run(app, host="127.0.0.1", port=7861, ...)
```

**Old JS/CSS still loading after a code change**  
The server sends `Cache-Control: no-store` for all JS and CSS. Do a hard refresh: `Ctrl + Shift + R`.
