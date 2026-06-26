import asyncio
import json
import os
import threading
import traceback
from queue import Queue, Empty


def sse_frame(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def run_synth_stream(core_fn, args):
    """
    Runs *core_fn(*args, progress=cb)* in a worker thread and returns an
    async generator that yields SSE-formatted strings.

    Progress events:   event: progress  data: {"value": 0..1, "desc": "..."}
    Success event:     event: done      data: {"audio_url": "...", "filename": "...", "status": "..."}
    Error event:       event: error     data: {"status": "..."}
    """
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

    threading.Thread(target=_worker, daemon=True).start()

    async def _gen():
        yield sse_frame("progress", {"value": 0.0, "desc": "Запуск синтеза..."})
        while True:
            try:
                msg = q.get_nowait()
            except Empty:
                await asyncio.sleep(0.05)
                continue
            if msg[0] == "done":
                break
            _, value, desc = msg
            yield sse_frame("progress", {"value": value, "desc": desc})

        audio_path = holder["audio"]
        status = holder["status"]
        is_ok = audio_path is not None and not status.startswith("❌")
        if is_ok:
            filename = os.path.basename(audio_path)
            yield sse_frame("done", {
                "audio_url": f"/api/history/{filename}/audio",
                "filename": filename,
                "status": status,
            })
        else:
            yield sse_frame("error", {"status": status})

    return _gen()
