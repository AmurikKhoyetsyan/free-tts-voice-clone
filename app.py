import sys
# Force UTF-8 stdout/stderr so synthesis worker prints (Cyrillic) don't crash
# on Windows' legacy cp1251 console codepage.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import asyncio
import json
import os
import shutil
import tempfile
import threading
import time
import traceback
import webbrowser
from queue import Queue, Empty
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel

from core.audio import OUTPUT_DIR
from core import history_manager as hm
from core import voice_manager as vm
from services.tts_windows import synthesize as win_synthesize, WIN_VOICE_NAMES, WIN_DEFAULT
from services import tts_xtts

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="TTS")

# Force browser to always fetch fresh JS/CSS (no stale cache between server restarts)
class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/static/js/") or path.startswith("/static/css/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheStaticMiddleware)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ---------- voices ----------

@app.get("/api/voices/windows")
async def list_windows_voices():
    return {"voices": WIN_VOICE_NAMES, "default": WIN_DEFAULT}


@app.get("/api/voices/saved")
async def list_saved_voices():
    return {"voices": vm.get_saved_voices(), "urls": json.loads(vm.voices_urls_json())}


@app.get("/api/voices/saved/{name}/audio")
async def get_saved_voice_audio(name: str):
    path = vm.load_voice(name)
    if not path:
        raise HTTPException(404, "Voice not found")
    return FileResponse(path, media_type="audio/wav")


class SaveVoiceBody(BaseModel):
    name: str


@app.post("/api/voices/saved")
async def save_saved_voice(audio: UploadFile = File(...), name: str = Form(...)):
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(await audio.read())
    tmp.close()
    try:
        ok, msg = vm.save_voice(tmp.name, name)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
    if not ok:
        raise HTTPException(400, msg)
    return {"status": msg, "voices": vm.get_saved_voices(), "urls": json.loads(vm.voices_urls_json())}


class RenameBody(BaseModel):
    new_name: str


@app.put("/api/voices/saved/{name}")
async def rename_saved_voice(name: str, body: RenameBody):
    ok, result = vm.rename_voice(name, body.new_name)
    if not ok:
        raise HTTPException(400, result)
    return {"new_name": result, "voices": vm.get_saved_voices(), "urls": json.loads(vm.voices_urls_json())}


@app.delete("/api/voices/saved/{name}")
async def delete_saved_voice(name: str):
    ok, msg = vm.delete_voice(name)
    if not ok:
        raise HTTPException(404, msg)
    return {"status": msg, "voices": vm.get_saved_voices(), "urls": json.loads(vm.voices_urls_json())}


# ---------- xtts ----------

@app.get("/api/xtts/status")
async def xtts_status():
    return {"status": tts_xtts.check_status(), "languages": tts_xtts.LANGUAGES}


# ---------- synthesis (SSE) ----------

class WinSynthBody(BaseModel):
    text: str
    voice: str
    rate: int = 150
    volume: int = 90


class SavedSynthBody(BaseModel):
    text: str
    voice: str
    language: str = "Русский"


def _run_synth_stream(core_fn, args):
    """Returns an async generator yielding SSE-formatted strings."""
    q: Queue = Queue()
    holder = {"audio": None, "status": "✓ Готово"}

    def _cb(value, desc=""):
        q.put(("progress", float(value), desc or ""))

    def _worker():
        try:
            audio, status = core_fn(*args, progress=_cb)
            holder["audio"] = audio
            holder["status"] = status
        except Exception as e:
            traceback.print_exc()
            holder["status"] = f"❌ Сбой синтеза: {e}"
        finally:
            q.put(("done",))

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

    async def gen():
        # initial frame
        yield _sse("progress", {"value": 0.0, "desc": "Запуск синтеза..."})
        while True:
            try:
                msg = q.get_nowait()
            except Empty:
                await asyncio.sleep(0.05)
                continue
            if msg[0] == "done":
                break
            _, value, desc = msg
            yield _sse("progress", {"value": value, "desc": desc})
        audio_path = holder["audio"]
        status = holder["status"]
        is_ok = audio_path is not None and not status.startswith("❌")
        if is_ok:
            filename = os.path.basename(audio_path)
            yield _sse("done", {
                "audio_url": f"/api/history/{filename}/audio",
                "filename": filename,
                "status": status,
            })
        else:
            yield _sse("error", {"status": status})

    return gen()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/api/synthesize/windows")
async def synthesize_windows(body: WinSynthBody):
    if not body.text.strip():
        raise HTTPException(400, "Введите текст")
    if not body.voice:
        raise HTTPException(400, "Выберите голос")
    gen = _run_synth_stream(win_synthesize, (body.text, body.voice, body.rate, body.volume))
    return StreamingResponse(gen, media_type="text/event-stream")


@app.post("/api/synthesize/xtts")
async def synthesize_xtts(
    audio: UploadFile = File(...),
    text: str = Form(...),
    language: str = Form("Русский"),
):
    if not text.strip():
        raise HTTPException(400, "Введите текст")
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(await audio.read())
    tmp.close()

    def _wrapped(text, audio_path, lang, progress=None):
        try:
            return tts_xtts.synthesize(text, audio_path, lang, progress=progress)
        finally:
            try:
                os.unlink(audio_path)
            except OSError:
                pass

    gen = _run_synth_stream(_wrapped, (text, tmp.name, language))
    return StreamingResponse(gen, media_type="text/event-stream")


@app.post("/api/synthesize/saved")
async def synthesize_saved(body: SavedSynthBody):
    if not body.text.strip():
        raise HTTPException(400, "Введите текст")
    voice_path = vm.load_voice(body.voice)
    if not voice_path:
        raise HTTPException(404, f"Голос «{body.voice}» не найден")
    gen = _run_synth_stream(tts_xtts.synthesize, (body.text, voice_path, body.language))
    return StreamingResponse(gen, media_type="text/event-stream")


# ---------- history ----------

@app.get("/api/history")
async def list_history():
    return {"files": hm.list_files()}


@app.get("/api/history/{name}/audio")
async def get_history_audio(name: str):
    path = hm.load_audio(name)
    if not path:
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type="audio/wav", filename=name)


@app.delete("/api/history/{name}")
async def delete_history(name: str):
    status, signal = hm.delete_file(name)
    if not signal:
        raise HTTPException(404, status)
    return {"status": status}


@app.put("/api/history/{name}")
async def rename_history(name: str, body: RenameBody):
    audio_path, status, signal = hm.rename_file(name, body.new_name)
    if not signal:
        raise HTTPException(400, status)
    old, new = json.loads(signal)
    return {"status": status, "old_name": old, "new_name": new}


# ---------- entrypoint ----------

def _open_browser_later():
    time.sleep(1.0)
    try:
        webbrowser.open("http://127.0.0.1:7860/")
    except Exception:
        pass


if __name__ == "__main__":
    import uvicorn
    threading.Thread(target=_open_browser_later, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="info")
