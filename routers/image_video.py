import os, re, json, uuid, shutil, subprocess, tempfile, threading, queue, datetime, io, zipfile

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

from core.log import app_log, print_progress

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

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ALLOWED_AUDIO = {".mp3", ".wav", ".aac", ".flac", ".ogg"}
ALLOWED_VIDEO = {".mp4", ".mov", ".mkv", ".webm", ".avi"}


def _find(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    local = os.path.join(BASE_DIR, "ffmpeg", f"{name}.exe")
    return local if os.path.exists(local) else name


FFMPEG  = _find("ffmpeg")
FFPROBE = _find("ffprobe")

_XFADE = {
    "fade":       "fade",
    "crossfade":  "fade",
    "dissolve":   "dissolve",
    "fadeblack":  "fadeblack",
    "fadewhite":  "fadewhite",
    "slideleft":  "slideleft",
    "slideright": "slideright",
    "slideup":    "slideup",
    "slidedown":  "slidedown",
    "wipeleft":   "wipeleft",
    "wiperight":  "wiperight",
    "wipeup":     "wipeup",
    "wipedown":   "wipedown",
    "circlecrop": "circlecrop",
    "pixelize":   "pixelize",
    "zoomin":     "zoomin",
    "hblur":      "hblur",
    "fadegrays":  "fadegrays",
    "radial":     "radial",
    "hlslice":    "hlslice",
    "hrslice":    "hrslice",
    "vuslice":    "vuslice",
    "vdslice":    "vdslice",
}

_EFFECTS = {
    "brightness": lambda v: f"eq=brightness={float(v)/100:.3f}",
    "contrast":   lambda v: f"eq=contrast={1+float(v)/100:.3f}",
    "saturation": lambda v: f"eq=saturation={max(0,1+float(v)/100):.3f}",
    "blur":       lambda v: f"gblur=sigma={max(0.1, float(v)):.1f}",
    "sharpen":    lambda v: f"unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount={max(0,float(v)/10):.2f}",
    "grayscale":  lambda v: "hue=s=0",
    "sepia":      lambda v: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
    "vignette":   lambda v: "vignette=PI/4",
    "filmgrain":  lambda v: f"noise=alls={max(1,int(float(v)))}:allf=t+u",
    "invert":     lambda v: "negate",
}

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

def _probe_duration_clip(path: str) -> float:
    for entries in ("format=duration", "stream=duration"):
        try:
            r = subprocess.run(
                [FFPROBE, "-v", "error", "-show_entries", entries,
                 "-of", "csv=p=0", path],
                capture_output=True, text=True, timeout=15,
            )
            val = r.stdout.strip().splitlines()[0]
            dur = float(val)
            if dur > 0:
                return round(dur, 3)
        except Exception:
            pass
    return 5.0


def _extract_thumb(video_path: str, thumb_path: str) -> bool:
    try:
        subprocess.run(
            [FFMPEG, "-y", "-ss", "0.5", "-i", video_path,
             "-frames:v", "1", "-vf", "scale=160:-1", thumb_path],
            capture_output=True, timeout=20,
        )
        return os.path.exists(thumb_path)
    except Exception:
        return False


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
            items.append({
                "id":             d.get("id", fn[:-5]),
                "name":           d.get("name", "Без названия"),
                "created_at":     d.get("created_at", ""),
                "updated_at":     d.get("updated_at", ""),
                "slide_count":    len(d.get("slides", [])),
                "total_duration": round(sum(s.get("duration", 3) for s in d.get("slides", [])), 1),
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

# ── .project format helpers ───────────────────────────────────────────────────

def _make_project_buf(project: dict) -> io.BytesIO:
    files_to_pack = []
    for slide in project.get("slides", []):
        fn = slide.get("file") or slide.get("image", "")
        if fn:
            for d in (IMAGES_DIR, CLIPS_DIR):
                fp = os.path.join(d, fn)
                if os.path.exists(fp):
                    sub = "clips" if d == CLIPS_DIR else "images"
                    files_to_pack.append((f"media/{sub}/{fn}", fp))
                    break
        thumb_url = slide.get("thumbUrl", "")
        if thumb_url:
            tname = thumb_url.split("/")[-1]
            tp = os.path.join(THUMBS_DIR, tname)
            if os.path.exists(tp):
                files_to_pack.append((f"media/thumbs/{tname}", tp))
    for track in project.get("audio", []):
        fn = track.get("file", "")
        if fn:
            fp = os.path.join(AUDIO_DIR, fn)
            if os.path.exists(fp):
                files_to_pack.append((f"media/audio/{fn}", fp))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("project.json", json.dumps(project, ensure_ascii=False, indent=2))
        for arc_name, file_path in files_to_pack:
            zf.write(file_path, arc_name)
    buf.seek(0)
    return buf


def _extract_project_zip(zf: zipfile.ZipFile) -> dict:
    names = zf.namelist()
    if "project.json" not in names:
        raise HTTPException(400, "Неверный .project: project.json не найден")
    project = json.loads(zf.read("project.json").decode("utf-8"))
    for arc_name in names:
        if arc_name == "project.json":
            continue
        fname = os.path.basename(arc_name)
        if not fname:
            continue
        data = zf.read(arc_name)
        if arc_name.startswith("media/images/"):
            file_dest = os.path.join(IMAGES_DIR, fname)
        elif arc_name.startswith("media/clips/"):
            file_dest = os.path.join(CLIPS_DIR, fname)
        elif arc_name.startswith("media/audio/"):
            file_dest = os.path.join(AUDIO_DIR, fname)
        elif arc_name.startswith("media/thumbs/"):
            file_dest = os.path.join(THUMBS_DIR, fname)
        else:
            continue
        with open(file_dest, 'wb') as fh:
            fh.write(data)
    return project


def _finalize_project(project: dict) -> dict:
    pid = project.get("id") or uuid.uuid4().hex
    project["id"] = pid
    project["updated_at"] = datetime.datetime.now().isoformat()
    ppath = os.path.join(PROJECTS_DIR, f"{pid}.json")
    with open(ppath, "w", encoding="utf-8") as fh:
        json.dump(project, fh, ensure_ascii=False, indent=2)
    return project

# ── .project format (pack/unpack) ─────────────────────────────────────────────

@router.get("/projects/{pid}/pack")
async def pack_project(pid: str):
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Проект не найден")
    with open(path, encoding="utf-8") as f:
        project = json.load(f)
    buf = _make_project_buf(project)
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
            project = _extract_project_zip(zf)
    except zipfile.BadZipFile:
        raise HTTPException(400, "Повреждённый .project файл")
    project = _finalize_project(project)
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
        buf = _make_project_buf(project)
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
            project = _extract_project_zip(zf)
        project = _finalize_project(project)
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

def _compute_video_dur(slides: list) -> float:
    """Exact video stream duration after xfade transitions shorten it."""
    total = sum(float(s.get("duration", 3)) for s in slides)
    for i in range(1, len(slides)):
        trans = slides[i].get("transition", {})
        if _XFADE.get(trans.get("type", "none")):
            total -= float(trans.get("duration", 0.5))
    return max(0.0, total)


def _ass_time(sec: float) -> str:
    sec      = max(0.0, sec)
    total_cs = int(round(sec * 100))
    cs       = total_cs % 100
    total_s  = total_cs // 100
    h        = total_s // 3600
    m        = (total_s % 3600) // 60
    s        = total_s % 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _write_ass(subs: list, path: str, width: int, height: int) -> None:
    head = "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,"
        " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle,"
        " Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        "0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    lines = [head]
    for sub in subs:
        raw_text = str(sub.get("text", "")).replace("\n", "\\N")
        abs_start = float(sub.get("abs_start", 0))
        abs_end   = float(sub.get("abs_end", 3))
        font  = sub.get("fontFamily", "Arial")
        size  = int(sub.get("fontSize", 40))
        color = sub.get("color", "#ffffff").lstrip("#")
        try:
            r, g, b = int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)
            primary = f"&H00{b:02X}{g:02X}{r:02X}"
        except Exception:
            primary = "&H00FFFFFF"
        bold      = 1 if sub.get("bold")   else 0
        italic    = 1 if sub.get("italic") else 0
        underline = 1 if sub.get("underline") else 0
        outline   = float(sub.get("outline", 2))
        shadow    = float(sub.get("shadow", 1))
        x_pct     = float(sub.get("x", 50))
        y_pct     = float(sub.get("y", 88))
        px        = int(width  * x_pct / 100)
        py        = int(height * y_pct / 100)
        # Compute per-event margins to replicate the preview width constraint.
        # Preview uses max-width:90% by default (w=0) or sub.w% when set.
        # ASS wraps text at PlayResX - MarginL - MarginR, centered at \pos(px,py).
        w_pct     = float(sub.get("w", 0))
        half_w_px = (w_pct / 200.0 * width) if w_pct > 0 else (0.45 * width)
        margin_l  = max(0, int(px - half_w_px))
        margin_r  = max(0, int(width - px - half_w_px))
        anim      = sub.get("animation", "none") or "none"
        anim_dur  = float(sub.get("animDuration", 0.6))
        anim_ms   = int(anim_dur * 1000)
        half_ms   = anim_ms // 2
        rotation  = float(sub.get("rotation", 0))

        oc = sub.get("outlineColor", "#000000").lstrip("#")
        try:    ass_oc = f"&H00{int(oc[4:6],16):02X}{int(oc[2:4],16):02X}{int(oc[0:2],16):02X}"
        except: ass_oc = "&H00000000"
        sc = sub.get("shadowColor", "#000000").lstrip("#")
        try:    ass_sc = f"&H00{int(sc[4:6],16):02X}{int(sc[2:4],16):02X}{int(sc[0:2],16):02X}"
        except: ass_sc = "&H00000000"

        base = (f"\\fn{font}\\fs{size}\\c{primary}"
                f"\\b{bold}\\i{italic}\\u{underline}"
                f"\\bord{outline:.1f}\\shad{shadow:.1f}"
                f"\\3c{ass_oc}\\4c{ass_sc}"
                f"\\an5\\pos({px},{py})")
        if rotation:
            base += f"\\frz{rotation:.1f}"

        # Background box via thick outline with matching color
        bg_op = float(sub.get("bgOpacity", 0))
        if bg_op > 0:
            bg_hex = sub.get("bgColor", "#000000").lstrip("#")
            try:
                br, bg_c, bb = int(bg_hex[0:2],16), int(bg_hex[2:4],16), int(bg_hex[4:6],16)
                aa = int((1.0 - bg_op) * 255)
                back = f"&H{aa:02X}{bb:02X}{bg_c:02X}{br:02X}"
            except Exception:
                back = "&H80000000"
            # \3c sets outline color; \bord enlarges border to create box effect
            # Preserve original outline color then override with background color
            base += f"\\3c{back}\\shad0\\bord{max(outline, 8):.1f}"

        # Karaoke word-by-word highlight
        karaoke_on = bool(sub.get("karaokeEnable", False))
        kc = sub.get("karaokeColor", "#ffdd00").lstrip("#")
        try:    ass_kc = f"&H00{int(kc[4:6],16):02X}{int(kc[2:4],16):02X}{int(kc[0:2],16):02X}"
        except: ass_kc = "&H0000DDFF"

        if karaoke_on and raw_text.strip() and abs_end > abs_start:
            # Split on spaces and \\N (ASS line break)
            words = [w for w in re.split(r'(?:\\N|\s)+', raw_text) if w]
            n = max(1, len(words))
            word_dur = (abs_end - abs_start) / n
            kmode = sub.get("karaokeMode", "word")
            # Work in integer centiseconds to avoid float rounding producing
            # zero-duration events (which causes the last word to vanish).
            abs_start_cs = int(round(abs_start * 100))
            abs_end_cs   = int(round(abs_end   * 100))
            for stage in range(n):
                t0_cs = abs_start_cs + int(round(stage * word_dur * 100))
                t1_cs = (abs_start_cs + int(round((stage + 1) * word_dur * 100))
                         if stage < n - 1 else abs_end_cs)
                # Clamp so the last word always ends at abs_end
                t1_cs = min(t1_cs, abs_end_cs)
                if t0_cs >= t1_cs:
                    t0_cs = max(abs_start_cs, t1_cs - 1)
                if t0_cs >= t1_cs:
                    continue
                t0 = t0_cs / 100.0
                t1 = t1_cs / 100.0
                # Rebuild the subtitle text preserving \\N line breaks and original
                # spacing, injecting color tags around the appropriate word(s).
                # Tokenise into alternating [word, separator, word, separator, …].
                raw_tokens = re.split(r'((?:\\N|\s)+)', raw_text)
                wi = 0
                ktext_parts = []
                for tok in raw_tokens:
                    if not tok:
                        continue
                    if re.fullmatch(r'(?:\\N|\s)+', tok):
                        ktext_parts.append(tok)
                    else:
                        if kmode == "cumulative":
                            color = ass_kc if wi <= stage else primary
                            ktext_parts.append(f"{{\\1c{color}}}{tok}")
                        else:
                            if wi == stage:
                                ktext_parts.append(
                                    f"{{\\1c{ass_kc}}}{tok}{{\\1c{primary}}}"
                                )
                            else:
                                ktext_parts.append(tok)
                        wi += 1
                ktext = "".join(ktext_parts)
                tags = "{" + base + "}"
                lines.append(f"Dialogue: 0,{_ass_time(t0)},{_ass_time(t1)},Default,,{margin_l},{margin_r},0,,{tags}{ktext}")

        elif anim == "fade-in":
            tags = "{" + base + f"\\fad({anim_ms},0)" + "}"
            lines.append(f"Dialogue: 0,{_ass_time(abs_start)},{_ass_time(abs_end)},Default,,{margin_l},{margin_r},0,,{tags}{raw_text}")

        elif anim == "fade-out":
            tags = "{" + base + f"\\fad(0,{anim_ms})" + "}"
            lines.append(f"Dialogue: 0,{_ass_time(abs_start)},{_ass_time(abs_end)},Default,,{margin_l},{margin_r},0,,{tags}{raw_text}")

        elif anim in ("slide-up", "slide-down"):
            dy   = 30 if anim == "slide-up" else -30
            tags = "{" + base.replace(f"\\pos({px},{py})", "") + f"\\fad({half_ms},{half_ms})\\move({px},{py + dy},{px},{py},0,{anim_ms})" + "}"
            lines.append(f"Dialogue: 0,{_ass_time(abs_start)},{_ass_time(abs_end)},Default,,{margin_l},{margin_r},0,,{tags}{raw_text}")

        elif anim == "zoom-in":
            tags = "{" + base + f"\\fscx5\\fscy5\\t(0,{anim_ms},\\fscx100\\fscy100)" + "}"
            lines.append(f"Dialogue: 0,{_ass_time(abs_start)},{_ass_time(abs_end)},Default,,{margin_l},{margin_r},0,,{tags}{raw_text}")

        elif anim == "typewriter":
            # Character-by-character reveal: generate one event per step
            chars = list(raw_text)
            # Count non-escape characters (skip \N newline sequences)
            visible = []
            idx = 0
            while idx < len(chars):
                if raw_text[idx:idx+2] == "\\N":
                    visible.append("\\N")
                    idx += 2
                else:
                    visible.append(raw_text[idx])
                    idx += 1
            n = max(1, len([c for c in visible if c != "\\N"]))
            char_dur = anim_dur / n
            tags_base = "{" + base + "}"
            # Emit incremental events
            shown = []
            char_count = 0
            for step, ch in enumerate(visible):
                shown.append(ch)
                if ch != "\\N":
                    char_count += 1
                t0 = abs_start + (char_count - 1) * char_dur if ch != "\\N" else abs_start
                t1 = (abs_start + char_count * char_dur) if step < len(visible) - 1 else abs_end
                partial = "".join(shown)
                lines.append(f"Dialogue: 0,{_ass_time(t0)},{_ass_time(min(t1, abs_end))},Default,,{margin_l},{margin_r},0,,"
                             f"{tags_base}{partial}")

        else:
            # No animation or unknown
            tags = "{" + base + "}"
            lines.append(f"Dialogue: 0,{_ass_time(abs_start)},{_ass_time(abs_end)},Default,,{margin_l},{margin_r},0,,{tags}{raw_text}")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


@router.post("/export")
async def export_video(
    project_json:  str = Form(...),
    output_format: str = Form("mp4"),
    resolution:    str = Form("1920x1080"),
    fps:           int = Form(30),
    quality:       str = Form("medium"),
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
    if not output_format or output_format not in ("mp4", "mov", "mkv", "webm"):
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
                _total_dur_approx = sum(float(s.get("duration", 3)) for s in slides)
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
                    parts = [scale_f]
                    clip_type = slide.get("type", "image")
                    speed = float(slide.get("speed", 1) or 1)
                    trim_in = float(slide.get("trimIn", 0) or 0)
                    dur = float(slide.get("duration", 3))

                    # For video clips: apply trim and speed
                    if clip_type == "video":
                        trim_parts = []
                        if trim_in > 0:
                            trim_parts.append(f"trim=start={trim_in:.3f}:duration={dur / max(0.01, speed):.3f},setpts=PTS-STARTPTS")
                        if speed != 1.0:
                            trim_parts.append(f"setpts={1.0/speed:.6f}*PTS")
                        if trim_parts:
                            parts = trim_parts + [scale_f]
                        # else parts stays as [scale_f]

                    for ef in slide.get("effects", []):
                        et, ev = ef.get("type"), ef.get("value", 0)
                        if et in _EFFECTS and float(ev) != 0:
                            parts.append(_EFFECTS[et](ev))
                    filter_parts.append(f"[{i}:v]{','.join(parts)}[v{i}]")

                # ── Subtitles ────────────────────────────────────────────────
                q.put(("progress", 0.10, "Подготовка субтитров…"))
                all_subs = []

                # Support independent subtitle track (top-level "subtitles" array)
                top_subs  = project.get("subtitles", [])
                # Actual video duration after transitions — subtitles must not exceed it
                # or their last karaoke events fall outside the video and are never shown.
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
                        offset += float(slides[i-1].get("duration", 3)) - tdur
                        out    = f"xf{i}"
                        if xname:
                            filter_parts.append(
                                f"[{prev}][v{i}]xfade=transition={xname}:"
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
                total_dur = sum(float(s.get("duration", 3)) for s in slides)
                if valid_audio:
                    if len(valid_audio) == 1:
                        t           = valid_audio[0]
                        ai          = audio_start_idx
                        vol         = float(t.get("volume", 1.0))
                        fi          = float(t.get("fadeIn", t.get("fade_in", 0)))
                        fo          = float(t.get("fadeOut", t.get("fade_out", 0)))
                        trim_in     = float(t.get("trimIn", 0))
                        start_off   = float(t.get("startOffset", 0))
                        track_dur   = t.get("duration")
                        track_dur_f = float(track_dur) if track_dur is not None else None
                        af = []
                        if trim_in > 0:
                            af.append(f"atrim=start={trim_in:.3f}")
                            af.append("asetpts=PTS-STARTPTS")
                        af.append(f"volume={vol}")
                        if fi > 0: af.append(f"afade=t=in:ss=0:d={fi:.2f}")
                        if fo > 0:
                            fade_start = (track_dur_f - fo) if track_dur_f else max(0, total_dur - fo - start_off)
                            af.append(f"afade=t=out:st={max(0, fade_start):.2f}:d={fo:.2f}")
                        if start_off > 0:
                            delay_ms = int(start_off * 1000)
                            af.append(f"adelay={delay_ms}:all=1")
                        af.append(f"atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS")
                        filter_parts.append(f"[{ai}:a]{','.join(af)}[aout]")
                        audio_map = ["-map", "[aout]"]
                    else:
                        for j, t in enumerate(valid_audio):
                            ai          = audio_start_idx + j
                            vol         = float(t.get("volume", 1.0))
                            trim_in     = float(t.get("trimIn", 0))
                            start_off   = float(t.get("startOffset", 0))
                            af = []
                            if trim_in > 0:
                                af.append(f"atrim=start={trim_in:.3f}")
                                af.append("asetpts=PTS-STARTPTS")
                            af.append(f"volume={vol}")
                            if start_off > 0:
                                delay_ms = int(start_off * 1000)
                                af.append(f"adelay={delay_ms}:all=1")
                            filter_parts.append(f"[{ai}:a]{','.join(af)}[a{j}]")
                        amix_in = "".join(f"[a{j}]" for j in range(len(valid_audio)))
                        filter_parts.append(
                            f"{amix_in}amix=inputs={len(valid_audio)}:duration=first,"
                            f"atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS[aout]"
                        )
                        audio_map = ["-map", "[aout]"]

                filter_complex = ";\n".join(filter_parts)

                # ── Codec ────────────────────────────────────────────────────
                ext = output_format.lower()
                if ext in ("mp4", "mov"):
                    vcodec = ["-c:v", "libx264", "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []
                elif ext == "mkv":
                    vcodec = ["-c:v", "libx264", "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []
                elif ext == "webm":
                    vcodec = ["-c:v", "libvpx-vp9", "-crf", str(crf), "-b:v", "0"]
                    acodec = ["-c:a", "libopus"] if audio_map else []
                else:
                    vcodec = ["-c:v", "libx264", "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []

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
