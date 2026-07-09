import os, re, json, shutil, subprocess, tempfile, threading, queue

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from core.schemas import RenameBody
from core.log import app_log, print_progress

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
    safe = os.path.basename(name)
    path = os.path.join(VIDEO_OUT, safe)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path, filename=safe)


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
    app_log(f"Video deleted: {name}", "INFO", "VideoService")
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
    app_log(f"Video renamed: {name} → {new_name}", "INFO", "VideoService")
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
    # Try format-level duration first (works for MP4, MKV, AVI, etc.)
    for entries in ("format=duration", "stream=duration"):
        try:
            r = subprocess.run(
                [FFPROBE, "-v", "error", "-select_streams", "v:0",
                 "-show_entries", entries, "-of", "csv=p=0", path],
                capture_output=True, text=True, timeout=10,
            )
            val = r.stdout.strip().splitlines()[0]
            dur = float(val)
            if dur > 0:
                return dur
        except Exception:
            pass
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


def _compute_default_pos(alignment: int, frame_w: int, frame_h: int,
                          margin_v: int, margin_l: int, margin_r: int) -> tuple:
    """Compute default subtitle (x, y) from ASS alignment + margins."""
    row = (alignment - 1) // 3   # 0=bottom, 1=middle, 2=top
    col = (alignment - 1) % 3    # 0=left,   1=center, 2=right
    x   = [margin_l, frame_w // 2, max(0, frame_w - margin_r)][col]
    y   = [max(0, frame_h - margin_v), frame_h // 2, margin_v][row]
    return x, y


def _build_override_block(pos_inner: str, anim: str,
                           frame_w: int, frame_h: int,
                           alignment: int, margin_v: int,
                           margin_l: int, margin_r: int,
                           dur_ms: int = 600) -> str:
    """
    Build a SINGLE ASS override block merging position + animation.
    \fad must share a block with \pos/\an or libass ignores it.
    """
    dur  = dur_ms
    half = dur_ms // 2

    # Extract existing \pos(x,y) and \an from pos_inner, if present
    m_pos = re.search(r"\\pos\((\d+),(\d+)\)", pos_inner)
    m_an  = re.search(r"\\an(\d)",              pos_inner)

    if m_pos:
        px, py = int(m_pos.group(1)), int(m_pos.group(2))
    elif frame_w > 0 and frame_h > 0:
        px, py = _compute_default_pos(alignment, frame_w, frame_h, margin_v, margin_l, margin_r)
    else:
        px, py = None, None

    an_tag = m_an.group(0) if m_an else f"\\an{alignment}"

    if not anim or anim == "none":
        return ("{" + pos_inner + "}") if pos_inner else ""

    if anim == "fade-in":
        # Merge \fad into the same block as \pos so libass applies it
        inner = (pos_inner or "") + f"\\fad({dur},{dur})"
        return "{" + inner + "}"

    if anim in ("slide-up", "slide-down") and px is not None:
        dy    = 30 if anim == "slide-up" else -30
        # \move replaces \pos; keep \an; add \fad for smooth edges
        inner = (f"{an_tag}\\fad({half},{half})"
                 f"\\move({px},{py + dy},{px},{py},0,{dur})")
        return "{" + inner + "}"

    if anim in ("slide-up", "slide-down"):
        # No position info available — fall back to fade
        inner = (pos_inner or "") + f"\\fad({half},{half})"
        return "{" + inner + "}"

    if anim == "zoom-in":
        inner = (pos_inner or "") + f"\\fscx5\\fscy5\\t(0,{dur},\\fscx100\\fscy100)"
        return "{" + inner + "}"

    if anim == "fade-out":
        inner = (pos_inner or "") + f"\\fad(0,{dur})"
        return "{" + inner + "}"

    if anim == "typewriter":
        inner = (pos_inner or "") + f"\\fad({dur},0)"
        return "{" + inner + "}"

    return ("{" + pos_inner + "}") if pos_inner else ""


def _srt_to_ass(srt_content: str, style_dict: dict,
                pos_tag: str = "", frame_w: int = 0, frame_h: int = 0,
                anim_map: dict = None) -> str:
    """Convert SRT to ASS with embedded style and optional \\pos / margins."""
    sd           = style_dict
    border_style = int(sd.get("BorderStyle", 1))
    font_size    = float(sd.get("FontSize", 24))
    sub_w_px     = int(sd.get("SubWidthPx",  0))
    sub_h_px     = int(sd.get("SubHeightPx", 0))

    # ── Padding / Outline ─────────────────────────────────────────────────────
    if border_style == 3:
        # Separate horizontal/vertical padding.
        # ASS Outline applies uniformly → use max(padX, padY) as the Outline
        # and compensate margins so the wider-padding axis gets extra margin.
        pad_x = float(sd.get("PadX", 6))
        pad_y = float(sd.get("PadY", 6))
        final_outline = max(pad_x, pad_y)
        # Extra horizontal margin when padX > padY (outline would under-pad horizontally)
        extra_h_margin = max(0, pad_x - pad_y)
        # Height override: ensure box height ≥ sub_h_px
        if sub_h_px > 0:
            text_h_1line  = font_size * 1.35
            needed_v_pad  = max(0, (sub_h_px - text_h_1line) / 2)
            if needed_v_pad > final_outline:
                extra_from_h  = needed_v_pad - final_outline  # extra beyond current
                final_outline = needed_v_pad
                extra_h_margin = max(0, extra_h_margin + extra_from_h)
    else:
        final_outline  = float(sd.get("Outline", 0))
        extra_h_margin = 0

    # ── Width → text-wrap margins ─────────────────────────────────────────────
    margin_l = margin_r = 0
    if frame_w > 0:
        if sub_w_px > 0:
            # sub_w_px = desired text-wrap width (box = sub_w_px + 2*final_outline)
            text_wrap = max(font_size * 2, float(sub_w_px))
        elif "MaxWidth" in sd:
            text_wrap = max(font_size * 2, frame_w * float(sd["MaxWidth"]) / 100)
        else:
            text_wrap = frame_w
        base_margin   = max(0, int((frame_w - text_wrap) / 2))
        margin_l = margin_r = base_margin + int(extra_h_margin)

    karaoke_on = bool(sd.get("KaraokeEnabled", False))
    if karaoke_on:
        primary_c   = _hex_to_ass(str(sd.get("KaraokeColor", "ffdd00")))
        secondary_c = str(sd.get("PrimaryColour", "&H00FFFFFF"))
    else:
        primary_c   = str(sd.get("PrimaryColour", "&H00FFFFFF"))
        secondary_c = "&HFF000000"  # transparent — not visible in non-karaoke mode

    if border_style == 3:
        # libass BorderStyle=3: OutlineColour = box fill; BackColour = shadow color
        bg_col    = str(sd.get("BackColour", "&H00000000"))
        outline_c = bg_col  # box fill = our bg color with opacity
        back_c    = bg_col  # shadow in same color as box (only matters when Shadow > 0)
    else:
        outline_c = str(sd.get("OutlineColour", "&H00000000"))
        back_c    = str(sd.get("BackColour",    "&HFF000000"))  # transparent unless shadow set

    style_line = ",".join([
        "Default",
        str(sd.get("FontName",      "Arial")),
        str(sd.get("FontSize",      "24")),
        primary_c,
        secondary_c,
        outline_c,
        back_c,
        str(sd.get("Bold",      "0")),
        str(sd.get("Italic",    "0")),
        str(sd.get("Underline", "0")),
        "0",                    # StrikeOut
        "100", "100", "0", "0", # ScaleX, ScaleY, Spacing, Angle
        str(border_style),
        str(int(round(final_outline))),
        str(sd.get("Shadow",        "0")),
        str(sd.get("Alignment",     "2")),
        str(margin_l), str(margin_r), str(sd.get("MarginV", 10)), "1",
    ])

    # Secondary text-outline style for when both box background AND text border are requested.
    # ASS BorderStyle=3 has no text stroke — we render a transparent-fill overlay (Layer 1)
    # whose only visible element is the OutlineColour stroke around each glyph.
    text_outline_size   = float(sd.get("TextOutlineSize",   0))
    text_outline_colour = str(sd.get("TextOutlineColour", "&H00000000"))
    has_text_outline    = (border_style == 3 and text_outline_size > 0)

    extra_style = ""
    if has_text_outline:
        ol_line = ",".join([
            "TextOutline",
            str(sd.get("FontName",  "Arial")),
            str(sd.get("FontSize",  "24")),
            "&HFF000000",          # PrimaryColour = transparent (fill invisible, only stroke shows)
            "&HFF000000",          # SecondaryColour = transparent
            text_outline_colour,   # OutlineColour = user's border color
            "&HFF000000",          # BackColour = transparent
            str(sd.get("Bold",      "0")),
            str(sd.get("Italic",    "0")),
            str(sd.get("Underline", "0")),
            "0",                   # StrikeOut
            "100", "100", "0", "0",
            "1",                   # BorderStyle=1 (text stroke mode)
            str(int(round(text_outline_size))),
            "0",                   # Shadow=0
            str(sd.get("Alignment", "2")),
            str(margin_l), str(margin_r), str(sd.get("MarginV", 10)), "1",
        ])
        extra_style = f"Style: {ol_line}\n"

    res_line = ""
    if frame_w > 0 and frame_h > 0:
        res_line = f"PlayResX: {frame_w}\nPlayResY: {frame_h}\n"

    fmt_line = (
        "Format: Name, FontName, FontSize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
    )
    header = (
        f"[Script Info]\nScriptType: v4.00+\n{res_line}Collisions: Normal\n\n"
        f"[V4+ Styles]\n{fmt_line}\n"
        f"Style: {style_line}\n{extra_style}\n"
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
            try:
                sub_idx = int(lines[0].strip())
            except ValueError:
                sub_idx = 0
            start_s, end_s = lines[1].split(" --> ")
            text = "\\N".join(l for l in lines[2:] if l.strip())
            if karaoke_on:
                dur   = s2sec(end_s) - s2sec(start_s)
                words = text.replace("\\N", " ").split()
                if words:
                    cs   = max(1, round(dur * 100 / len(words)))
                    text = " ".join(f"{{\\k{cs}}}{w}" for w in words)
            anim_entry = (anim_map or {}).get(sub_idx, "none")
            if isinstance(anim_entry, dict):
                anim    = anim_entry.get("animation", "none")
                dur_ms  = int(float(anim_entry.get("animDuration", 0.6)) * 1000)
            else:
                anim    = str(anim_entry)
                dur_ms  = 600
            pos_inner = pos_tag.strip("{}") if pos_tag else ""
            ov_block  = _build_override_block(
                pos_inner, anim, frame_w, frame_h,
                int(sd.get("Alignment", 2)),
                int(sd.get("MarginV",   10)),
                margin_l, margin_r,
                dur_ms=dur_ms,
            )
            t0 = _ass_time(s2sec(start_s))
            t1 = _ass_time(s2sec(end_s))
            events.append(
                f"Dialogue: 0,{t0},{t1},Default,,0,0,0,,{ov_block}{text}"
            )
            if has_text_outline:
                # Layer 1: transparent fill + visible stroke only (sits on top of box layer)
                events.append(
                    f"Dialogue: 1,{t0},{t1},TextOutline,,0,0,0,,{ov_block}{text}"
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
    italic:        bool  = Form(False),
    underline:     bool  = Form(False),
    position:      str   = Form("bottom"),
    bg_opacity:    int   = Form(50),
    bg_color:      str   = Form("000000"),
    bg_pad_x:      int   = Form(12),
    bg_pad_y:      int   = Form(6),
    outline_size:  float = Form(1.0),
    outline_color: str   = Form("000000"),
    shadow_size:   float = Form(0.0),
    shadow_color:  str   = Form("000000"),
    output_format: str   = Form(""),
    output_width:  int   = Form(0),
    output_height: int   = Form(0),
    resize_mode:   str   = Form("pad"),
    max_width_pct: float = Form(90.0),
    margin_v:      int   = Form(10),
    sub_width_px:  int   = Form(0),
    sub_height_px: int   = Form(0),
    pos_x_px:        str   = Form(""),
    pos_y_px:        str   = Form(""),
    preview_width:   int   = Form(0),
    karaoke_enabled: str   = Form("false"),
    karaoke_color:   str   = Form("ffdd00"),
    text_align:      str   = Form("center"),
    subs_json:       str   = Form("[]"),
):
    video_src = os.path.join(VIDEO_IN, os.path.basename(video_name))
    srt_src   = os.path.join(SRT_DIR,  os.path.basename(srt_name))
    if not os.path.exists(video_src):
        raise HTTPException(400, "Видео не найдено")
    if not os.path.exists(srt_src):
        raise HTTPException(400, "SRT файл не найден")

    try:
        _subs_list = json.loads(subs_json) if subs_json.strip() else []
        anim_map = {}
        for s in _subs_list:
            idx = int(s.get("index", 0))
            anim_dur = float(s.get("animDuration", 0.6))
            anim_map[idx] = {"animation": str(s.get("animation", "none")), "animDuration": anim_dur}
    except Exception:
        anim_map = {}

    orig_ext = os.path.splitext(video_name)[1].lstrip(".") or "mp4"
    ext      = (output_format.strip().lstrip(".") or orig_ext).lower()
    out_name = os.path.splitext(os.path.basename(video_name))[0] + "_sub." + ext
    out_path = os.path.join(VIDEO_OUT, out_name)

    _pos_row = {"bottom": 0, "middle": 1, "top": 2}.get(position, 0)
    _h_col   = {"left": 0, "center": 1, "right": 2}.get(text_align, 1)
    align    = [[1, 2, 3], [4, 5, 6], [7, 8, 9]][_pos_row][_h_col]

    # Build style dict
    style_dict: dict = {
        "FontName":       font_family,
        "FontSize":       font_size,
        "PrimaryColour":  _hex_to_ass(font_color),
        "Bold":           -1 if bold      else 0,
        "Italic":         -1 if italic    else 0,
        "Underline":      -1 if underline else 0,
        "Alignment":      align,
        "MaxWidth":       max_width_pct,
        "MarginV":        margin_v,
        "SubWidthPx":     sub_width_px,
        "SubHeightPx":    sub_height_px,
        "KaraokeEnabled": karaoke_enabled.lower() in ("true", "1", "yes"),
        "KaraokeColor":   karaoke_color.lstrip("#"),
    }

    if bg_opacity > 0:
        # BorderStyle=3 → box background; separate horizontal/vertical padding
        style_dict.update({
            "BorderStyle": 3,
            "BackColour":  _hex_to_ass(bg_color, bg_opacity),
            "PadX":        bg_pad_x,
            "PadY":        bg_pad_y,
        })
        if outline_size > 0:
            # Box + outline: stored separately; _srt_to_ass renders a second overlay event
            style_dict["TextOutlineSize"]   = outline_size
            style_dict["TextOutlineColour"] = _hex_to_ass(outline_color)
        if shadow_size > 0:
            style_dict["Shadow"] = shadow_size
    else:
        style_dict["BorderStyle"] = 1
        if outline_size > 0:
            style_dict.update({
                "Outline":       outline_size,
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

    use_pos = bool(pos_x_px.strip() and pos_y_px.strip())

    total_sec = _probe_duration(video_src)
    q: queue.Queue = queue.Queue()

    _CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

    def worker():
        try:
            with tempfile.TemporaryDirectory() as tmp:
                q.put(("progress", 0.05, "Копирование видео…"))
                in_ext  = os.path.splitext(video_name)[1]
                tmp_in  = os.path.join(tmp, "input" + in_ext)
                tmp_out = os.path.join(tmp, "output." + ext)
                shutil.copy(video_src, tmp_in)

                q.put(("progress", 0.08, "Анализ видео…"))
                fw, fh = (output_width, output_height) if (output_width > 0 and output_height > 0) \
                         else _probe_dimensions(tmp_in)

                # Scale CSS-pixel UI values → video-space pixels so sizes match the preview
                if preview_width > 0 and fw > 0:
                    px_scale = fw / preview_width
                    style_dict["FontSize"] = max(1, round(float(style_dict["FontSize"]) * px_scale))
                    for _k in ("PadX", "PadY", "Outline", "Shadow", "TextOutlineSize"):
                        if _k in style_dict:
                            style_dict[_k] = float(style_dict[_k]) * px_scale

                # Build optional position override tag
                pos_tag = ""
                if use_pos:
                    try:
                        px = int(round(float(pos_x_px)))
                        py = int(round(float(pos_y_px)))
                    except ValueError:
                        px, py = fw // 2, int(fh * 0.92)
                    # \an5 = middle-center anchor so \pos(x,y) matches CSS translate(-50%,-50%)
                    pos_tag = "{\\an5\\pos(" + str(px) + "," + str(py) + ")}"

                q.put(("progress", 0.10, "Конвертация субтитров…"))
                with open(srt_src, encoding="utf-8") as f:
                    srt_content = f.read()
                ass_text = _srt_to_ass(srt_content, style_dict, pos_tag, fw, fh, anim_map=anim_map)
                tmp_sub  = os.path.join(tmp, "sub.ass")
                with open(tmp_sub, "w", encoding="utf-8", newline='\n') as f:
                    f.write(ass_text)

                # Absolute path with Windows-safe escaping for libass
                if os.name == "nt":
                    esc_sub   = tmp_sub.replace("\\", "/").replace(":", "\\:")
                    win_dir   = os.environ.get("WINDIR", "C:\\Windows")
                    esc_fonts = (win_dir + "\\Fonts").replace("\\", "/").replace(":", "\\:")
                    sub_filter = f"subtitles='{esc_sub}':fontsdir='{esc_fonts}'"
                else:
                    esc_sub    = tmp_sub
                    sub_filter = f"subtitles='{esc_sub}'"
                vf_chain   = f"{resize_filter},{sub_filter}" if resize_filter else sub_filter

                # Format-specific codec args (video must be re-encoded when -vf is used)
                if ext == 'webm':
                    codec_args = ['-c:v', 'libvpx', '-b:v', '2M',
                                  '-c:a', 'libvorbis', '-q:a', '4']
                elif ext in ('mp4', 'm4v', 'mov'):
                    codec_args = ['-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                                  '-c:a', 'aac', '-b:a', '192k']
                elif ext == 'mkv':
                    codec_args = ['-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                                  '-c:a', 'copy']
                else:
                    codec_args = ['-c:a', 'copy']

                cmd = [FFMPEG, "-y", "-nostdin", "-i", tmp_in,
                       "-vf", vf_chain,
                       *codec_args, tmp_out]

                app_log(f"FFmpeg command: {' '.join(cmd)}", "INFO", "FFmpeg")
                print(flush=True)  # blank line so \r progress bar has a clean line
                q.put(("progress", 0.12, "Запуск FFmpeg…"))
                try:
                    proc = subprocess.Popen(
                        cmd, cwd=tmp,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        stdin=subprocess.DEVNULL,
                        bufsize=0,
                        creationflags=_CREATE_NO_WINDOW,
                    )
                    # FFmpeg writes progress with \r, not \n — read raw chunks
                    buf = b""
                    while True:
                        chunk = proc.stdout.read(1024)
                        if not chunk:
                            break
                        buf += chunk
                        parts = re.split(rb"\r\n|\r|\n", buf)
                        buf = parts[-1]           # keep incomplete tail
                        for raw in parts[:-1]:
                            line = raw.decode("utf-8", errors="replace").strip()
                            if not line:
                                continue
                            q.put(("log", line))
                            if "time=" in line and total_sec > 0:
                                try:
                                    t_str = line.split("time=")[1].split()[0]
                                    if ":" in t_str and not t_str.startswith("-"):
                                        hh, mm, ss = t_str.split(":")
                                        done = int(hh) * 3600 + int(mm) * 60 + float(ss)
                                        pct = int(min(95, done / total_sec * 100))
                                        q.put(("progress", min(0.95, done / total_sec), line))
                                        print_progress(pct, "FFmpeg")
                                except Exception:
                                    pass
                    # Flush any remaining bytes
                    if buf.strip():
                        q.put(("log", buf.decode("utf-8", errors="replace").strip()))
                    proc.wait()
                    if proc.returncode != 0:
                        print(flush=True)  # end \r line
                        app_log(f"FFmpeg error: return code {proc.returncode}", "ERROR", "FFmpeg")
                        q.put(("error", f"FFmpeg завершился с кодом {proc.returncode}"))
                    elif not os.path.exists(tmp_out):
                        print(flush=True)
                        q.put(("error", "FFmpeg не создал выходной файл"))
                    else:
                        print_progress(100, "FFmpeg")
                        shutil.move(tmp_out, out_path)
                        app_log(f"Video created: {os.path.basename(out_path)}", "INFO", "VideoService")
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
