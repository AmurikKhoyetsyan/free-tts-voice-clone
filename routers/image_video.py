import os, re, json, uuid, shutil, subprocess, tempfile, threading, queue, datetime, io, zipfile

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

from core.log import app_log, print_progress
from routers.imgvid.ffmpeg_utils import (
    FFMPEG, FFPROBE,
    _XFADE, _EFFECTS,
    _find, _probe_duration_clip, _extract_thumb,
    _compute_video_dur,
    _start_effect_filters, _end_effect_filters,
)
from routers.imgvid.ass_writer import _ass_time, _write_ass
import routers.imgvid.project_ops as _proj_ops

router = APIRouter(prefix="/api/imgvid", tags=["imgvid"])

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMGVID_DIR   = os.path.join(BASE_DIR, ".outputs", "imgvid")
IMAGES_DIR   = os.path.join(IMGVID_DIR, "images")
AUDIO_DIR    = os.path.join(IMGVID_DIR, "audio")
CLIPS_DIR    = os.path.join(IMGVID_DIR, "clips")
THUMBS_DIR   = os.path.join(IMGVID_DIR, "thumbs")
PROJECTS_DIR = os.path.join(IMGVID_DIR, "projects")
OUTPUT_DIR          = os.path.join(IMGVID_DIR, "output")
SAVED_PROJECTS_DIR  = os.path.join(BASE_DIR, ".outputs", "saved_projects")

for _d in [IMAGES_DIR, AUDIO_DIR, CLIPS_DIR, THUMBS_DIR, PROJECTS_DIR, OUTPUT_DIR, SAVED_PROJECTS_DIR]:
    os.makedirs(_d, exist_ok=True)

_proj_ops.IMAGES_DIR   = IMAGES_DIR
_proj_ops.CLIPS_DIR    = CLIPS_DIR
_proj_ops.AUDIO_DIR    = AUDIO_DIR
_proj_ops.THUMBS_DIR   = THUMBS_DIR
_proj_ops.PROJECTS_DIR = PROJECTS_DIR

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ALLOWED_AUDIO = {".mp3", ".wav", ".aac", ".flac", ".ogg"}
ALLOWED_VIDEO = {".mp4", ".mov", ".mkv", ".webm", ".avi"}


# ── Images ────────────────────────────────────────────────────────────────────

