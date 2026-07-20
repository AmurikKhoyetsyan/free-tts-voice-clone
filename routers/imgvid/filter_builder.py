"""Video filter_complex building helpers for the image-video export pipeline.

Each function returns a fragment (or list of fragments) that will be joined
with ``;`` and passed to FFmpeg's ``-filter_complex`` argument.
"""

import os
from typing import Optional

from .ffmpeg_utils import (
    _XFADE, _EFFECTS,
    _start_effect_filters, _end_effect_filters, _continuous_effect_filters,
    _KEN_BURNS_TYPES,
)


def build_scale_filter(width: int, height: int, fps: int) -> str:
    """Return the standard scale/pad/format filter applied to every slide.

    Forces the output to *width*x*height*, black-pads if aspect ratios differ,
    sets SAR=1, converts to yuv420p, and clamps fps.
    """
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1,fps={fps},format=yuv420p"
    )


def build_slide_filter(
    i: int,
    slide: dict,
    fps: int,
    width: int,
    height: int,
) -> str:
    """Return the full per-slide filter string ``[i:v]<chain>[vi]``.

    Handles video trims/speed, image crop/scale/offset, per-slide effects,
    and start/end motion effects.  The output label is ``[v{i}]``.
    """
    clip_type = slide.get("type", "image")
    speed = float(slide.get("speed", 1) or 1)
    trim_in = float(slide.get("trimIn", 0) or 0)
    dur = float(slide.get("duration", 3))

    base_scale_f = build_scale_filter(width, height, fps)
    cur_scale_f = base_scale_f

    pre_parts: list[str] = []

    if clip_type == "video":
        if trim_in > 0:
            pre_parts.append(
                f"trim=start={trim_in:.3f}:duration={dur / max(0.01, speed):.3f},setpts=PTS-STARTPTS"
            )
        if speed != 1.0:
            pre_parts.append(f"setpts={1.0 / speed:.6f}*PTS")
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
    end_eff = slide.get("endEffect") or {}
    se_type = (start_eff.get("type") or "none").strip()
    ee_type = (end_eff.get("type") or "none").strip()
    se_dur = min(float(start_eff.get("duration") or 1.0), dur)
    ee_dur = min(float(end_eff.get("duration") or 1.0), dur)
    parts.extend(_start_effect_filters(se_type, se_dur, dur, width, height))
    parts.extend(_end_effect_filters(ee_type, ee_dur, dur, width, height))

    return f"[{i}:v]{','.join(parts)}[v{i}]"


def build_transition_filters(
    slides: list,
    filter_parts: list,
) -> tuple[list[str], str]:
    """Append xfade/concat transition filters to *filter_parts* and return the final label.

    Uses an additive duration model: each clip keeps its full duration; the
    outgoing stream is padded with ``tpad`` (clone) so xfade has frozen frames
    during the transition window.

    Args:
        slides:       List of project slide dicts.
        filter_parts: Existing filter fragments list (mutated in-place).

    Returns:
        ``(filter_parts, last_label)`` where *last_label* is the video stream
        label after all transitions (e.g. ``"v0"`` for a single-slide project
        or ``"xf3"`` for a three-slide project).
    """
    if len(slides) == 1:
        return filter_parts, "v0"

    prev = "v0"
    offset = 0.0
    for i in range(1, len(slides)):
        trans = slides[i].get("transition", {})
        xname = _XFADE.get(trans.get("type", "none"))
        tdur = float(trans.get("duration", 0.5)) if xname else 0.0
        # Additive: offset = cumulative sum of full clip durations (no subtraction)
        offset += float(slides[i - 1].get("duration", 3))
        out = f"xf{i}"
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
            fps_val = 30  # will be overridden by caller if needed; kept for compatibility
            filter_parts.append(f"[{prev}][v{i}]concat=n=2:v=1:a=0[{raw}]")
            filter_parts.append(f"[{raw}]settb=1/30,setpts=PTS-STARTPTS[{out}]")
        prev = out

    return filter_parts, prev


def build_transition_filters_fps(
    slides: list,
    filter_parts: list,
    fps: int,
) -> tuple[list[str], str]:
    """Variant of :func:`build_transition_filters` that uses the project fps for ``settb``.

    Prefer this function over :func:`build_transition_filters` when the fps is
    known.
    """
    if len(slides) == 1:
        return filter_parts, "v0"

    prev = "v0"
    offset = 0.0
    for i in range(1, len(slides)):
        trans = slides[i].get("transition", {})
        xname = _XFADE.get(trans.get("type", "none"))
        tdur = float(trans.get("duration", 0.5)) if xname else 0.0
        offset += float(slides[i - 1].get("duration", 3))
        out = f"xf{i}"
        if xname:
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

    return filter_parts, prev


