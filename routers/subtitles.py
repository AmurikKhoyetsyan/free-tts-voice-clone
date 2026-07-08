import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from core.schemas import SaveSRTBody, RenameBody
from core.log import app_log

router = APIRouter(prefix="/api/subtitles", tags=["subtitles"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRT_DIR  = os.path.join(BASE_DIR, ".output", "subtitle")
os.makedirs(SRT_DIR, exist_ok=True)


def _safe_path(name: str) -> str:
    return os.path.join(SRT_DIR, os.path.basename(name))


@router.get("")
def list_srts():
    files = sorted(
        f for f in os.listdir(SRT_DIR)
        if f.endswith(".srt") and os.path.isfile(_safe_path(f))
    )
    return {"files": files}


@router.post("")
def save_srt(body: SaveSRTBody):
    name = body.name.strip()
    if not name.endswith(".srt"):
        name += ".srt"
    with open(_safe_path(name), "w", encoding="utf-8") as f:
        f.write(body.content)
    app_log(f"Subtitle file saved: {name}", "INFO", "Subtitles")
    return {"status": f"Сохранено: {name}", "name": name}


@router.put("/{name}")
def rename_srt(name: str, body: RenameBody):
    old_path = _safe_path(name)
    if not os.path.exists(old_path):
        raise HTTPException(404, "Файл не найден")
    new_name = body.new_name.strip()
    if not new_name.endswith(".srt"):
        new_name += ".srt"
    new_path = _safe_path(new_name)
    if os.path.exists(new_path) and old_path != new_path:
        raise HTTPException(400, f"Имя занято: {new_name}")
    os.rename(old_path, new_path)
    app_log(f"Subtitle renamed: {name} → {new_name}", "INFO", "Subtitles")
    return {"status": f"Переименовано: {name} → {new_name}", "name": new_name}


@router.get("/{name}/download")
def download_srt(name: str):
    path = _safe_path(name)
    if not os.path.exists(path):
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, media_type="text/plain", filename=name)


@router.get("/{name}/vtt")
def get_vtt(name: str):
    path = _safe_path(name)
    if not os.path.exists(path):
        raise HTTPException(404, "Файл не найден")
    with open(path, encoding="utf-8") as f:
        srt = f.read()
    vtt = "WEBVTT\n\n" + srt.replace(",", ".")
    return Response(content=vtt, media_type="text/vtt")


@router.get("/{name}")
def get_srt(name: str):
    path = _safe_path(name)
    if not os.path.exists(path):
        raise HTTPException(404, "Файл не найден")
    with open(path, encoding="utf-8") as f:
        return {"name": name, "content": f.read()}


@router.delete("/{name}")
def delete_srt(name: str):
    path = _safe_path(name)
    if not os.path.exists(path):
        raise HTTPException(404, "Файл не найден")
    os.remove(path)
    app_log(f"Subtitle deleted: {name}", "INFO", "Subtitles")
    return {"status": f"Удалено: {name}"}
