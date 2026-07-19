"""Export routes for the image-video editor.

Provides three endpoints:
- ``POST /export``        — SSE-streamed video render.
- ``POST /export-audio``  — SSE-streamed audio-only export.
- ``POST /extract-audio`` — Synchronous audio extraction from a video clip.

The heavy lifting (FFmpeg subprocess, filter_complex assembly) lives here but
delegates to service modules:
  - :mod:`routers.imgvid.codec_selector`   — video/audio codec argument lists
  - :mod:`routers.imgvid.audio_processor`  — audio filter chains
  - :mod:`routers.imgvid.filter_builder`   — video filter_complex fragments
"""

import os
import re
import json
import queue
import datetime
import subprocess
import tempfile
import threading

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import StreamingResponse

from core.log import app_log, print_progress
from routers.imgvid.ffmpeg_utils import (
    FFMPEG, FFPROBE,
    _EFFECTS,
    _KEN_BURNS_TYPES,
    _compute_video_dur,
    _probe_duration_clip,
    _continuous_effect_filters,
)
from routers.imgvid.codec_selector import (
    resolve_codec_name,
    select_video_codec,
    select_audio_codec,
)
from routers.imgvid.audio_processor import (
    build_audio_chain,
    build_audio_filter,
    sfx_filter,
)
from routers.imgvid.filter_builder import (
    build_scale_filter,
    build_subtitle_filter,
    build_transition_filters_fps,
    build_pip_filters,
)

router = APIRouter()

# ── Directory constants ───────────────────────────────────────────────────────
_BASE_DIR   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_IMGVID_DIR = os.path.join(_BASE_DIR, ".outputs", "imgvid")
IMAGES_DIR  = os.path.join(_IMGVID_DIR, "images")
AUDIO_DIR   = os.path.join(_IMGVID_DIR, "audio")
CLIPS_DIR   = os.path.join(_IMGVID_DIR, "clips")
OUTPUT_DIR  = os.path.join(_IMGVID_DIR, "output")

for _d in [IMAGES_DIR, AUDIO_DIR, CLIPS_DIR, OUTPUT_DIR]:
    os.makedirs(_d, exist_ok=True)

# Windows flag: create subprocess without a console window
_NO_WIN = 0x08000000 if os.name == "nt" else 0


# ── Shared output route ───────────────────────────────────────────────────────

