import os, json, shutil, subprocess, tempfile, threading, queue

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from core.schemas import RenameBody

router = APIRouter(prefix="/api/video", tags=["video"])

BASE_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRT_DIR   = os.path.join(BASE_DIR, ".output", "subtitle")
VIDEO_IN  = os.path.join(BASE_DIR, ".output", "video", "src")
VIDEO_OUT = os.path.join(BASE_DIR, ".output", "video")
os.makedirs(VIDEO_IN,  exist_ok=True)
os.makedirs(VIDEO_OUT, exist_ok=True)


def _find(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    local = os.path.join(BASE_DIR, "ffmpeg", f"{name}.exe")
    return local if os.path.exists(local) else name


FFMPEG  = _find("ffmpeg")
FFPROBE = _find("ffprobe")


@router.get("/ffmpeg-status")
def ffmpeg_status():
    ok = bool(shutil.which("ffmpeg") or
              os.path.exists(os.path.join(BASE_DIR, "ffmpeg", "ffmpeg.exe")))
    return {"available": ok}


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    name = os.path.basename(file.filename or "video.mp4")
    dest = os.path.join(VIDEO_IN, name)
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"name": name, "url": f"/api/video/file/{name}"}


@router.get("/file/{name}")
def serve_input(name: str):
    path = os.path.join(VIDEO_IN, os.path.basename(name))
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


@router.get("/output/{name}")
def serve_output(name: str):
    path = os.path.join(VIDEO_OUT, os.path.basename(name))
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


# ── History endpoints ─────────────────────────────────────────────────────────

@router.get("/history")
def list_history():
    files = []
    for name in os.listdir(VIDEO_OUT):
        path = os.path.join(VIDEO_OUT, name)
        if os.path.isfile(path):
            try:
                files.append((name, os.path.getmtime(path)))
            except OSError:
                pass
    files.sort(key=lambda x: x[1], reverse=True)
    return {"files": [f[0] for f in files]}


@router.delete("/history/{name}")
def delete_history(name: str):
    path = os.path.join(VIDEO_OUT, os.path.basename(name))
    if not os.path.exists(path):
        raise HTTPException(404, "Файл не найден")
    os.remove(path)
    return {"status": f"Удалено: {name}"}


@router.put("/history/{name}")
def rename_history(name: str, body: RenameBody):
    old_path = os.path.join(VIDEO_OUT, os.path.basename(name))
    if not os.path.exists(old_path):
        raise HTTPException(404, "Файл не найден")
    new_name = body.new_name.strip()
    if not new_name:
        raise HTTPException(400, "Пустое имя")
    orig_ext = os.path.splitext(name)[1]
    if not os.path.splitext(new_name)[1]:
        new_name += orig_ext
    new_path = os.path.join(VIDEO_OUT, os.path.basename(new_name))
    if os.path.exists(new_path) and old_path != new_path:
        raise HTTPException(400, f"Имя занято: {new_name}")
    os.rename(old_path, new_path)
    return {"status": f"Переименовано: {name} → {new_name}", "name": new_name}


# ── Burn subtitles ────────────────────────────────────────────────────────────

@router.post("/burn")
def burn_subtitles(
    video_name:    str  = Form(...),
    srt_name:      str  = Form(...),
    font_size:     int  = Form(24),
    font_color:    str  = Form("ffffff"),
    position:      str  = Form("bottom"),
    outline:       bool = Form(True),
    output_format: str  = Form(""),
):
    video_src = os.path.join(VIDEO_IN, os.path.basename(video_name))
    srt_src   = os.path.join(SRT_DIR,  os.path.basename(srt_name))
    if not os.path.exists(video_src):
        raise HTTPException(400, "Видео не найдено")
    if not os.path.exists(srt_src):
        raise HTTPException(400, "SRT файл не найден")

    orig_ext = os.path.splitext(video_name)[1].lstrip(".") or "mp4"
    ext      = (output_format.strip().lstrip(".") or orig_ext).lower()
    out_name = os.path.splitext(os.path.basename(video_name))[0] + "_sub." + ext
    out_path = os.path.join(VIDEO_OUT, out_name)

    color = font_color.lstrip("#").upper().zfill(6)
    r, g, b = color[0:2], color[2:4], color[4:6]
    bgr_color = f"&H00{b}{g}{r}"

    align = {"bottom": 2, "top": 8, "middle": 5}.get(position, 2)
    style = f"FontSize={font_size},PrimaryColour={bgr_color},Alignment={align}"
    if outline:
        style += ",BorderStyle=1,Outline=1,Shadow=0"

    total_sec = _probe_duration(video_src)
    q: queue.Queue = queue.Queue()

    def worker():
        with tempfile.TemporaryDirectory() as tmp:
            in_ext  = os.path.splitext(video_name)[1]
            tmp_in  = os.path.join(tmp, "input" + in_ext)
            tmp_srt = os.path.join(tmp, "sub.srt")
            tmp_out = os.path.join(tmp, "output." + ext)
            shutil.copy(video_src, tmp_in)
            shutil.copy(srt_src,   tmp_srt)

            cmd = [FFMPEG, "-y", "-i", tmp_in,
                   "-vf", f"subtitles=sub.srt:force_style='{style}'",
                   "-c:a", "copy", tmp_out]
            try:
                proc = subprocess.Popen(
                    cmd, cwd=tmp,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    universal_newlines=True, bufsize=1,
                )
                for line in proc.stdout:
                    if "time=" in line and total_sec > 0:
                        try:
                            t_str = line.split("time=")[1].split()[0]
                            h, m, s = t_str.split(":")
                            done = int(h)*3600 + int(m)*60 + float(s)
                            q.put(("progress", min(0.95, done / total_sec),
                                   line.strip()[:80]))
                        except Exception:
                            pass
                proc.wait()
                if proc.returncode != 0:
                    q.put(("error", "FFmpeg завершился с ошибкой"))
                else:
                    shutil.move(tmp_out, out_path)
                    q.put(("done", out_name))
            except FileNotFoundError:
                q.put(("error",
                       "FFmpeg не найден. Установите FFmpeg и добавьте в PATH."))
            except Exception as e:
                q.put(("error", str(e)))

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        yield f"event: progress\ndata: {json.dumps({'value': 0.05, 'desc': 'Подготовка…'})}\n\n"
        while True:
            ev, *args = q.get()
            if ev == "progress":
                pct, desc = args
                yield f"event: progress\ndata: {json.dumps({'value': pct, 'desc': desc})}\n\n"
            elif ev == "done":
                nm  = args[0]
                url = f"/api/video/output/{nm}"
                yield f"event: done\ndata: {json.dumps({'video_url': url, 'filename': nm})}\n\n"
                break
            elif ev == "error":
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + args[0]})}\n\n"
                break

    return StreamingResponse(stream(), media_type="text/event-stream")


def _probe_duration(path: str) -> float:
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=duration",
             "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=10,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0
