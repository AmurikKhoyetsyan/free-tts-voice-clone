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

> The no-cache middleware (`middleware/no_cache.py`) sends `Cache-Control: no-store` for all `/static/js/` and `/static/css/` responses, so a normal refresh usually suffices.

---

## Project layout

```
tts/
├── app.py                      # Entry point — mounts all routers
├── routers/
│   ├── *.py                    # One APIRouter per feature area
│   └── imgvid/                 # Image Video Editor sub-package
│       ├── *.py                # Service modules (ffmpeg_utils, codec_selector, …)
│       └── routes/             # Sub-routers included by image_video.py
├── core/                       # Shared utilities (audio, history, voice, log, schemas)
├── services/                   # TTS engines + SSE helper
├── middleware/                  # ASGI no-cache middleware
└── static/
    ├── index.html
    ├── css/
    └── js/
        ├── *.js                # Shared UI components
        ├── tabs/               # One module per tab
        └── imgvid/             # Image Video Editor sub-modules
```

For a full description of each module's responsibility, see [Architecture](architecture.md).

---

## Adding a new backend route

### Simple (top-level) route

```python
# routers/my_feature.py
from fastapi import APIRouter
router = APIRouter(prefix="/api/my-feature", tags=["my-feature"])

@router.get("/hello")
async def hello():
    return {"message": "Hello"}
```

Mount it in `app.py`:

```python
from routers import my_feature
app.include_router(my_feature.router)
```

### Sub-router inside the Image Video Editor

Add a new file under `routers/imgvid/routes/`:

```python
# routers/imgvid/routes/my_routes.py
from fastapi import APIRouter
router = APIRouter()

@router.get("/my-endpoint")
async def my_endpoint():
    return {"ok": True}
```

Then include it in `routers/image_video.py`:

```python
from routers.imgvid.routes import my_routes
router.include_router(my_routes.router)
```

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

## Adding an Image Video Editor sub-module

The editor uses a **dependency-injection pattern** for sub-modules. Each module:
1. Imports `S` from `./state.js` for shared state
2. Exports `init(dom, callbacks)` called once by the coordinator (`image-video.js`)
3. Exports render/action functions that the coordinator calls

```javascript
// static/js/imgvid/my-module.js
import { S } from './state.js';

let _dom = {};
let _cb  = {};

export function init(dom, callbacks) {
    _dom = dom;
    _cb  = callbacks;
}

export function doSomething() {
    // read/write S, call _cb.renderAll() to update UI
}
```

The coordinator wires it up:

```javascript
// inside image-video.js init():
import { init as initMyModule, doSomething } from '../imgvid/my-module.js';

initMyModule(dom, { renderAll, pushHistory });
```

---

## SSE streaming pattern

Use this pattern for any long-running operation (synthesis, export, transcription):

### Backend

```python
from services.sse import run_synth_stream
from fastapi.responses import StreamingResponse

@router.post("/my-stream")
async def my_stream(text: str = Form(...)):
    def core(text, progress=None):
        if progress: progress(0.5, "Halfway done")
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

The FFmpeg filter chain in `routers/imgvid/filter_builder.py` reads `_XFADE[slide["transition"]["type"]]` and builds the filter automatically.

---

## Adding a new image/clip effect

Effects are applied via FFmpeg's `vf` filter chain.

### 1. Add to `_EFFECTS` in `routers/imgvid/ffmpeg_utils.py`

```python
_EFFECTS = {
    # existing entries ...
    "flip": "hflip",
}
```

### 2. Add to `EFFECTS_DEF` in `static/js/imgvid/constants.js`

```javascript
export const EFFECTS_DEF = {
  // existing entries ...
  flip: { label: "Flip H", type: "toggle", default: false },
};
```

### 3. Wire it up in `props.js`

Add a control in the slide effects panel (`_renderPropsEffects()` in `static/js/imgvid/props.js`).

---

## Adding a new audio sound effect

Sound effects are applied via FFmpeg audio filters.

### 1. Add to `sfx_filter()` in `routers/imgvid/audio_processor.py`

```python
def sfx_filter(sfx_type: str, sfx: dict) -> str:
    if sfx_type == "my-effect":
        strength = float(sfx.get("strength", 1.0))
        return f"myeffect=strength={strength}"
    # ... other effects
```

### 2. Add the effect to the frontend property panel in `props.js`

---

## Adding a new export codec

### 1. Add to `resolve_codec_name()` in `routers/imgvid/codec_selector.py`

```python
_CODEC_MAP = {
    # existing entries ...
    "my-codec": "libmycodec",
}
```

### 2. Add the codec option to the export dialog in `exp-modal.js`

---

## Project file format (`.project`)

A `.project` file is a ZIP archive:

```
project.json        # full project data ({ slides, audio, subtitles, pip, name })
images/uuid.jpg     # all referenced images
clips/uuid.mp4      # all referenced video clips
audio/uuid.mp3      # all referenced audio tracks
thumbs/uuid.jpg     # extracted thumbnails
```

`routers/imgvid/project_ops.py` handles pack/unpack. When unpacking, `fileUrl` fields in the JSON are rewritten to point to the server's `/api/imgvid/*` endpoints.

---

## ASS subtitle format

Subtitles in the Image Video Editor are exported as **ASS** (Advanced SubStation Alpha) burned via FFmpeg's `subtitles=file.ass` filter. The generator is in `routers/imgvid/ass_writer.py`.

Key details:
- Timing uses centiseconds (`H:MM:SS.cs`) — `_ass_time(seconds)`.
- Karaoke word-highlight uses `{\k<cs>}word ` tags with cumulative timing.
- Animations use `\fad()`, `\move()`, `\t()` override tags.

---

## Output directories

All output is written under `.outputs/` (created automatically on first run):

```
.outputs/
├── audio/          # TTS WAV files
├── subtitle/       # SRT files
├── templates/      # Video style templates (JSON)
├── saved_projects/ # .project archives saved by user
├── video/src/      # Uploaded source videos
├── video/          # Processed videos with burned subtitles
└── imgvid/
    ├── images/     # Images for Image Video Editor
    ├── clips/      # Video clips
    ├── audio/      # Audio tracks
    ├── thumbs/     # Thumbnails
    ├── projects/   # Project JSON files
    ├── templates/  # Template JSON files
    └── output/     # Exported videos / audio files
```

---

## Logging

```python
from core.log import app_log

app_log("Processing started", level="INFO", source="my_feature")
```

Logs are written to `.logs/YYYY-MM-DD.log` and to stdout simultaneously. The Логи tab reads them via `/api/logs`.