@router.get("/output/{name}")
async def get_output(name: str):
    """Serve an exported video or audio file from OUTPUT_DIR."""
    from fastapi.responses import FileResponse
    path = os.path.join(OUTPUT_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


# ── /export ───────────────────────────────────────────────────────────────────

@router.post("/export")
async def export_video(
    project_json:  str  = Form(...),
    output_format: str  = Form("mp4"),
    resolution:    str  = Form("1920x1080"),
    fps:           int  = Form(30),
    quality:       str  = Form("medium"),
    codec:         str  = Form(""),
    audio_only:    bool = Form(False),
    audio_codec:   str  = Form("aac"),
    audio_bitrate: str  = Form("192k"),
    audio_sr:      str  = Form("44100"),
    audio_ch:      str  = Form("2"),
):
    """Start an SSE-streamed video export job.

    Validates the project, builds the FFmpeg command using service modules for
    filter_complex construction and codec selection, then runs FFmpeg in a
    background thread and streams progress back to the client.

    Query parameters mirror the frontend export dialog.  ``codec`` may be empty
    (auto-select based on *output_format*) or one of: h264, h265, vp9, vp8,
    av1, prores, mpeg4.  ``quality`` maps to a CRF value.
    """
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
    if not output_format or output_format not in (
        "mp4", "mov", "mkv", "webm", "avi", "gif", "m4v", "flv", "wmv", "mpeg", "ogv"
    ):
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
        fp = os.path.join(CLIPS_DIR if clip_type == "video" else IMAGES_DIR, fname)
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

    crf = {
        "vlow": 35, "low": 28, "medium": 22,
        "high": 18, "vhigh": 14, "max": 8, "lossless": 0,
    }.get(quality, 22)

    q: queue.Queue = queue.Queue()

    def worker():
        """Background thread that builds and runs the FFmpeg export command."""
        try:
            with tempfile.TemporaryDirectory() as tmp:
                q.put(("progress", 0.03, "Подготовка…"))

                # ── Resolve PIP layers ───────────────────────────────────────
                valid_pip = []
                for pip in pip_layers_raw:
                    pip_type = pip.get("type", "image")
                    fname = pip.get("file", "")
                    fp = os.path.join(CLIPS_DIR if pip_type == "video" else IMAGES_DIR, fname)
                    if os.path.exists(fp):
                        valid_pip.append({**pip, "_path": fp})

                # ── Inputs ───────────────────────────────────────────────────
                cmd_inputs: list[str] = []
                for i, slide in enumerate(slides):
                    clip_type = slide.get("type", "image")
                    dur = float(slide.get("duration", 3))
                    if clip_type == "video":
                        vp = os.path.join(CLIPS_DIR, slide.get("file", ""))
                        if not os.path.exists(vp):
                            q.put(("error", f"Видеофайл не найден: {slide.get('file')}")); return
                        speed = float(slide.get("speed", 1) or 1)
                        trim_in = float(slide.get("trimIn", 0) or 0)
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
                        cmd_inputs += ["-loop", "1", "-t", f"{_total_dur_approx:.3f}", "-i", pip_path]

                # ── Per-slide filters ────────────────────────────────────────
                q.put(("progress", 0.07, "Применение эффектов…"))
                scale_f = build_scale_filter(width, height, fps)
                filter_parts: list[str] = []

                for i, slide in enumerate(slides):
                    clip_type = slide.get("type", "image")
                    speed = float(slide.get("speed", 1) or 1)
                    trim_in = float(slide.get("trimIn", 0) or 0)
                    dur = float(slide.get("duration", 3))

                    pre_parts: list[str] = []
                    cur_scale_f = scale_f

                    if clip_type == "video":
                        if trim_in > 0:
                            pre_parts.append(
                                f"trim=start={trim_in:.3f}:duration={dur / max(0.01, speed):.3f},setpts=PTS-STARTPTS"
                            )
                        if speed != 1.0:
                            pre_parts.append(f"setpts={1.0 / speed:.6f}*PTS")
                    else:
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

                    cont_eff  = slide.get("continuousEffect") or {}
                    cont_type = (cont_eff.get("type") or "none").strip()
                    cont_int  = float(cont_eff.get("intensity") or 30)

                    replaces_scale, cont_filters = _continuous_effect_filters(
                        cont_type, cont_int, dur, width, height, fps, clip_type
                    )

                    if replaces_scale and clip_type == "image":
                        parts = pre_parts + cont_filters
                    else:
                        parts = pre_parts + [cur_scale_f]

                    for ef in slide.get("effects", []):
                        et, ev = ef.get("type"), ef.get("value", 0)
                        if et in _EFFECTS and float(ev) != 0:
                            parts.append(_EFFECTS[et](ev))

                    if not replaces_scale and cont_filters:
                        parts.extend(cont_filters)

                    from routers.imgvid.ffmpeg_utils import _start_effect_filters, _end_effect_filters
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
                all_subs: list[dict] = []
                top_subs = project.get("subtitles", [])
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

                sub_filter = build_subtitle_filter(all_subs, tmp, width, height)

                # ── Transitions ──────────────────────────────────────────────
                q.put(("progress", 0.12, "Сборка переходов…"))
                filter_parts, last = build_transition_filters_fps(slides, filter_parts, fps)

                if sub_filter:
                    filter_parts.append(f"[{last}]{sub_filter}[vout_base]")
                else:
                    filter_parts.append(f"[{last}]null[vout_base]")

                # ── PIP overlays ─────────────────────────────────────────────
                pip_filters, final_video_label = build_pip_filters(
                    valid_pip, pip_input_start, "vout_base", width, height, _compute_video_dur(slides)
                )
                filter_parts.extend(pip_filters)

                # ── Audio ────────────────────────────────────────────────────
                audio_map: list[str] = []
                total_dur = _compute_video_dur(slides)
                if valid_audio:
                    audio_filter_parts, audio_map = build_audio_chain(
                        valid_audio, audio_start_idx, total_dur
                    )
                    filter_parts.extend(audio_filter_parts)

                # ── Codec ────────────────────────────────────────────────────
                ext = output_format.lower()
                vcodec_name = resolve_codec_name(codec, ext)
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
                    acodec: list[str] = []
                    audio_map = []  # GIF container does not support audio
                else:
                    vcodec = select_video_codec(vcodec_name, crf, ext)
                    # Codec-specific default audio (overrides user choice for some formats)
                    if vcodec_name == "libvpx-vp9":
                        acodec = ["-c:a", "libopus", "-b:a", "192k"] if audio_map else []
                    elif vcodec_name == "libvpx":
                        acodec = ["-c:a", "libvorbis", "-q:a", "5"] if audio_map else []
                    elif vcodec_name == "libaom-av1":
                        acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []
                    elif vcodec_name == "prores_ks":
                        acodec = ["-c:a", "pcm_s16le"] if audio_map else []
                    elif vcodec_name == "libtheora":
                        acodec = ["-c:a", "libvorbis", "-q:a", "5"] if audio_map else []
                    elif vcodec_name == "wmv2":
                        acodec = ["-c:a", "wmav2", "-b:a", "192k"] if audio_map else []
                    elif vcodec_name == "mpeg2video":
                        acodec = ["-c:a", "mp2", "-b:a", "192k"] if audio_map else []
                    elif vcodec_name == "mpeg4":
                        acodec = ["-c:a", "aac", "-b:a", "192k"] if audio_map else []
                    else:
                        acodec = select_audio_codec(audio_codec, audio_bitrate, bool(audio_map))

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
                app_log(f"FFmpeg cmd: {' '.join(cmd)}", "DEBUG", "ImgVid")
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
                all_ffmpeg_lines: list[str] = []
                while True:
                    chunk = proc.stdout.read(1024)
                    if not chunk:
                        break
                    buf += chunk
                    parts2 = re.split(rb"\r\n|\r|\n", buf)
                    buf = parts2[-1]
                    for raw in parts2[:-1]:
                        line = raw.decode("utf-8", errors="replace").strip()
                        if not line:
                            continue
                        all_ffmpeg_lines.append(line)
                        if "time=" in line and total_dur > 0:
                            try:
                                ts2 = line.split("time=")[1].split()[0]
                                if ":" in ts2 and not ts2.startswith("-"):
                                    hh, mm, ss2 = ts2.split(":")
                                    done = int(hh) * 3600 + int(mm) * 60 + float(ss2)
                                    pct = int(min(95, 15 + done / total_dur * 80))
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
                    try:
                        probe = subprocess.run(
                            [FFPROBE, "-v", "quiet", "-show_streams",
                             "-select_streams", "v:0", "-print_format", "compact", out_path],
                            capture_output=True, text=True, timeout=10,
                        )
                        if probe.returncode == 0 and probe.stdout.strip():
                            app_log(f"Video stream: {probe.stdout.strip()}", "DEBUG", "ImgVid")
                        else:
                            app_log("WARNING: ffprobe found no video stream in output!", "WARN", "ImgVid")
                    except Exception:
                        pass
                    q.put(("done", out_name))

        except Exception as e:
            import traceback
            app_log(f"Export error: {traceback.format_exc()}", "ERROR", "ImgVid")
            q.put(("error", str(e)))

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        """Generator that yields SSE frames from the worker queue until done or error."""
        yield f"event: progress\ndata: {json.dumps({'value': 0.01, 'desc': 'Инициализация…'})}\n\n"
        while True:
            item = q.get()
            ev = item[0]
            if ev == "progress":
                yield f"event: progress\ndata: {json.dumps({'value': item[1], 'desc': item[2]})}\n\n"
            elif ev == "done":
                yield (
                    f"event: done\ndata: {json.dumps({'video_url': f'/api/imgvid/output/{item[1]}', 'filename': item[1]})}\n\n"
                )
                break
            elif ev == "error":
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + item[1]})}\n\n"
                break

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── /export-audio ─────────────────────────────────────────────────────────────

