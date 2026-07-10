import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from core import history_manager as hm
from core.log import app_log
from core.schemas import RenameBody

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("")
async def list_history():
    return {"files": hm.list_files()}


@router.get("/{name}/audio")
async def get_history_audio(name: str):
    path = hm.load_audio(name)
    if not path:
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type="audio/wav", filename=name)


@router.delete("/{name}")
async def delete_history(name: str):
    status, signal = hm.delete_file(name)
    if not signal:
        raise HTTPException(404, status)
    app_log(f"Audio file deleted: {name}", "INFO", "History")
    return {"status": status}


@router.put("/{name}")
async def rename_history(name: str, body: RenameBody):
    audio_path, status, signal = hm.rename_file(name, body.new_name)
    if not signal:
        raise HTTPException(400, status)
    old, new = json.loads(signal)
    app_log(f"Audio file renamed: {old} → {new}", "INFO", "History")
    return {"status": status, "old_name": old, "new_name": new}
