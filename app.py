import sys
import asyncio

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import os
import threading
import time
import webbrowser
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from middleware.no_cache import NoCacheStaticMiddleware
from routers import voices, xtts, synthesis, history
from routers import subtitles as subtitles_router
from routers import video as video_router

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Suppress the harmless "Exception in callback _ProactorBasePipeTransport._call_connection_lost"
    # noise that occurs on Windows when the browser video player aborts range-request connections.
    # This is a known Python 3.10 / asyncio / ProactorEventLoop bug — the connection reset is
    # expected behaviour for HTTP range streaming; the error is purely cosmetic.
    if sys.platform.startswith("win"):
        loop = asyncio.get_event_loop()

        def _exception_handler(loop, context):
            exc = context.get("exception")
            msg = context.get("message", "")
            if isinstance(exc, (ConnectionResetError, OSError)) and "_ProactorBasePipeTransport" in msg:
                return  # known Windows asyncio noise — safe to ignore
            loop.default_exception_handler(context)

        loop.set_exception_handler(_exception_handler)
    yield


app = FastAPI(title="TTS", lifespan=lifespan)

app.add_middleware(NoCacheStaticMiddleware)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.include_router(voices.router)
app.include_router(xtts.router)
app.include_router(synthesis.router)
app.include_router(history.router)
app.include_router(subtitles_router.router)
app.include_router(video_router.router)


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn

    def _open_browser():
        time.sleep(1.0)
        try:
            webbrowser.open("http://127.0.0.1:7860/")
        except Exception:
            pass

    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="info")