@router.post("/export-audio")
async def export_audio_track(
    project_json: str = Form(...),
    audio_format: str = Form("mp3"),
):
    """Start an SSE-streamed audio-only export job.

    Mixes all audio tracks in the project according to their volume, fade,
    trim, speed, and sound-effect settings, then encodes to the requested
    audio format.
    """
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

    # When there are no slides, derive total_dur from the audio tracks themselves
    if total_dur == 0.0:
        for t in valid_audio:
            s_off = float(t.get("startOffset", 0))
            tdur  = t.get("duration")
            if tdur is not None:
                total_dur = max(total_dur, s_off + float(tdur))

    if audio_format not in ("mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"):
        audio_format = "mp3"

    q: queue.Queue = queue.Queue()

    def _build_audio_filter_a(t: dict, idx: int, out_label: str) -> str:
        """Build FFmpeg audio filter chain for one track in audio-only export.

        Similar to :func:`build_audio_filter` but does not clip to total_dur
        in-filter (the caller adds a trim after mixing if needed).
        """
        vol       = float(t.get("volume", 1.0))
        fi        = float(t.get("fadeIn",  t.get("fade_in",  0)))
        fo        = float(t.get("fadeOut", t.get("fade_out", 0)))
        trim_in   = float(t.get("trimIn", 0))
        start_off = float(t.get("startOffset", 0))
        speed     = float(t.get("speed", 1.0))
        track_dur = t.get("duration")
        track_dur_f = float(track_dur) if track_dur is not None else None
        af: list[str] = []
        atrim_args: list[str] = []
        if trim_in > 0:
            atrim_args.append(f"start={trim_in:.3f}")
        if track_dur_f is not None:
            atrim_args.append(f"end={trim_in + track_dur_f * speed:.3f}")
        if atrim_args:
            af.append(f"atrim={':'.join(atrim_args)}")
            af.append("asetpts=PTS-STARTPTS")
        # Speed adjustment (atempo supports 0.5–2.0 per pass)
        if abs(speed - 1.0) > 0.001:
            remaining = speed
            while remaining < 0.5:
                af.append("atempo=0.5"); remaining /= 0.5
            while remaining > 2.0:
                af.append("atempo=2.0"); remaining /= 2.0
            af.append(f"atempo={remaining:.6f}")
        af.append(f"volume={vol}")
        if fi > 0:
            af.append(f"afade=t=in:ss=0:d={fi:.2f}")
        if fo > 0:
            fade_start = (track_dur_f - fo) if track_dur_f else max(0, total_dur - fo - start_off)
            af.append(f"afade=t=out:st={max(0, fade_start):.2f}:d={fo:.2f}")
        if start_off > 0:
            af.append(f"adelay={round(start_off * 1000)}:all=1")
        return f"[{idx}:a]{','.join(af)}{out_label}"

    def _audio_worker():
        """Background thread that builds and runs the FFmpeg audio export command."""
        try:
            cmd_inputs: list[str] = []
            for t in valid_audio:
                cmd_inputs += ["-i", t["_path"]]

            filter_parts_a: list[str] = []
            if len(valid_audio) == 1:
                filter_parts_a.append(_build_audio_filter_a(valid_audio[0], 0, "[aout]"))
                if total_dur > 0:
                    filter_parts_a.append(
                        f"[aout]atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS[aout2]"
                    )
                    audio_map = ["-map", "[aout2]"]
                else:
                    audio_map = ["-map", "[aout]"]
            else:
                for j, t in enumerate(valid_audio):
                    filter_parts_a.append(_build_audio_filter_a(t, j, f"[a{j}]"))
                amix = "".join(f"[a{j}]" for j in range(len(valid_audio)))
                tail = f",atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS" if total_dur > 0 else ""
                filter_parts_a.append(
                    f"{amix}amix=inputs={len(valid_audio)}:duration=longest:normalize=0{tail}[aout]"
                )
                audio_map = ["-map", "[aout]"]

            _codec_map_a: dict[str, list[str]] = {
                "mp3":  ["-c:a", "libmp3lame", "-b:a", "320k"],
                "wav":  ["-c:a", "pcm_s16le"],
                "flac": ["-c:a", "flac"],
                "aac":  ["-c:a", "aac", "-b:a", "256k"],
                "ogg":  ["-c:a", "libvorbis", "-q:a", "6"],
                "m4a":  ["-c:a", "aac", "-b:a", "256k"],
                "opus": ["-c:a", "libopus", "-b:a", "192k"],
            }
            acodec_args = _codec_map_a.get(audio_format, ["-c:a", "libmp3lame", "-b:a", "320k"])
            out_ext = {"m4a": "m4a", "ogg": "ogg", "opus": "opus"}.get(audio_format, audio_format)
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
                cmd,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL, bufsize=0,
                creationflags=_NO_WIN,
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
        """Generator that yields SSE frames from the audio worker queue."""
        yield f"event: progress\ndata: {json.dumps({'value': 0.01, 'desc': 'Инициализация…'})}\n\n"
        while True:
            item = q.get()
            ev = item[0]
            if ev == "progress":
                yield f"event: progress\ndata: {json.dumps({'value': item[1], 'desc': item[2]})}\n\n"
            elif ev == "done":
                yield (
                    f"event: done\ndata: {json.dumps({'audio_url': f'/api/imgvid/output/{item[1]}', 'filename': item[1]})}\n\n"
                )
                break
            elif ev == "error":
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + item[1]})}\n\n"
                break

    return StreamingResponse(_audio_stream(), media_type="text/event-stream")


