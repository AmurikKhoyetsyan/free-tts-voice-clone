# API Reference

All endpoints are served at `http://127.0.0.1:7860`. All JSON bodies use UTF-8.  
Synthesis and export endpoints return `text/event-stream` (SSE).

---

## Voices

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/voices/windows` | List Windows SAPI voices |
| `GET` | `/api/voices/saved` | List saved voice profiles |
| `GET` | `/api/voices/saved/{name}/audio` | Download saved voice WAV |
| `POST` | `/api/voices/saved` | Upload and save a voice profile |
| `PUT` | `/api/voices/saved/{name}` | Rename saved voice |
| `DELETE` | `/api/voices/saved/{name}` | Delete saved voice |

---

## Synthesis (SSE streams)

All synthesis endpoints return `text/event-stream`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/synthesize/windows` | JSON | Windows SAPI synthesis |
| `POST` | `/api/synthesize/xtts` | multipart | XTTS voice cloning + synthesis |
| `POST` | `/api/synthesize/saved` | JSON | Saved voice synthesis |

**Windows body**
```json
{ "text": "Привет мир", "voice": "HKEY_LOCAL_MACHINE\\...", "rate": 0, "volume": 1.0 }
```

**XTTS multipart fields**
- `audio` — WAV/MP3 reference sample (10–30 s)
- `text` — text to synthesise
- `language` — language code (`ru`, `en`, `de`, `fr`, `es`, `it`, `pl`, `uk`)

**Saved voice body**
```json
{ "text": "Привет мир", "voice": "my-voice", "language": "ru" }
```

**SSE frame format**
```
event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/<name>/audio", "filename": "<name>", "status": "✓ Готово"}

event: error
data: {"status": "❌ Ошибка: ..."}
```

---

## Subtitles

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/subtitles` | List SRT files |
| `POST` | `/api/subtitles` | Save SRT file |
| `GET` | `/api/subtitles/{name}` | Get SRT content |
| `GET` | `/api/subtitles/{name}/vtt` | Convert SRT → WebVTT |
| `PUT` | `/api/subtitles/{name}` | Rename SRT file |
| `DELETE` | `/api/subtitles/{name}` | Delete SRT file |

**POST body**
```json
{ "name": "my-subtitles", "content": "1\n00:00:01,000 --> 00:00:04,000\nПривет мир\n" }
```

---

## Transcription (SSE)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/transcribe/audio` | multipart: `file` | Transcribe audio → SRT (Whisper) |
| `POST` | `/api/transcribe/video` | multipart: `file` | Extract audio from video → SRT (Whisper) |

---

## Video

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/video/ffmpeg-status` | Check FFmpeg availability |
| `POST` | `/api/video/upload` | Upload source video |
| `GET` | `/api/video/file/{name}` | Stream uploaded video |
| `POST` | `/api/video/burn` | Burn subtitles into video (SSE) |
| `GET` | `/api/video/output/{name}` | Download processed video |
| `GET` | `/api/video/history` | List processed videos |
| `PUT` | `/api/video/history/{name}` | Rename processed video |
| `DELETE` | `/api/video/history/{name}` | Delete processed video |

**Burn multipart fields** (24+ style params):
- `video` — source video file
- `srt_content` — SRT subtitle text
- `output_format` — `mp4` / `webm` / `mkv` / `mov` / `m4v`
- `font_family`, `font_size`, `font_color` — typography
- `bold`, `italic`, `underline` — `true` / `false`
- `outline`, `outline_color`, `shadow`, `shadow_color` — text decoration
- `bg_color`, `bg_opacity` — subtitle background box
- `position_x`, `position_y` — subtitle position (%)
- `karaoke` — `true` to enable word-highlight animation
- `karaoke_color` — highlight colour

---

## Audio History

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/history` | List generated audio files |
| `GET` | `/api/history/{name}/audio` | Download audio file |
| `PUT` | `/api/history/{name}` | Rename audio file |
| `DELETE` | `/api/history/{name}` | Delete audio file |

---