@router.post("/images")
async def upload_image(file: UploadFile = File(...)):
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
    path = os.path.join(IMAGES_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


@router.delete("/images/{name}")
async def delete_image(name: str):
    path = os.path.join(IMAGES_DIR, name)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

# ── Video clips ──────────────────────────────────────────────────────────────

@router.post("/clips")
async def upload_clip(file: UploadFile = File(...)):
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
    has_thumb  = _extract_thumb(clip_path, thumb_path)
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
    path = os.path.join(CLIPS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


@router.get("/thumbs/{name}")
async def get_thumb(name: str):
    path = os.path.join(THUMBS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


# ── Audio ─────────────────────────────────────────────────────────────────────

@router.post("/audio")
async def upload_audio(file: UploadFile = File(...)):
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
    path = os.path.join(AUDIO_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)

# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects():
    items = []
    for fn in sorted(os.listdir(PROJECTS_DIR), reverse=True):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(PROJECTS_DIR, fn), encoding="utf-8") as f:
                d = json.load(f)
            if d.get("is_template"):
                continue
            items.append({
                "id":             d.get("id", fn[:-5]),
                "name":           d.get("name", "Без названия"),
                "created_at":     d.get("created_at", ""),
                "updated_at":     d.get("updated_at", ""),
                "slide_count":    len(d.get("slides", [])),
                "total_duration": round(sum(s.get("duration", 3) for s in d.get("slides", [])), 1),
                "is_template":    False,
            })
        except Exception:
            pass
    return {"projects": items}


class ProjectBody(BaseModel):
    id:              Optional[str] = None
    name:            str = "Без названия"
    slides:          list = []
    audio:           list = []
    subtitles:       list = []
    pip:             list = []
    export_settings: dict = {}
    is_template:     bool = False


@router.post("/projects")
async def save_project(body: ProjectBody):
    pid  = body.id or uuid.uuid4().hex
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    now  = datetime.datetime.now().isoformat()
    existing_created = now
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                existing_created = json.load(f).get("created_at", now)
        except Exception:
            pass
    data = {
        "id": pid, "name": body.name,
        "created_at": existing_created, "updated_at": now,
        "slides": body.slides, "audio": body.audio,
        "subtitles": body.subtitles,
        "pip": body.pip,
        "export_settings": body.export_settings,
        "is_template": body.is_template,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    app_log(f"Project saved: {body.name}", "INFO", "ImgVid")
    return {"id": pid, "status": f"Сохранено: {body.name}"}


@router.get("/projects/{pid}")
async def get_project(pid: str):
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Проект не найден")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.put("/projects/{pid}")
async def update_project(pid: str, body: ProjectBody):
    body.id = pid
    return await save_project(body)


@router.patch("/projects/{pid}")
async def rename_project(pid: str, body: dict):
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        raise HTTPException(404)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data["name"] = body.get("name", data["name"])
    data["updated_at"] = datetime.datetime.now().isoformat()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    app_log(f"Project renamed: {data['name']}", "INFO", "ImgVid")
    return {"id": pid, "name": data["name"]}


@router.delete("/projects/{pid}")
async def delete_project(pid: str):
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if os.path.exists(path):
        os.remove(path)
    app_log(f"Project deleted: {pid}", "INFO", "ImgVid")
    return {"ok": True}


@router.post("/projects/{pid}/save-as-template")
async def save_project_as_template(pid: str):
    src = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(src):
        raise HTTPException(404, "Проект не найден")
    with open(src, encoding="utf-8") as f:
        data = json.load(f)
    new_id = uuid.uuid4().hex
    now = datetime.datetime.now().isoformat()
    template = {**data, "id": new_id, "is_template": True,
                "created_at": now, "updated_at": now,
                "name": data.get("name", "Шаблон") + " (шаблон)"}
    tpath = os.path.join(PROJECTS_DIR, f"{new_id}.json")
    with open(tpath, "w", encoding="utf-8") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    app_log(f"Project saved as template: {template['name']}", "INFO", "ImgVid")
    return {"id": new_id, "name": template["name"]}


@router.get("/templates")
async def list_templates():
    items = []
    for fn in sorted(os.listdir(PROJECTS_DIR), reverse=True):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(PROJECTS_DIR, fn), encoding="utf-8") as f:
                d = json.load(f)
            if not d.get("is_template"):
                continue
            items.append({
                "id":             d.get("id", fn[:-5]),
                "name":           d.get("name", "Шаблон"),
                "updated_at":     d.get("updated_at", ""),
                "slide_count":    len(d.get("slides", [])),
                "total_duration": round(sum(s.get("duration", 3) for s in d.get("slides", [])), 1),
            })
        except Exception:
            pass
    return {"templates": items}

# ── .project format (pack/unpack) ─────────────────────────────────────────────

@router.get("/projects/{pid}/pack")
async def pack_project(pid: str):
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Проект не найден")
    with open(path, encoding="utf-8") as f:
        project = json.load(f)
    buf = _proj_ops._make_project_buf(project)
    safe_name = re.sub(r'[^\w\-]', '_', project.get("name", "project"))
    app_log(f"Project packed as .project: {pid}", "INFO", "ImgVid")
    return Response(
        content=buf.read(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.project"'},
    )


@router.post("/project/unpack")
async def unpack_project(file: UploadFile = File(...)):
    content = await file.read()
    buf = io.BytesIO(content)
    try:
        with zipfile.ZipFile(buf, 'r') as zf:
            project = _proj_ops._extract_project_zip(zf)
    except zipfile.BadZipFile:
        raise HTTPException(400, "Повреждённый .project файл")
    project = _proj_ops._finalize_project(project)
    app_log(f"Project unpacked from .project: {project.get('name', project['id'])}", "INFO", "ImgVid")
    return project


class ProjectSaveBody(BaseModel):
    pid: str
    dir: str = ""
    filename: str = ""

@router.post("/project/save-to-path")
async def save_project_to_path(body: ProjectSaveBody):
    proj_path = os.path.join(PROJECTS_DIR, f"{body.pid}.json")
    if not os.path.exists(proj_path):
        app_log(f"Project not found for save-to-path: {body.pid}", "ERROR", "ImgVid")
        raise HTTPException(404, "Проект не найден")
    try:
        with open(proj_path, encoding="utf-8") as f:
            project = json.load(f)
        target_dir = body.dir if body.dir else SAVED_PROJECTS_DIR
        if not os.path.isabs(target_dir):
            target_dir = os.path.join(BASE_DIR, target_dir)
        os.makedirs(target_dir, exist_ok=True)
        fname = body.filename or (re.sub(r'[^\w\-]', '_', project.get("name", "project")) + ".project")
        if not fname.lower().endswith('.project'):
            fname += '.project'
        dest = os.path.join(target_dir, fname)
        buf = _proj_ops._make_project_buf(project)
        with open(dest, 'wb') as fh:
            fh.write(buf.read())
        app_log(f"Project saved as .project: {dest}", "INFO", "ImgVid")
        return {"ok": True, "path": dest, "filename": fname}
    except HTTPException:
        raise
    except Exception as e:
        app_log(f"Error saving .project to path: {e}", "ERROR", "ImgVid")
        raise HTTPException(500, f"Ошибка сохранения проекта: {e}")


@router.get("/project/browse")
async def browse_project(path: str = ""):
    if path and os.path.isabs(path):
        target = path
    elif path:
        target = os.path.join(BASE_DIR, path)
    else:
        target = SAVED_PROJECTS_DIR
    if not os.path.isdir(target):
        target = SAVED_PROJECTS_DIR
    files = []
    try:
        for fn in os.listdir(target):
            fp = os.path.join(target, fn)
            if os.path.isfile(fp) and fn.lower().endswith('.project'):
                files.append({
                    "name": fn, "path": fp,
                    "size": os.path.getsize(fp),
                    "mtime": os.path.getmtime(fp),
                })
    except PermissionError:
        pass
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return {
        "dir": target,
        "parent": str(os.path.dirname(target)),
        "default_dir": SAVED_PROJECTS_DIR,
        "files": files,
    }


class ProjectLoadBody(BaseModel):
    file_path: str

@router.post("/project/load-from-path")
async def load_project_from_path(body: ProjectLoadBody):
    dest = body.file_path
    if not os.path.isabs(dest):
        dest = os.path.join(BASE_DIR, dest)
    if not os.path.exists(dest):
        raise HTTPException(404, "Файл не найден")
    try:
        with open(dest, 'rb') as fh:
            content = fh.read()
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf, 'r') as zf:
            project = _proj_ops._extract_project_zip(zf)
        project = _proj_ops._finalize_project(project)
        app_log(f"Project loaded from path: {dest}", "INFO", "ImgVid")
        return project
    except zipfile.BadZipFile:
        app_log(f"Corrupted .project file: {dest}", "ERROR", "ImgVid")
        raise HTTPException(400, "Повреждённый .project файл")
    except HTTPException:
        raise
    except Exception as e:
        app_log(f"Error loading .project from path: {e}", "ERROR", "ImgVid")
        raise HTTPException(500, f"Ошибка загрузки проекта: {e}")

# ── Output ────────────────────────────────────────────────────────────────────

@router.get("/output/{name}")
async def get_output(name: str):
    path = os.path.join(OUTPUT_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)

# ── Export SSE ────────────────────────────────────────────────────────────────

@router.post("/export")
async def export_video(
    project_json:  str = Form(...),
    output_format: str = Form("mp4"),
    resolution:    str = Form("1920x1080"),
    fps:           int = Form(30),
    quality:       str = Form("medium"),
    codec:         str = Form(""),   # "" means auto; or "h264","h265","vp9","vp8","av1","prores","mpeg4"
    audio_only:    bool = Form(False),
):
    try:
        project = json.loads(project_json)
    except Exception:
        raise HTTPException(400, "Неверный JSON проекта")

    slides = project.get("slides", [])
    pip_layers_raw = project.get("pip", project.get("pipLayers", []))

    # ── Pre-export validation ────────────────────────────────────────────────
    if not slides:
        app_log("Export aborted: no slides", "WARN", "ImgVid")
        raise HTTPException(400, "Нет клипов для экспорта")
    if not output_format or output_format not in ("mp4", "mov", "mkv", "webm", "avi", "gif", "m4v", "flv", "wmv", "mpeg", "ogv"):
        app_log(f"Export aborted: invalid format '{output_format}'", "WARN", "ImgVid")
        raise HTTPException(400, f"Неверный формат: {output_format}")
    try:
        _w, _h = map(int, resolution.split("x"))
        if _w < 1 or _h < 1 or _w > 7680 or _h > 7680:
            raise ValueError
    except Exception:
        app_log(f"Export aborted: invalid resolution '{resolution}'", "WARN", "ImgVid")
        raise HTTPException(400, f"Неверное разрешение: {resolution}")
    if fps not in (24, 25, 30, 60):
        fps = 30
    missing = []
    for slide in slides:
        clip_type = slide.get("type", "image")
        fname = slide.get("file", slide.get("image", ""))
        if clip_type == "video":
            fp = os.path.join(CLIPS_DIR, fname)
        else:
            fp = os.path.join(IMAGES_DIR, fname)
        if not os.path.exists(fp):
            missing.append(fname)
    if missing:
        msg = f"Файлы не найдены: {', '.join(missing[:5])}"
        app_log(f"Export aborted: {msg}", "ERROR", "ImgVid")
        raise HTTPException(400, msg)

    try:
        width, height = map(int, resolution.split("x"))
    except Exception:
        width, height = 1920, 1080

    crf = {"low": 28, "medium": 22, "high": 18, "lossless": 0}.get(quality, 22)



    q: queue.Queue = queue.Queue()
    _NO_WIN = 0x08000000 if os.name == "nt" else 0

    def worker():
        try:
            with tempfile.TemporaryDirectory() as tmp:
                q.put(("progress", 0.03, "Подготовка…"))

                # ── Resolve PIP layers ───────────────────────────────────────
                valid_pip = []
                for pip in pip_layers_raw:
                    pip_type = pip.get("type", "image")
                    fname = pip.get("file", "")
                    if pip_type == "video":
                        fp = os.path.join(CLIPS_DIR, fname)
                    else:
                        fp = os.path.join(IMAGES_DIR, fname)
                    if os.path.exists(fp):
                        valid_pip.append({**pip, "_path": fp})

                # ── Inputs ───────────────────────────────────────────────────
                cmd_inputs = []
                for i, slide in enumerate(slides):
                    clip_type = slide.get("type", "image")
                    dur = float(slide.get("duration", 3))
                    if clip_type == "video":
                        vp = os.path.join(CLIPS_DIR, slide.get("file", ""))
                        if not os.path.exists(vp):
                            q.put(("error", f"Видеофайл не найден: {slide.get('file')}")); return
                        speed = float(slide.get("speed", 1) or 1)
                        trim_in = float(slide.get("trimIn", 0) or 0)
                        # Load a bit extra for trim, actual trim done in filter
                        load_dur = (dur / max(0.01, speed)) + trim_in + 0.1
                        cmd_inputs += ["-t", f"{load_dur:.3f}", "-i", vp]
                    else:
                        img_path = os.path.join(IMAGES_DIR, slide.get("file", slide.get("image", "")))
                        if not os.path.exists(img_path):
                            q.put(("error", f"Файл не найден: {slide.get('file', slide.get('image'))}")); return
                        cmd_inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", img_path]

                audio_tracks = project.get("audio", [])
                audio_start_idx = len(slides)
                valid_audio = []
                for track in audio_tracks:
                    ap = os.path.join(AUDIO_DIR, track.get("file", ""))
                    if os.path.exists(ap):
                        cmd_inputs += ["-i", ap]
                        valid_audio.append(track)

                # Add PIP inputs after audio
                _total_dur_approx = _compute_video_dur(slides)
                pip_input_start = audio_start_idx + len(valid_audio)
                for pip in valid_pip:
                    pip_type = pip.get("type", "image")
                    pip_path = pip["_path"]
                    if pip_type == "video":
                        cmd_inputs += ["-i", pip_path]
                    else:
                        # Loop image for entire duration
                        cmd_inputs += ["-loop", "1", "-t", f"{_total_dur_approx:.3f}", "-i", pip_path]

                # ── Per-slide filters ────────────────────────────────────────
                q.put(("progress", 0.07, "Применение эффектов…"))
                scale_f = (
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
                    f"setsar=1,fps={fps},format=yuv420p"
                )
                filter_parts = []
                for i, slide in enumerate(slides):
                    clip_type = slide.get("type", "image")
                    speed = float(slide.get("speed", 1) or 1)
                    trim_in = float(slide.get("trimIn", 0) or 0)
                    dur = float(slide.get("duration", 3))

                    pre_parts = []
                    cur_scale_f = scale_f

                    if clip_type == "video":
                        if trim_in > 0:
                            pre_parts.append(f"trim=start={trim_in:.3f}:duration={dur / max(0.01, speed):.3f},setpts=PTS-STARTPTS")
                        if speed != 1.0:
                            pre_parts.append(f"setpts={1.0/speed:.6f}*PTS")
                    else:
                        # Image: apply crop, custom scale, and offset before standard resize
                        crop = slide.get("crop") or {}
                        img_scale_pct = float(slide.get("imgScale", 100) or 100)
                        img_ox = float(slide.get("imgOffsetX", 0) or 0)
                        img_oy = float(slide.get("imgOffsetY", 0) or 0)

                        cx = float(crop.get("x", 0)) / 100
                        cy = float(crop.get("y", 0)) / 100
                        cw = max(0.01, float(crop.get("w", 100))) / 100
                        ch = max(0.01, float(crop.get("h", 100))) / 100
                        if cx > 0 or cy > 0 or cw < 1.0 or ch < 1.0:
                            pre_parts.append(f"crop=iw*{cw:.4f}:ih*{ch:.4f}:iw*{cx:.4f}:ih*{cy:.4f}")

                        if img_scale_pct != 100:
                            s = max(0.1, img_scale_pct / 100)
                            pre_parts.append(f"scale=iw*{s:.4f}:ih*{s:.4f}")

                        if img_ox != 0 or img_oy != 0:
                            ox_px = int(width * img_ox / 100)
                            oy_px = int(height * img_oy / 100)
                            cur_scale_f = (
                                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                                f"pad={width}:{height}:(ow-iw)/2+{ox_px}:(oh-ih)/2+{oy_px}:black,"
                                f"setsar=1,fps={fps},format=yuv420p"
                            )

                    parts = pre_parts + [cur_scale_f]

                    for ef in slide.get("effects", []):
                        et, ev = ef.get("type"), ef.get("value", 0)
                        if et in _EFFECTS and float(ev) != 0:
                            parts.append(_EFFECTS[et](ev))

                    start_eff = slide.get("startEffect") or {}
                    end_eff   = slide.get("endEffect")   or {}
                    se_type   = (start_eff.get("type") or "none").strip()
                    ee_type   = (end_eff.get("type")   or "none").strip()
                    se_dur    = min(float(start_eff.get("duration") or 1.0), dur)
                    ee_dur    = min(float(end_eff.get("duration")   or 1.0), dur)
                    parts.extend(_start_effect_filters(se_type, se_dur, dur, width, height))
                    parts.extend(_end_effect_filters(ee_type, ee_dur, dur, width, height))

                    filter_parts.append(f"[{i}:v]{','.join(parts)}[v{i}]")

                # ── Subtitles ────────────────────────────────────────────────
                q.put(("progress", 0.10, "Подготовка субтитров…"))
                all_subs = []

                # Support independent subtitle track (top-level "subtitles" array)
                top_subs  = project.get("subtitles", [])
                # After extending the last slide, video_dur equals the preview timeline
                # duration so subtitles clamped here match exactly what the user set.
                video_dur = _compute_video_dur(slides)
                if top_subs:
                    for sub in top_subs:
                        a_start = float(sub.get("start", 0))
                        a_end   = min(float(sub.get("end", 3)), video_dur)
                        if a_start >= a_end:
                            continue
                        all_subs.append({**sub, "abs_start": a_start, "abs_end": a_end})
                else:
                    # Legacy: per-clip subtitles
                    t_cur = 0.0
                    for slide in slides:
                        dur = float(slide.get("duration", 3))
                        for sub in slide.get("subtitles", []):
                            a_start = t_cur + float(sub.get("start", 0))
                            a_end   = min(t_cur + float(sub.get("end", dur)), video_dur)
                            if a_start < a_end:
                                all_subs.append({**sub, "abs_start": a_start, "abs_end": a_end})
                        t_cur += dur

                sub_filter = ""
                if all_subs:
                    ass_path = os.path.join(tmp, "subs.ass")
                    _write_ass(all_subs, ass_path, width, height)
                    if os.name == "nt":
                        esc  = ass_path.replace("\\", "/").replace(":", "\\:")
                        wdir = os.environ.get("WINDIR", "C:\\Windows")
                        esc_fonts = (wdir + "\\Fonts").replace("\\", "/").replace(":", "\\:")
                        sub_filter = f"subtitles='{esc}':fontsdir='{esc_fonts}'"
                    else:
                        sub_filter = f"subtitles='{ass_path}'"

                # ── Transitions ──────────────────────────────────────────────
                # Additive model: each clip keeps its full duration.
                # The outgoing stream is padded (tpad clone) so xfade has frames
                # during the transition window that starts after the clip ends.
                q.put(("progress", 0.12, "Сборка переходов…"))
                if len(slides) == 1:
                    last = "v0"
                else:
                    prev = "v0"
                    offset = 0.0
                    for i in range(1, len(slides)):
                        trans = slides[i].get("transition", {})
                        xname = _XFADE.get(trans.get("type", "none"))
                        tdur  = float(trans.get("duration", 0.5)) if xname else 0.0
                        # Additive: offset = cumulative sum of full clip durations (no subtraction)
                        offset += float(slides[i-1].get("duration", 3))
                        out    = f"xf{i}"
                        if xname:
                            # Pad outgoing stream so it has frozen frames during the transition window
                            padded = f"{prev}_p{i}"
                            filter_parts.append(
                                f"[{prev}]tpad=stop_mode=clone:stop_duration={tdur:.3f}[{padded}]"
                            )
                            filter_parts.append(
                                f"[{padded}][v{i}]xfade=transition={xname}:"
                                f"duration={tdur:.3f}:offset={max(0, offset):.3f}[{out}]"
                            )
                        else:
                            raw = f"{out}r"
                            filter_parts.append(f"[{prev}][v{i}]concat=n=2:v=1:a=0[{raw}]")
                            filter_parts.append(f"[{raw}]settb=1/{fps},setpts=PTS-STARTPTS[{out}]")
                        prev = out
                    last = prev

                if sub_filter:
                    filter_parts.append(f"[{last}]{sub_filter}[vout_base]")
                else:
                    filter_parts.append(f"[{last}]null[vout_base]")

                # ── PIP overlays ─────────────────────────────────────────────
                final_video_label = "vout_base"
                for pi, pip in enumerate(valid_pip):
                    pip_type    = pip.get("type", "image")
                    px_pct      = float(pip.get("x", 5))
                    py_pct      = float(pip.get("y", 5))
                    pw_pct      = float(pip.get("w", 30))
                    ph_pct      = float(pip.get("h", 20))
                    pip_start   = float(pip.get("startTime", 0))
                    pip_end     = float(pip.get("endTime", pip_start + 5))
                    pip_opacity = float(pip.get("opacity", 1))
                    pip_speed   = float(pip.get("speed", 1) or 1)
                    pip_trimin  = float(pip.get("trimIn", 0) or 0)

                    px = int(width  * px_pct / 100)
                    py = int(height * py_pct / 100)
                    pw = max(1, int(width  * pw_pct / 100))
                    ph = max(1, int(height * ph_pct / 100))

                    inp_idx = pip_input_start + pi
                    pip_label_scaled = f"pip_s_{pi}"
                    next_label       = f"vout_pip{pi}"

                    # Build pip video filter chain
                    pip_vf_parts = []
                    if pip_type == "video":
                        if pip_trimin > 0:
                            pip_vf_parts.append(f"trim=start={pip_trimin:.3f},setpts=PTS-STARTPTS")
                        if pip_speed != 1.0:
                            pip_vf_parts.append(f"setpts={1.0/pip_speed:.6f}*PTS")
                    pip_vf_parts.append(f"scale={pw}:{ph}")
                    filter_parts.append(f"[{inp_idx}:v]{','.join(pip_vf_parts)}[{pip_label_scaled}]")

                    # Opacity
                    pip_label_in = pip_label_scaled
                    if pip_opacity < 1.0:
                        op_label = f"pip_op_{pi}"
                        filter_parts.append(
                            f"[{pip_label_in}]format=rgba,colorchannelmixer=aa={pip_opacity:.3f}[{op_label}]"
                        )
                        pip_label_in = op_label

                    # Overlay with time enable
                    enable = f"between(t\\,{pip_start:.3f}\\,{pip_end:.3f})"
                    filter_parts.append(
                        f"[{final_video_label}][{pip_label_in}]overlay={px}:{py}:enable='{enable}'[{next_label}]"
                    )
                    final_video_label = next_label

                # ── Audio ────────────────────────────────────────────────────
                audio_map = []
                video_dur_for_audio = _compute_video_dur(slides)
                total_dur = video_dur_for_audio
                if valid_audio:
                    def _build_audio_filter(t, ai_idx, out_label, clip_to_total=True):
                        vol         = float(t.get("volume", 1.0))
                        fi          = float(t.get("fadeIn",  t.get("fade_in",  0)))
                        fo          = float(t.get("fadeOut", t.get("fade_out", 0)))
                        trim_in     = float(t.get("trimIn", 0))
                        start_off   = float(t.get("startOffset", 0))
                        track_dur   = t.get("duration")
                        track_dur_f = float(track_dur) if track_dur is not None else None
                        af = []
                        # Trim file start and/or limit segment duration
                        if trim_in > 0 or track_dur_f is not None:
                            atrim_args = []
                            if trim_in > 0:
                                atrim_args.append(f"start={trim_in:.3f}")
                            if track_dur_f is not None:
                                atrim_args.append(f"end={trim_in + track_dur_f:.3f}")
                            af.append(f"atrim={':'.join(atrim_args)}")
                            af.append("asetpts=PTS-STARTPTS")
                        af.append(f"volume={vol}")
                        if fi > 0:
                            af.append(f"afade=t=in:ss=0:d={fi:.2f}")
                        if fo > 0:
                            fade_start = (track_dur_f - fo) if track_dur_f else max(0, total_dur - fo - start_off)
                            af.append(f"afade=t=out:st={max(0, fade_start):.2f}:d={fo:.2f}")
                        if start_off > 0:
                            af.append(f"adelay={int(start_off * 1000)}:all=1")
                        if clip_to_total:
                            af.append(f"atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS")
                        return f"[{ai_idx}:a]{','.join(af)}{out_label}"

                    if len(valid_audio) == 1:
                        filter_parts.append(
                            _build_audio_filter(valid_audio[0], audio_start_idx, "[aout]", clip_to_total=True)
                        )
                        audio_map = ["-map", "[aout]"]
                    else:
                        for j, t in enumerate(valid_audio):
                            filter_parts.append(
                                _build_audio_filter(t, audio_start_idx + j, f"[a{j}]", clip_to_total=False)
                            )
                        amix_in = "".join(f"[a{j}]" for j in range(len(valid_audio)))
                        filter_parts.append(
                            f"{amix_in}amix=inputs={len(valid_audio)}:duration=first,"
                            f"atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS[aout]"
                        )
                        audio_map = ["-map", "[aout]"]

                # ── Codec ────────────────────────────────────────────────────
                ext = output_format.lower()
                _codec_name = codec.lower() if codec else ""
                _codec_map = {
                    "h264": "libx264", "h265": "libx265", "hevc": "libx265",
                    "vp9": "libvpx-vp9", "vp8": "libvpx",
                    "av1": "libaom-av1", "prores": "prores_ks", "mpeg4": "mpeg4",
                }
                _resolved_codec = _codec_map.get(_codec_name, _codec_name)

                _fmt_default_codec = {
                    "mp4": "libx264", "mov": "libx264", "mkv": "libx264",
                    "m4v": "libx264", "avi": "libx264", "flv": "libx264",
                    "webm": "libvpx-vp9", "ogv": "libtheora",
                    "wmv": "wmv2", "mpeg": "mpeg2video", "gif": "gif",
                }
                vcodec_name = _resolved_codec or _fmt_default_codec.get(ext, "libx264")

                needs_gif_palette = (ext == "gif")

                if needs_gif_palette:
                    gif_fps = min(fps, 15)
                    filter_parts.append(
                        f"[{final_video_label}]fps={gif_fps},"
                        f"scale={width}:-1:flags=lanczos,split[_pg1][_pg2]"
                    )
                    filter_parts.append("[_pg1]palettegen=max_colors=256[_pal]")
                    filter_parts.append("[_pg2][_pal]paletteuse=dither=bayer:bayer_scale=5[gifout]")
                    final_video_label = "gifout"
                    vcodec = ["-c:v", "gif"]
                    acodec = []
                    audio_map = []  # GIF container does not support audio
                elif vcodec_name in ("libx264", "libx265"):
                    vcodec = ["-c:v", vcodec_name, "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []
                elif vcodec_name == "libvpx-vp9":
                    vp9_crf = max(0, min(63, crf * 63 // 51))
                    vcodec = ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(vp9_crf), "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "libopus", "-b:a", "192k"] if audio_map else []
                elif vcodec_name == "libvpx":
                    vcodec = ["-c:v", "libvpx", "-b:v", "2M", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "libvorbis", "-q:a", "5"] if audio_map else []
                elif vcodec_name == "libaom-av1":
                    av1_crf = max(0, min(63, crf))
                    vcodec = ["-c:v", "libaom-av1", "-crf", str(av1_crf), "-b:v", "0", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []
                elif vcodec_name == "prores_ks":
                    vcodec = ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"]
                    acodec = ["-c:a", "pcm_s16le"] if audio_map else []
                elif vcodec_name == "libtheora":
                    vcodec = ["-c:v", "libtheora", "-q:v", "7", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "libvorbis", "-q:a", "5"] if audio_map else []
                elif vcodec_name == "wmv2":
                    vcodec = ["-c:v", "wmv2", "-b:v", "2M", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "wmav2", "-b:a", "192k"] if audio_map else []
                elif vcodec_name == "mpeg2video":
                    vcodec = ["-c:v", "mpeg2video", "-b:v", "4M", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "mp2", "-b:a", "192k"] if audio_map else []
                elif vcodec_name == "mpeg4":
                    vcodec = ["-c:v", "mpeg4", "-b:v", "2M", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []
                else:
                    vcodec = ["-c:v", "libx264", "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []

                filter_complex = ";\n".join(filter_parts)

                ts       = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                out_name = f"imgvid_{ts}.{ext}"
                out_path = os.path.join(OUTPUT_DIR, out_name)

                cmd = (
                    [FFMPEG, "-y", "-nostdin"]
                    + cmd_inputs
                    + ["-filter_complex", filter_complex]
                    + ["-map", f"[{final_video_label}]"]
                    + audio_map
                    + vcodec + acodec
                    + [out_path]
                )

                app_log(f"Export start: {out_name} ({len(slides)} slides)", "INFO", "ImgVid")
                app_log(f"filter_complex:\n{filter_complex}", "DEBUG", "ImgVid")
                print(flush=True)
                q.put(("progress", 0.15, "Запуск FFmpeg…"))

                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL, bufsize=0,
                    creationflags=_NO_WIN,
                )

                buf = b""
                all_ffmpeg_lines = []
                while True:
                    chunk = proc.stdout.read(1024)
                    if not chunk: break
                    buf += chunk
                    parts2 = re.split(rb"\r\n|\r|\n", buf)
                    buf = parts2[-1]
                    for raw in parts2[:-1]:
                        line = raw.decode("utf-8", errors="replace").strip()
                        if not line: continue
                        all_ffmpeg_lines.append(line)
                        if "time=" in line and total_dur > 0:
                            try:
                                ts2 = line.split("time=")[1].split()[0]
                                if ":" in ts2 and not ts2.startswith("-"):
                                    hh, mm, ss2 = ts2.split(":")
                                    done = int(hh)*3600 + int(mm)*60 + float(ss2)
                                    pct  = int(min(95, 15 + done / total_dur * 80))
                                    q.put(("progress", pct / 100, line))
                                    print_progress(pct, "FFmpeg")
                            except Exception:
                                pass

                proc.wait()
                if proc.returncode != 0:
                    print(flush=True)
                    tail = "\n".join(all_ffmpeg_lines[-30:])
                    app_log(f"FFmpeg exit {proc.returncode}:\n{tail}", "ERROR", "ImgVid")
                    q.put(("error", f"FFmpeg вернул код {proc.returncode}"))
                elif not os.path.exists(out_path):
                    q.put(("error", "FFmpeg не создал файл"))
                else:
                    print_progress(100, "FFmpeg")
                    app_log(f"Export done: {out_name}", "INFO", "ImgVid")
                    q.put(("done", out_name))

        except Exception as e:
            import traceback
            app_log(f"Export error: {traceback.format_exc()}", "ERROR", "ImgVid")
            q.put(("error", str(e)))

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        yield f"event: progress\ndata: {json.dumps({'value': 0.01, 'desc': 'Инициализация…'})}\n\n"
        while True:
            item = q.get()
            ev = item[0]
            if ev == "progress":
                yield f"event: progress\ndata: {json.dumps({'value': item[1], 'desc': item[2]})}\n\n"
            elif ev == "done":
                yield f"event: done\ndata: {json.dumps({'video_url': f'/api/imgvid/output/{item[1]}', 'filename': item[1]})}\n\n"
                break
            elif ev == "error":
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + item[1]})}\n\n"
                break

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/export-audio")
async def export_audio_track(
    project_json:  str = Form(...),
    audio_format:  str = Form("mp3"),
):
    try:
        project = json.loads(project_json)
    except Exception:
        raise HTTPException(400, "Неверный JSON проекта")

    audio_tracks = project.get("audio", [])
    slides = project.get("slides", [])
    total_dur = sum(float(s.get("duration", 3)) for s in slides) if slides else 0.0

    valid_audio = []
    for track in audio_tracks:
        ap = os.path.join(AUDIO_DIR, track.get("file", ""))
        if os.path.exists(ap):
            valid_audio.append({**track, "_path": ap})

    if not valid_audio:
        raise HTTPException(400, "Аудиодорожки не найдены")

    if audio_format not in ("mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"):
        audio_format = "mp3"

    q: queue.Queue = queue.Queue()
    _NO_WIN = 0x08000000 if os.name == "nt" else 0

    def _audio_worker():
        try:
            cmd_inputs = []
            for t in valid_audio:
                cmd_inputs += ["-i", t["_path"]]

            filter_parts_a = []
            if len(valid_audio) == 1:
                t = valid_audio[0]
                vol = float(t.get("volume", 1.0))
                fi = float(t.get("fadeIn", t.get("fade_in", 0)))
                fo = float(t.get("fadeOut", t.get("fade_out", 0)))
                trim_in = float(t.get("trimIn", 0))
                start_off = float(t.get("startOffset", 0))
                af = []
                if trim_in > 0:
                    af += [f"atrim=start={trim_in:.3f}", "asetpts=PTS-STARTPTS"]
                af.append(f"volume={vol}")
                if fi > 0: af.append(f"afade=t=in:ss=0:d={fi:.2f}")
                if fo > 0: af.append(f"afade=t=out:st={max(0, total_dur - fo):.2f}:d={fo:.2f}")
                if start_off > 0: af.append(f"adelay={int(start_off * 1000)}:all=1")
                if total_dur > 0: af.append(f"atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS")
                filter_parts_a.append(f"[0:a]{','.join(af)}[aout]")
                audio_map = ["-map", "[aout]"]
            else:
                for j, t in enumerate(valid_audio):
                    vol = float(t.get("volume", 1.0))
                    fi = float(t.get("fadeIn", t.get("fade_in", 0)))
                    fo = float(t.get("fadeOut", t.get("fade_out", 0)))
                    trim_in = float(t.get("trimIn", 0))
                    start_off = float(t.get("startOffset", 0))
                    af = []
                    if trim_in > 0:
                        af += [f"atrim=start={trim_in:.3f}", "asetpts=PTS-STARTPTS"]
                    af.append(f"volume={vol}")
                    if fi > 0: af.append(f"afade=t=in:ss=0:d={fi:.2f}")
                    if fo > 0: af.append(f"afade=t=out:st={max(0, total_dur - fo):.2f}:d={fo:.2f}")
                    if start_off > 0: af.append(f"adelay={int(start_off * 1000)}:all=1")
                    filter_parts_a.append(f"[{j}:a]{','.join(af)}[a{j}]")
                amix = "".join(f"[a{j}]" for j in range(len(valid_audio)))
                tail = f",atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS" if total_dur > 0 else ""
                filter_parts_a.append(f"{amix}amix=inputs={len(valid_audio)}:duration=first{tail}[aout]")
                audio_map = ["-map", "[aout]"]

            _codec_map_a = {
                "mp3":  ["-c:a", "libmp3lame", "-b:a", "320k"],
                "wav":  ["-c:a", "pcm_s16le"],
                "flac": ["-c:a", "flac"],
                "aac":  ["-c:a", "aac", "-b:a", "256k"],
                "ogg":  ["-c:a", "libvorbis", "-q:a", "6"],
                "m4a":  ["-c:a", "aac", "-b:a", "256k"],
                "opus": ["-c:a", "libopus", "-b:a", "192k"],
            }
            acodec_args = _codec_map_a.get(audio_format, ["-c:a", "libmp3lame", "-b:a", "320k"])
            _ext_map = {"m4a": "m4a", "ogg": "ogg", "opus": "opus"}
            out_ext = _ext_map.get(audio_format, audio_format)
            ts2 = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            out_name = f"audio_{ts2}.{out_ext}"
            out_path = os.path.join(OUTPUT_DIR, out_name)

            cmd = (
                [FFMPEG, "-y", "-nostdin"]
                + cmd_inputs
                + ["-filter_complex", ";\n".join(filter_parts_a)]
                + audio_map + acodec_args
                + [out_path]
            )
            q.put(("progress", 0.3, "Экспорт аудио…"))
            app_log(f"Audio export: {out_name}", "INFO", "ImgVid")
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL, bufsize=0, creationflags=_NO_WIN,
            )
            proc.wait()
            if proc.returncode != 0:
                tail_out = proc.stdout.read().decode("utf-8", errors="replace")
                app_log(f"FFmpeg audio error:\n{tail_out}", "ERROR", "ImgVid")
                q.put(("error", f"FFmpeg код {proc.returncode}"))
            elif not os.path.exists(out_path):
                q.put(("error", "FFmpeg не создал файл"))
            else:
                app_log(f"Audio export done: {out_name}", "INFO", "ImgVid")
                q.put(("done", out_name))
        except Exception as e:
            import traceback
            app_log(f"Audio export error: {traceback.format_exc()}", "ERROR", "ImgVid")
            q.put(("error", str(e)))

    threading.Thread(target=_audio_worker, daemon=True).start()

    def _audio_stream():
        yield f"event: progress\ndata: {json.dumps({'value': 0.01, 'desc': 'Инициализация…'})}\n\n"
        while True:
            item = q.get()
            ev = item[0]
            if ev == "progress":
                yield f"event: progress\ndata: {json.dumps({'value': item[1], 'desc': item[2]})}\n\n"
            elif ev == "done":
                yield f"event: done\ndata: {json.dumps({'audio_url': f'/api/imgvid/output/{item[1]}', 'filename': item[1]})}\n\n"
                break
            elif ev == "error":
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + item[1]})}\n\n"
                break

    return StreamingResponse(_audio_stream(), media_type="text/event-stream")


@router.post("/extract-audio")
async def extract_audio_from_video(body: dict):
    file = body.get("file", "")
    if not file:
        raise HTTPException(400, "No file specified")
    vp = os.path.join(CLIPS_DIR, file)
    if not os.path.exists(vp):
        raise HTTPException(404, "Video file not found")
    _NO_WIN = 0x08000000 if os.name == "nt" else 0
    ts       = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"ext_{ts}.wav"
    out_path = os.path.join(AUDIO_DIR, out_name)
    cmd = [FFMPEG, "-y", "-nostdin", "-i", vp, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", out_path]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                stdin=subprocess.DEVNULL, creationflags=_NO_WIN)
        proc.wait(timeout=120)
    except Exception as exc:
        raise HTTPException(500, f"FFmpeg error: {exc}")
    if not os.path.exists(out_path):
        raise HTTPException(500, "FFmpeg did not create output file")
    duration = _probe_duration_clip(out_path)
    original = f"audio_from_{os.path.splitext(file)[0]}.wav"
    app_log(f"Audio extracted: {out_name} ({duration}s)", "INFO", "ImgVid")
    return {"name": out_name, "url": f"/api/imgvid/audio/{out_name}", "original": original, "duration": duration}
