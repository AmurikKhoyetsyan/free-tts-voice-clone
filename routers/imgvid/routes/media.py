"""Media upload and retrieval routes for the image-video editor.

Handles images, video clips, audio files, and thumbnail files.
All routes share the ``/api/imgvid`` prefix that is set on the parent router.
"""

import os
import uuid

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from core.log import app_log
from routers.imgvid.ffmpeg_utils import _probe_duration_clip, _extract_thumb

router = APIRouter()

# ── Directory constants (resolved relative to this project's base) ────────────
_BASE_DIR    = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_IMGVID_DIR  = os.path.join(_BASE_DIR, ".outputs", "imgvid")
IMAGES_DIR   = os.path.join(_IMGVID_DIR, "images")
AUDIO_DIR    = os.path.join(_IMGVID_DIR, "audio")
CLIPS_DIR    = os.path.join(_IMGVID_DIR, "clips")
THUMBS_DIR   = os.path.join(_IMGVID_DIR, "thumbs")

for _d in [IMAGES_DIR, AUDIO_DIR, CLIPS_DIR, THUMBS_DIR]:
    os.makedirs(_d, exist_ok=True)

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ALLOWED_AUDIO = {".mp3", ".wav", ".aac", ".flac", ".ogg"}
ALLOWED_VIDEO = {".mp4", ".mov", ".mkv", ".webm", ".avi"}


# ── Images ────────────────────────────────────────────────────────────────────

@router.post("/images")
async def upload_image(file: UploadFile = File(...)):
    """Accept an image file upload and persist it under a UUID filename."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE:
        raise HTTPException(400, "Неподдерживаемый формат изображения")
    name = uuid.uuid4().hex + ext
    with open(os.path.join(IMAGES_DIR, name), "wb") as f:
        f.write(await file.read())
    app_log(f"Image uploaded: {name}", "INFO", "ImgVid")
    return {"name": name, "url": f"/api/imgvid/images/{name}", "original": file.filename}


@router.get("/images/{name}")
async def get_image(name: str):
    """Serve an uploaded image file by its stored UUID name."""
    path = os.path.join(IMAGES_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


@router.delete("/images/{name}")
async def delete_image(name: str):
    """Delete an uploaded image from disk."""
    path = os.path.join(IMAGES_DIR, name)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}


# ── Video clips ──────────────────────────────────────────────────────────────

@router.post("/clips")
async def upload_clip(file: UploadFile = File(...)):
    """Accept a video clip upload, probe its duration, and extract a thumbnail."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_VIDEO:
        raise HTTPException(400, "Неподдерживаемый формат видео")
    name = uuid.uuid4().hex + ext
    clip_path = os.path.join(CLIPS_DIR, name)
    with open(clip_path, "wb") as f:
        f.write(await file.read())
    duration = _probe_duration_clip(clip_path)
    thumb_name = uuid.uuid4().hex + ".jpg"
    thumb_path = os.path.join(THUMBS_DIR, thumb_name)
    has_thumb = _extract_thumb(clip_path, thumb_path)
    app_log(f"Video clip uploaded: {name} ({duration}s)", "INFO", "ImgVid")
    return {
        "name":      name,
        "url":       f"/api/imgvid/clips/{name}",
        "thumb_url": f"/api/imgvid/thumbs/{thumb_name}" if has_thumb else "",
        "original":  file.filename,
        "duration":  duration,
    }


@router.get("/clips/{name}")
async def get_clip(name: str):
    """Serve an uploaded video clip by its stored UUID name."""
    path = os.path.join(CLIPS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


@router.get("/thumbs/{name}")
async def get_thumb(name: str):
    """Serve a video thumbnail extracted at upload time."""
    path = os.path.join(THUMBS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


# ── Audio ─────────────────────────────────────────────────────────────────────

@router.post("/audio")
async def upload_audio(file: UploadFile = File(...)):
    """Accept an audio file upload and persist it under a UUID filename."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_AUDIO:
        raise HTTPException(400, "Неподдерживаемый формат аудио")
    name = uuid.uuid4().hex + ext
    with open(os.path.join(AUDIO_DIR, name), "wb") as f:
        f.write(await file.read())
    app_log(f"Audio uploaded: {name}", "INFO", "ImgVid")
    return {"name": name, "url": f"/api/imgvid/audio/{name}", "original": file.filename}


@router.get("/audio/{name}")
async def get_audio(name: str):
    """Serve an uploaded audio file by its stored UUID name."""
    path = os.path.join(AUDIO_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)