# ── /extract-audio ────────────────────────────────────────────────────────────

@router.post("/extract-audio")
async def extract_audio_from_video(body: dict):
    """Synchronously extract the audio stream from an uploaded video clip as a WAV file.

    The resulting WAV file is saved to AUDIO_DIR and a response with its URL
    is returned.  Raises HTTP 404 if the clip is not found, 500 on FFmpeg error.
    """
    file = body.get("file", "")
    if not file:
        raise HTTPException(400, "No file specified")
    vp = os.path.join(CLIPS_DIR, file)
    if not os.path.exists(vp):
        raise HTTPException(404, "Video file not found")
    ts       = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"ext_{ts}.wav"
    out_path = os.path.join(AUDIO_DIR, out_name)
    cmd = [
        FFMPEG, "-y", "-nostdin", "-i", vp,
        "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", out_path,
    ]
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=_NO_WIN,
        )
        proc.wait(timeout=120)
    except Exception as exc:
        raise HTTPException(500, f"FFmpeg error: {exc}")
    if not os.path.exists(out_path):
        raise HTTPException(500, "FFmpeg did not create output file")
    duration = _probe_duration_clip(out_path)
    original = f"audio_from_{os.path.splitext(file)[0]}.wav"
    app_log(f"Audio extracted: {out_name} ({duration}s)", "INFO", "ImgVid")
    return {
        "name":     out_name,
        "url":      f"/api/imgvid/audio/{out_name}",
        "original": original,
        "duration": duration,
    }