## XTTS

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/xtts/status` | XTTS install status + supported languages |

---

## Style Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates` | List video subtitle style templates |
| `POST` | `/api/templates` | Save template |
| `GET` | `/api/templates/{name}` | Get template settings |
| `PUT` | `/api/templates/{name}` | Rename template |
| `DELETE` | `/api/templates/{name}` | Delete template |

**POST body**
```json
{ "name": "my-template", "settings": { "font_family": "Arial", "font_size": 40, "..." : "..." } }
```

---

## Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/logs` | List log files |
| `GET` | `/api/logs/{name}` | Read log file content |
| `PUT` | `/api/logs/{name}` | Save edited log content |
| `PATCH` | `/api/logs/{name}` | Rename log file |
| `DELETE` | `/api/logs/{name}` | Delete log file |

---

## Image Video Editor

### Media Upload

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/images` | Upload image (JPG / PNG / WebP / BMP) |
| `GET` | `/api/imgvid/images/{name}` | Serve uploaded image |
| `POST` | `/api/imgvid/clips` | Upload video clip; returns `{ url, thumbUrl, duration }` |
| `GET` | `/api/imgvid/clips/{name}` | Serve uploaded clip |
| `GET` | `/api/imgvid/thumbs/{name}` | Serve clip thumbnail |
| `POST` | `/api/imgvid/audio` | Upload audio track |
| `GET` | `/api/imgvid/audio/{name}` | Serve audio track |
| `POST` | `/api/imgvid/extract-audio` | Extract audio from video clip as WAV |

### Projects

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

### Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/imgvid/templates` | List saved templates |

### Project Files (`.project` format)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/project/unpack` | Load `.project` file (upload) |
| `POST` | `/api/imgvid/project/save-to-path` | Save `.project` to a path on disk |
| `GET` | `/api/imgvid/project/browse` | Browse directory for `.project` files |
| `POST` | `/api/imgvid/project/load-from-path` | Load `.project` from disk path |

### Export

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imgvid/export` | Export video (SSE stream) |
| `POST` | `/api/imgvid/export-audio` | Export audio-only mix (SSE stream) |
| `GET` | `/api/imgvid/output/{name}` | Download exported file |

**Video export — multipart form fields**

| Field | Values | Description |
|-------|--------|-------------|
| `project_json` | JSON string | `{ slides, audio, subtitles, pip }` |
| `output_format` | `mp4` `mov` `mkv` `m4v` `avi` `webm` `ogv` `flv` `wmv` `mpeg` `gif` | Container format |
| `codec` | `h264` `h265` `vp9` `vp8` `av1` `prores` `mpeg4` `` | Video codec (`""` = auto from format) |
| `resolution` | `1280x720` `1920x1080` `2560x1440` `3840x2160` or `WxH` | Output resolution |
| `fps` | `24` `25` `30` `60` | Frames per second |
| `quality` | `low` `medium` `high` `lossless` | Encoding quality preset |

**Audio export — multipart form fields**

| Field | Values | Description |
|-------|--------|-------------|
| `project_json` | JSON string | `{ audio }` — audio array only |
| `audio_format` | `mp3` `wav` `flac` `aac` `ogg` `m4a` `opus` | Output audio format |
| `quality` | `low` `medium` `high` `lossless` | Encoding quality |

---

## Data Schemas

### Slide object

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

`type` is `"image"` or `"video"`. For video clips, `file` points to `clips/`. Transition `type` can be `"none"` or any of the 22 xfade names (see [Architecture → ffmpeg_utils.py](architecture.md)).

### Audio track object

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

### Subtitle object

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

`animation` options: `""` / `"fade-in"` / `"fade-out"` / `"slide-up"` / `"slide-down"` / `"typewriter"` / `"zoom-in"`.  
`karaokeMode`: `"word"` (word-by-word) / `"cumulative"` (highlights all words up to current).

### PIP (picture-in-picture) object

```json
{
  "id": "pip001",
  "file": "uuid.jpg",
  "fileUrl": "/api/imgvid/images/uuid.jpg",
  "type": "image",
  "x": 10,
  "y": 10,
  "w": 30,
  "h": 20,
  "opacity": 1.0,
  "volume": 1.0,
  "startTime": 0,
  "endTime": 5.0
}
```
