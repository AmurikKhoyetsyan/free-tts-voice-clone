# Developer Guide

## Environment

| Requirement | Version |
|-------------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10+ |
| FFmpeg | Required for Video and Image Video Editor |
| GPU | NVIDIA CUDA (optional — speeds XTTS and Whisper) |

```bash
# Install dependencies
pip install -r requirements.txt

# Run the app (FastAPI on http://127.0.0.1:7860)
python app.py

# Register additional OneCore voices (requires admin)
add_voices_admin.bat
```

There is **no lint step, no test runner, and no build step**. The frontend is plain ES modules served directly by FastAPI's `StaticFiles`. Edit a `.js` file, hard-refresh the browser (`Ctrl+Shift+R`) — that's it.

> The no-cache middleware (`middleware/no_cache.py`) sends `Cache-Control: no-store` for all `/static/js/` and `/static/css/` responses, so a normal refresh usually suffices. Hard-refresh is only needed if the browser cached a response before the middleware was applied.

---

## Project layout

```
tts/
├── app.py                      # Entry point
├── routers/                    # One APIRouter per feature
│   └── imgvid/                 # Image Video Editor service package
├── core/                       # Shared utilities (audio, history, voice, log, schemas)
├── services/                   # TTS engines + SSE helper
├── middleware/                  # ASGI no-cache middleware
└── static/
    ├── index.html
    ├── css/
    └── js/
        ├── tabs/               # One module per tab
        └── imgvid/             # Image Video Editor sub-modules
```

For a full description of each module's responsibility, see [Architecture](architecture.md).

---

## Adding a new backend route

### 1. Create the router file

```python
# routers/my_feature.py
from fastapi import APIRouter
router = APIRouter()

@router.get("/hello")
async def hello():
    return {"message": "Hello"}
```

### 2. Mount it in `app.py`

```python
from routers.my_feature import router as my_feature_router
app.include_router(my_feature_router, prefix="/api/my-feature")
```

That's all. FastAPI auto-generates `/docs` (Swagger UI) and `/redoc` entries for the new routes.

---

## Adding a new tab

### 1. Add the tab button and panel in `index.html`

```html
<!-- Tab button (inside .tabs-header) -->
<button class="tab-btn" data-tab="my-tab">My Tab</button>

<!-- Tab panel (inside .tabs-body) -->
<div class="tab-pane" data-tab="my-tab">
  <!-- tab HTML here -->
</div>
```

### 2. Create the tab module

```javascript
// static/js/tabs/my-tab.js
export function init() {
  // set up DOM listeners here
}
```

### 3. Register in `app.js`

```javascript
import { init as initMyTab } from './tabs/my-tab.js';

// Inside the tab click handler:
case 'my-tab':
  if (!ready.has('my-tab')) { initMyTab(); ready.add('my-tab'); }
  break;
```

Tabs initialise lazily — only on the first click. Keep `init()` idempotent (called once, guarded by the `ready` Set).

---

## SSE streaming pattern

Use this pattern for any long-running operation (synthesis, export, transcription):

### Backend

```python
from services.sse import run_synth_stream, sse_frame
import asyncio, queue
from fastapi.responses import StreamingResponse

@router.post("/my-stream")
async def my_stream(text: str = Form(...)):
    def core(text, progress=None):
        # ... do work ...
        if progress:
            progress(0.5, "Halfway done")
        # ... more work ...
        return result

    return StreamingResponse(
        run_synth_stream(core, [text]),
        media_type="text/event-stream"
    )
```

### Frontend

```javascript
import { synthesizeStream } from '../api.js';

synthesizeStream('/api/my-feature/my-stream', { body: formData }, {
  progress(value, desc) { /* update progress bar */ },
  done(payload)        { /* payload.audio_url, payload.status */ },
  error(msg)           { /* show error */ },
});
```

---

## Adding a new Image Video transition

Transitions are applied via FFmpeg's `xfade` filter.

### 1. Add to `_XFADE` in `routers/imgvid/ffmpeg_utils.py`

```python
_XFADE = {
    # existing entries ...
    "my-transition": "distance",   # xfade filter name
}
```

### 2. Add to `TRANSITIONS` in `static/js/imgvid/constants.js`

```javascript
export const TRANSITIONS = {
  // existing entries ...
  "my-transition": { label: "My Transition", xfade: "distance" },
};
```

### 3. Add an `<option>` to the transition `<select>` in `index.html`

```html
<option value="my-transition">My Transition</option>
```

That's all. The FFmpeg filter chain in `image_video.py` reads `_XFADE[slide["transition"]["type"]]` and builds the filter automatically.

---

## Adding a new image/clip effect

Effects are applied via FFmpeg's `vf` filter chain.

### 1. Add to `_EFFECTS` in `routers/imgvid/ffmpeg_utils.py`

```python
_EFFECTS = {
    # existing entries ...
    "flip": "hflip",   # FFmpeg vf filter name / expression
}
```

### 2. Add to `EFFECTS_DEF` in `static/js/imgvid/constants.js`

```javascript
export const EFFECTS_DEF = {
  // existing entries ...
  flip: { label: "Flip H", type: "toggle", default: false },
};
```

### 3. Add a control in `index.html` inside the Effects panel

```html
<label>
  <input type="checkbox" id="ive-effect-flip"> Flip H
</label>
```

### 4. Wire it up in `image-video.js`

Read the value when building the effects array for a slide, and render it in `_renderEffectsPanel()`.

---

## Project file format (`.project`)

A `.project` file is a ZIP archive:

```
project.json        # full project data ({ slides, audio, subtitles, pip, name })
images/uuid.jpg     # all referenced images
clips/uuid.mp4      # all referenced video clips
audio/uuid.mp3      # all referenced audio tracks
```

`project_ops.py` handles pack/unpack. When unpacking, `fileUrl` fields in the JSON are rewritten to point to the server's `/api/imgvid/*` endpoints after the media is saved to disk.

---

## ASS subtitle format

Subtitles in the Image Video Editor are exported as an **ASS** (Advanced SubStation Alpha) file burned via FFmpeg's `subtitles=file.ass` filter. The generator is in `routers/imgvid/ass_writer.py`.

Key details:
- Timing uses centiseconds (`H:MM:SS.cs`) — `_ass_time(seconds)`.
- Each subtitle generates one or more `Dialogue:` lines.
- Karaoke word-highlight uses `{\k<cs>}word ` tags with cumulative timing.
- Animations use `\fad()`, `\move()`, `\t()` override tags.

---

## Output directories

All output is written under `.output/` (created automatically on first run):

```
.output/
├── audio/          # TTS WAV files
├── subtitle/       # SRT files
├── templates/      # Video style templates (JSON)
├── video/src/      # Uploaded source videos
├── video/          # Processed videos with burned subtitles
└── imgvid/
    ├── images/     # Images for Image Video Editor
    ├── clips/      # Video clips
    ├── audio/      # Audio tracks
    ├── thumbs/     # Thumbnails
    ├── projects/   # Project JSON + template JSON
    └── output/     # Exported videos / audio files
```

`.output/` is not committed to git (listed in `.gitignore`).

---

## Logging

```python
from core.log import app_log

app_log("Processing started", level="INFO", source="my_feature")
```

Logs are written to `.logs/YYYY-MM-DD.log` and to stdout simultaneously. The Логи tab reads them via `/api/logs`.
