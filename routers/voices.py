import json
import os
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core import voice_manager as vm
from core.schemas import RenameBody
from services.tts_windows import WIN_VOICE_NAMES, WIN_DEFAULT

router = APIRouter(prefix="/api/voices", tags=["voices"])


class SaveVoiceBody(BaseModel):
    name: str


# ── Windows voices ────────────────────────────────────────────────────────────

@router.get("/windows")
async def list_windows_voices():
    return {"voices": WIN_VOICE_NAMES, "default": WIN_DEFAULT}


# ── Saved voices ──────────────────────────────────────────────────────────────

@router.get("/saved")
async def list_saved_voices():
    return {"voices": vm.get_saved_voices(), "urls": json.loads(vm.voices_urls_json())}


@router.get("/saved/{name}/audio")
async def get_saved_voice_audio(name: str):
    path = vm.load_voice(name)
    if not path:
        raise HTTPException(404, "Voice not found")
    return FileResponse(path, media_type="audio/wav")


@router.post("/saved")
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


@router.put("/saved/{name}")
async def rename_saved_voice(name: str, body: RenameBody):
    ok, result = vm.rename_voice(name, body.new_name)
    if not ok:
        raise HTTPException(400, result)
    return {"new_name": result, "voices": vm.get_saved_voices(), "urls": json.loads(vm.voices_urls_json())}


@router.delete("/saved/{name}")
async def delete_saved_voice(name: str):
    ok, msg = vm.delete_voice(name)
    if not ok:
        raise HTTPException(404, msg)
    return {"status": msg, "voices": vm.get_saved_voices(), "urls": json.loads(vm.voices_urls_json())}
