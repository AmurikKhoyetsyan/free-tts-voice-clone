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


# ── History ───────────────────────────────────────────────────────────────────

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hex_to_ass(hex_color: str, opacity: int = 100) -> str:
    """#RRGGBB + opacity% → ASS &HAABBGGRR (0%=transparent, 100%=opaque)."""
    c = hex_color.lstrip("#").upper().zfill(6)
    r, g, b = c[0:2], c[2:4], c[4:6]
    aa = format(max(0, min(255, int((1 - opacity / 100) * 255))), "02X")
    return f"&H{aa}{b}{g}{r}"


def _ass_time(sec: float) -> str:
    h  = int(sec // 3600)
    m  = int((sec % 3600) // 60)
    s  = int(sec % 60)
    cs = int(round((sec % 1) * 100))
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _probe_duration(path: str) -> float:
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=duration", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=10,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def _probe_dimensions(path: str) -> tuple:
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=10,
        )
        parts = r.stdout.strip().split(",")
        return int(parts[0]), int(parts[1])
    except Exception:
        return 1920, 1080


def _srt_to_ass(srt_content: str, style_dict: dict,
                pos_tag: str = "", frame_w: int = 0) -> str:
    """Convert SRT to ASS with embedded style and optional \\pos / margins."""
    sd = style_dict

    # Margins from max_width (text wrap region)
    margin_l = margin_r = 0
    if frame_w > 0 and "MaxWidth" in sd:
        side = round(frame_w * (1 - float(sd["MaxWidth"]) / 100) / 2)
        margin_l = margin_r = max(0, side)

    style_line = ",".join([
        "Default",
        str(sd.get("FontName",      "Arial")),
        str(sd.get("FontSize",      "24")),
        str(sd.get("PrimaryColour", "&H00FFFFFF")),
        "&H000000FF",
        str(sd.get("OutlineColour", "&H00000000")),
        str(sd.get("BackColour",    "&H00000000")),
        str(sd.get("Bold",          "0")),
        "0", "0", "0",          # Italic, Underline, StrikeOut
        "100", "100", "0", "0", # ScaleX, ScaleY, Spacing, Angle
        str(sd.get("BorderStyle",   "1")),
        str(sd.get("Outline",       "0")),
        str(sd.get("Shadow",        "0")),
        str(sd.get("Alignment",     "2")),
        str(margin_l), str(margin_r), "10", "1",
    ])

    header = (
        "[Script Info]\nScriptType: v4.00+\nCollisions: Normal\n\n"
        "[V4+ Styles]\n"
        "Format: Name, FontName, FontSize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: {style_line}\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    def s2sec(t: str) -> float:
        t = t.strip().replace(",", ".")
        h, m, s = t.split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)

    events = []
    for block in srt_content.strip().split("\n\n"):
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        try:
            start_s, end_s = lines[1].split(" --> ")
            text = "\\N".join(l for l in lines[2:] if l.strip())
            events.append(
                f"Dialogue: 0,{_ass_time(s2sec(start_s))},{_ass_time(s2sec(end_s))},"
                f"Default,,0,0,0,,{pos_tag}{text}"
            )
        except Exception:
            continue

    return header + "\n".join(events) + "\n"


# ── Burn subtitles ────────────────────────────────────────────────────────────

@router.post("/burn")
def burn_subtitles(
    video_name:    str   = Form(...),
    srt_name:      str   = Form(...),
    font_family:   str   = Form("Arial"),
    font_size:     int   = Form(24),
    font_color:    str   = Form("ffffff"),
    bold:          bool  = Form(False),
    position:      str   = Form("bottom"),
    bg_opacity:    int   = Form(50),
    bg_color:      str   = Form("000000"),
    bg_padding:    int   = Form(6),
    outline_size:  float = Form(1.0),
    outline_color: str   = Form("000000"),
    shadow_size:   float = Form(0.0),
    shadow_color:  str   = Form("000000"),
    output_format: str   = Form(""),
    output_width:  int   = Form(0),
    output_height: int   = Form(0),
    resize_mode:   str   = Form("pad"),
    max_width_pct: float = Form(90.0),
    pos_x_px:      str   = Form(""),
    pos_y_px:      str   = Form(""),
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

    align = {"bottom": 2, "top": 8, "middle": 5}.get(position, 2)

    # Build style dict
    style_dict: dict = {
        "FontName":     font_family,
        "FontSize":     font_size,
        "PrimaryColour": _hex_to_ass(font_color),
        "Bold":         -1 if bold else 0,
        "Alignment":    align,
        "MaxWidth":     max_width_pct,
    }

    if bg_opacity > 0:
        # BorderStyle=3 → box background; Outline=padding inside box
        style_dict.update({
            "BorderStyle": 3,
            "BackColour":  _hex_to_ass(bg_color, bg_opacity),
            "Outline":     bg_padding,
        })
        if shadow_size > 0:
            style_dict["Shadow"] = shadow_size
    else:
        style_dict["BorderStyle"] = 1
        if outline_size > 0:
            style_dict.update({
                "Outline":      outline_size,
                "OutlineColour": _hex_to_ass(outline_color),
            })
        if shadow_size > 0:
            style_dict.update({
                "Shadow":    shadow_size,
                "BackColour": _hex_to_ass(shadow_color),
            })

    # Build optional resize filter
    resize_filter = ""
    if output_width > 0 and output_height > 0:
        w, h = output_width, output_height
        if resize_mode == "crop":
            resize_filter = (
                f"scale={w}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h}"
            )
        elif resize_mode == "stretch":
            resize_filter = f"scale={w}:{h}"
        else:
            resize_filter = (
                f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black"
            )

    use_pos = pos_x_px.strip() and pos_y_px.strip()

    total_sec = _probe_duration(video_src)
    q: queue.Queue = queue.Queue()

    def worker():
        with tempfile.TemporaryDirectory() as tmp:
            in_ext  = os.path.splitext(video_name)[1]
            tmp_in  = os.path.join(tmp, "input" + in_ext)
            tmp_out = os.path.join(tmp, "output." + ext)
            shutil.copy(video_src, tmp_in)

            if use_pos:
                fw, fh = (output_width, output_height) if (output_width > 0 and output_height > 0) \
                         else _probe_dimensions(tmp_in)
                try:
                    px = int(round(float(pos_x_px)))
                    py = int(round(float(pos_y_px)))
                except ValueError:
                    px, py = fw // 2, int(fh * 0.92)

                with open(srt_src, encoding="utf-8") as f:
                    srt_content = f.read()

                pos_tag  = "{\\pos(" + str(px) + "," + str(py) + ")}"
                ass_text = _srt_to_ass(srt_content, style_dict, pos_tag, fw)
                tmp_sub  = os.path.join(tmp, "sub.ass")
                with open(tmp_sub, "w", encoding="utf-8") as f:
                    f.write(ass_text)
                sub_filter = "subtitles=sub.ass"

            else:
                shutil.copy(srt_src, os.path.join(tmp, "sub.srt"))
                # Build force_style string from style_dict (exclude MaxWidth)
                style_parts = [
                    f"{k}={v}" for k, v in style_dict.items()
                    if k not in ("MaxWidth",)
                ]
                style_str  = ",".join(style_parts)
                sub_filter = f"subtitles=sub.srt:force_style='{style_str}'"

            vf_chain = f"{resize_filter},{sub_filter}" if resize_filter else sub_filter

            cmd = [FFMPEG, "-y", "-i", tmp_in,
                   "-vf", vf_chain,
                   "-c:a", "copy", tmp_out]

            try:
                proc = subprocess.Popen(
                    cmd, cwd=tmp,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    universal_newlines=True, bufsize=1,
                )
                for line in proc.stdout:
                    line = line.rstrip()
                    if not line:
                        continue
                    # Always forward FFmpeg output lines to UI
                    q.put(("log", line))
                    if "time=" in line and total_sec > 0:
                        try:
                            t_str = line.split("time=")[1].split()[0]
                            hh, mm, ss = t_str.split(":")
                            done = int(hh) * 3600 + int(mm) * 60 + float(ss)
                            q.put(("progress", min(0.95, done / total_sec), line))
                        except Exception:
                            pass
                proc.wait()
                if proc.returncode != 0:
                    q.put(("error", f"FFmpeg завершился с кодом {proc.returncode}"))
                else:
                    shutil.move(tmp_out, out_path)
                    q.put(("done", out_name))
            except FileNotFoundError:
                q.put(("error", "FFmpeg не найден. Установите FFmpeg и добавьте в PATH."))
            except Exception as e:
                q.put(("error", str(e)))

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        yield f"event: progress\ndata: {json.dumps({'value': 0.03, 'desc': 'Подготовка…'})}\n\n"
        while True:
            item = q.get()
            ev   = item[0]
            if ev == "log":
                # Forward raw FFmpeg output as a log event for the UI console
                yield f"event: progress\ndata: {json.dumps({'value': None, 'desc': item[1]})}\n\n"
            elif ev == "progress":
                pct, desc = item[1], item[2]
                yield f"event: progress\ndata: {json.dumps({'value': pct, 'desc': desc})}\n\n"
            elif ev == "done":
                nm  = item[1]
                url = f"/api/video/output/{nm}"
                yield f"event: done\ndata: {json.dumps({'video_url': url, 'filename': nm})}\n\n"
                break
            elif ev == "error":
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + item[1]})}\n\n"
                break

    return StreamingResponse(stream(), media_type="text/event-stream")