def _pip_transparent_filters(filters: list) -> list:
    """Replace black fills with transparent ones in PIP continuous-effect filters.

    Called only for PIPs so that letterbox/oscillation padding is transparent
    (showing the base video layer) instead of opaque black.
    """
    result = []
    for f in filters:
        if "pad=" in f and ":black" in f:
            result.append("format=rgba")
            result.append(f.replace(":black", ":black@0", 1))
        elif "fillcolor=black" in f:
            result.append("format=rgba")
            result.append(f.replace("fillcolor=black", "fillcolor=black@0", 1))
        else:
            result.append(f)
    return result


def build_pip_filters(
    valid_pip: list,
    pip_input_start: int,
    final_video_label: str,
    width: int,
    height: int,
    total_dur: float,
    fps: int = 30,
) -> tuple[list[str], str]:
    """Build Picture-in-Picture overlay filters and return new filter fragments + final label.

    Layers are rendered in the order of *valid_pip* (first = bottom). Callers should
    sort by the ``order`` field before calling so that higher-order PIPs end up on top.

    For each PIP layer the function generates:
    1. Trim/speed for video PIPs.
    2. Scale to the PIP bounding box.
    3. Optional colour-effect filters.
    4. Optional start/end/continuous motion effects.
    5. Optional opacity (colorchannelmixer) filter.
    6. An overlay filter that enables the PIP only within its time window.

    Args:
        valid_pip:          List of PIP dicts that have ``_path`` resolved.
        pip_input_start:    FFmpeg input index of the first PIP file.
        final_video_label:  The video label to overlay onto (e.g. ``"vout_base"``).
        width, height:      Output video dimensions in pixels.
        total_dur:          Total video duration (seconds).
        fps:                Frame rate used for zoompan / continuous effects.

    Returns:
        ``(filter_parts, final_label)`` where *filter_parts* is a list of new
        filter strings and *final_label* is the output label after all PIPs.
    """
    filter_parts: list[str] = []
    current_label = final_video_label

    for pi, pip in enumerate(valid_pip):
        pip_type = pip.get("type", "image")
        px_pct = float(pip.get("x", 5))
        py_pct = float(pip.get("y", 5))
        pw_pct = float(pip.get("w", 30))
        ph_pct = float(pip.get("h", 20))
        pip_start  = float(pip.get("startTime", 0))
        pip_end    = float(pip.get("endTime", pip_start + 5))
        pip_dur    = max(0.001, pip_end - pip_start)
        pip_opacity = float(pip.get("opacity", 1))
        pip_speed  = float(pip.get("speed", 1) or 1)
        pip_trimin = float(pip.get("trimIn", 0) or 0)

        px = int(width  * px_pct / 100)
        py = int(height * py_pct / 100)
        pw = max(2, int(width  * pw_pct / 100) // 2 * 2)
        ph = max(2, int(height * ph_pct / 100) // 2 * 2)

        inp_idx = pip.get("_ffmpeg_idx", pip_input_start + pi)
        pip_label_raw    = f"pip_r_{pi}"
        pip_label_scaled = f"pip_s_{pi}"
        next_label       = f"vout_pip{pi}"

        # ── 1. Trim / speed ──────────────────────────────────────────────────
        pip_pre: list[str] = []
        if pip_type == "video":
            if pip_trimin > 0:
                pip_pre.append(f"trim=start={pip_trimin:.3f},setpts=PTS-STARTPTS")
            if pip_speed != 1.0:
                pip_pre.append(f"setpts={1.0 / pip_speed:.6f}*PTS")

        # ── 2. Continuous effect (may replace scale) ─────────────────────────
        cont_eff        = pip.get("continuousEffect") or {}
        cont_type       = (cont_eff.get("type") or "none").strip()
        cont_int        = float(cont_eff.get("intensity") or 30)
        pip_effect_speed = max(0.01, float(pip.get("effectSpeed", 1) or 1))
        replaces_scale, cont_filters = _continuous_effect_filters(
            cont_type, cont_int, pip_dur, pw, ph, fps, pip_type, speed=pip_effect_speed
        )

        if replaces_scale and pip_type == "image":
            # Ken Burns: zoompan already outputs pw×ph — no separate scale needed
            pip_parts = pip_pre + cont_filters
        else:
            # Convert to RGBA so the letterbox pad is transparent (shows base layer)
            pip_parts = pip_pre + [
                f"scale={pw}:{ph}:force_original_aspect_ratio=decrease:flags=lanczos",
                f"format=rgba",
                f"pad={pw}:{ph}:(ow-iw)/2:(oh-ih)/2:black@0",
            ]
            if cont_filters:
                pip_parts.extend(_pip_transparent_filters(cont_filters))

        # ── 3. Colour effects ────────────────────────────────────────────────
        for ef in pip.get("effects", []):
            et, ev = ef.get("type"), ef.get("value", 0)
            if et in _EFFECTS and float(ev) != 0:
                pip_parts.append(_EFFECTS[et](ev))

        # ── 4. Start / end motion effects ────────────────────────────────────
        start_eff = pip.get("startEffect") or {}
        end_eff   = pip.get("endEffect")   or {}
        se_type   = (start_eff.get("type") or "none").strip()
        ee_type   = (end_eff.get("type")   or "none").strip()
        se_dur    = max(0.001, min(float(start_eff.get("duration") or 1.0), pip_dur) / pip_effect_speed)
        ee_dur    = max(0.001, min(float(end_eff.get("duration")   or 1.0), pip_dur) / pip_effect_speed)
        pip_parts.extend(_start_effect_filters(se_type, se_dur, pip_dur, pw, ph))
        pip_parts.extend(_end_effect_filters(ee_type, ee_dur, pip_dur, pw, ph))

        filter_parts.append(f"[{inp_idx}:v]{','.join(pip_parts)}[{pip_label_scaled}]")

        # ── 5. Opacity ───────────────────────────────────────────────────────
        pip_label_in = pip_label_scaled
        if pip_opacity < 0.999:
            op_label = f"pip_op_{pi}"
            filter_parts.append(
                f"[{pip_label_in}]format=rgba,colorchannelmixer=aa={pip_opacity:.3f}[{op_label}]"
            )
            pip_label_in = op_label

        # ── 6. Overlay ───────────────────────────────────────────────────────
        enable = f"between(t\\,{pip_start:.3f}\\,{pip_end:.3f})"
        filter_parts.append(
            f"[{current_label}][{pip_label_in}]overlay={px}:{py}:enable='{enable}'[{next_label}]"
        )
        current_label = next_label

    return filter_parts, current_label


def _make_safe_fonts_dir(tmp_dir: str) -> str:
    """Create a temp dir with hard-links to only .ttf/.otf fonts.

    Windows Fonts dir contains .fon bitmap fonts which crash libass during
    directory scanning (STATUS_ACCESS_VIOLATION / exit 3221225477).
    Hard-linking only the TrueType/OpenType fonts avoids the crash.
    Falls back to an empty string if anything goes wrong (caller omits fontsdir).
    """
    try:
        safe = os.path.join(tmp_dir, "_fonts")
        os.makedirs(safe, exist_ok=True)
        wdir = os.environ.get("WINDIR", "C:\\Windows")
        src_dir = os.path.join(wdir, "Fonts")
        if not os.path.isdir(src_dir):
            return ""
        for fname in os.listdir(src_dir):
            if fname.lower().endswith((".ttf", ".otf")):
                try:
                    os.link(os.path.join(src_dir, fname), os.path.join(safe, fname))
                except OSError:
                    pass
        return safe
    except Exception:
        return ""


def build_subtitle_filter(
    all_subs: list,
    tmp_dir: str,
    width: int,
    height: int,
) -> str:
    """Write an ASS subtitle file and return the FFmpeg ``subtitles=`` filter string.

    Returns an empty string when *all_subs* is empty (no subtitles in project).
    On Windows a safe fonts directory containing only .ttf/.otf fonts is used
    to prevent libass from crashing on .fon bitmap fonts.

    Args:
        all_subs:  List of subtitle dicts with ``abs_start`` / ``abs_end`` keys.
        tmp_dir:   Temporary directory where the ``.ass`` file will be written.
        width:     Output video width (passed to :func:`_write_ass`).
        height:    Output video height (passed to :func:`_write_ass`).

    Returns:
        A filter string like ``subtitles='path/to/subs.ass'`` or ``""``.
    """
    if not all_subs:
        return ""

    from .ass_writer import _write_ass

    ass_path = os.path.join(tmp_dir, "subs.ass")
    _write_ass(all_subs, ass_path, width, height)

    if os.name == "nt":
        esc = ass_path.replace("\\", "/").replace(":", "\\:")
        safe_fonts = _make_safe_fonts_dir(tmp_dir)
        if safe_fonts:
            esc_fonts = safe_fonts.replace("\\", "/").replace(":", "\\:")
            return f"subtitles='{esc}':fontsdir='{esc_fonts}'"
        return f"subtitles='{esc}'"

    return f"subtitles='{ass_path}'"
