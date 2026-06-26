import os
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import voice_manager as vm
from services.tts_windows import synthesize as win_synthesize
from services import tts_xtts
from services.sse import run_synth_stream

router = APIRouter(prefix="/api/synthesize", tags=["synthesis"])


class WinSynthBody(BaseModel):
    text: str
    voice: str
    rate: int = 150
    volume: int = 90


class SavedSynthBody(BaseModel):
    text: str
    voice: str
    language: str = "Русский"


@router.post("/windows")
async def synthesize_windows(body: WinSynthBody):
    if not body.text.strip():
        raise HTTPException(400, "Введите текст")
    if not body.voice:
        raise HTTPException(400, "Выберите голос")
    gen = run_synth_stream(win_synthesize, (body.text, body.voice, body.rate, body.volume))
    return StreamingResponse(gen, media_type="text/event-stream")


@router.post("/xtts")
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

    gen = run_synth_stream(_wrapped, (text, tmp.name, language))
    return StreamingResponse(gen, media_type="text/event-stream")


@router.post("/saved")
async def synthesize_saved(body: SavedSynthBody):
    if not body.text.strip():
        raise HTTPException(400, "Введите текст")
    voice_path = vm.load_voice(body.voice)
    if not voice_path:
        raise HTTPException(404, f"Голос «{body.voice}» не найден")
    gen = run_synth_stream(tts_xtts.synthesize, (body.text, voice_path, body.language))
    return StreamingResponse(gen, media_type="text/event-stream")
