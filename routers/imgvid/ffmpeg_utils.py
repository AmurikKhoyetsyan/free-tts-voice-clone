import os, shutil, subprocess

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


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


def _compute_video_dur(slides: list) -> float:
    """Total video duration: additive model — clips keep their full duration."""
    return max(0.0, sum(float(s.get("duration", 3)) for s in slides))


_KEN_BURNS_TYPES = {"ken-burns-in", "ken-burns-out", "ken-burns-lr", "ken-burns-rl"}


def _start_effect_filters(se_type: str, se_dur: float, dur: float, w: int, h: int) -> list:
    if not se_type or se_type == "none":
        return []
    D = max(0.001, se_dur)
    if se_type == "fade-in":
        return [f"fade=type=in:start_time=0:duration={D:.3f}"]
    if se_type == "zoom-in":
        expr = f"min(1,0.5+0.5*min(1,t/{D:.3f}))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
            f"fade=type=in:start_time=0:duration={D:.3f}",
        ]
    if se_type == "zoom-out":
        expr = f"min(2,1.5-0.5*min(1,t/{D:.3f}))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"crop={w}:{h}:(iw-{w})/2:(ih-{h})/2",
            f"fade=type=in:start_time=0:duration={D:.3f}",
        ]
    if se_type == "slide-left":
        return [
            f"pad={w*2}:{h}:0:0:black",
            f"crop={w}:{h}:'round({w}*(1-min(1,t/{D:.3f})))':0",
        ]
    if se_type == "slide-right":
        return [
            f"pad={w*2}:{h}:{w}:0:black",
            f"crop={w}:{h}:'round({w}*min(1,t/{D:.3f}))':0",
        ]
    if se_type == "slide-up":
        return [
            f"pad={w}:{h*2}:0:0:black",
            f"crop={w}:{h}:0:'round({h}*(1-min(1,t/{D:.3f})))'",
        ]
    if se_type == "slide-down":
        return [
            f"pad={w}:{h*2}:0:{h}:black",
            f"crop={w}:{h}:0:'round({h}*min(1,t/{D:.3f}))'",
        ]
    if se_type == "blur-in":
        return [f"fade=type=in:start_time=0:duration={D:.3f}"]
    if se_type == "rotate-in":
        return [
            f"rotate=a='(-PI/2)*(1-min(1,t/{D:.3f}))':fillcolor=black,scale={w}:{h},setsar=1",
            f"fade=type=in:start_time=0:duration={min(D, 0.4):.3f}",
        ]
    if se_type == "flip-h-in":
        expr = f"max(2,trunc({w}*min(1,t/{D:.3f})/2)*2)"
        return [
            f"scale='{expr}':{h}:eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:0:black",
        ]
    if se_type == "reveal-center":
        expr = f"min(1,t/{D:.3f})"
        return [
            f"scale='max(2,trunc({w}*({expr})/2)*2)':'max(2,trunc({h}*({expr})/2)*2)':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
        ]
    if se_type == "bounce-in":
        expr = f"min(1.1,1.1*min(1,t/{D:.3f}))"
        return [
            f"scale='max(2,trunc({w}*min(1,{expr})/2)*2)':'max(2,trunc({h}*min(1,{expr})/2)*2)':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
            f"fade=type=in:start_time=0:duration={min(D, 0.35):.3f}",
        ]
    return []


def _end_effect_filters(ee_type: str, ee_dur: float, dur: float, w: int, h: int) -> list:
    if not ee_type or ee_type == "none":
        return []
    D  = max(0.001, ee_dur)
    st = max(0.0, dur - D)
    if ee_type == "fade-out":
        return [f"fade=type=out:start_time={st:.3f}:duration={D:.3f}"]
    if ee_type == "zoom-in":
        expr = f"min(2,1+0.5*(1-min(1,max(0,({dur:.3f}-t)/{D:.3f}))))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"crop={w}:{h}:(iw-{w})/2:(ih-{h})/2",
            f"fade=type=out:start_time={st:.3f}:duration={D:.3f}",
        ]
    if ee_type == "zoom-out":
        expr = f"max(0.5,min(1,({dur:.3f}-t)/{D:.3f}))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
            f"fade=type=out:start_time={st:.3f}:duration={D:.3f}",
        ]
    if ee_type == "slide-left":
        return [
            f"pad={w*2}:{h}:0:0:black",
            f"crop={w}:{h}:'round({w}*(1-min(1,max(0,({dur:.3f}-t)/{D:.3f}))))':0",
        ]
    if ee_type == "slide-right":
        return [
            f"pad={w*2}:{h}:{w}:0:black",
            f"crop={w}:{h}:'round({w}*min(1,max(0,({dur:.3f}-t)/{D:.3f})))':0",
        ]
    if ee_type == "slide-up":
        return [
            f"pad={w}:{h*2}:0:0:black",
            f"crop={w}:{h}:0:'round({h}*(1-min(1,max(0,({dur:.3f}-t)/{D:.3f}))))'",
        ]
    if ee_type == "slide-down":
        return [
            f"pad={w}:{h*2}:0:{h}:black",
            f"crop={w}:{h}:0:'round({h}*min(1,max(0,({dur:.3f}-t)/{D:.3f})))'",
        ]
    if ee_type == "blur-out":
        return [f"fade=type=out:start_time={st:.3f}:duration={D:.3f}"]
    if ee_type == "rotate-out":
        return [
            f"rotate=a='(PI/2)*(1-min(1,max(0,({dur:.3f}-t)/{D:.3f})))':fillcolor=black,scale={w}:{h},setsar=1",
            f"fade=type=out:start_time={st:.3f}:duration={min(D, 0.4):.3f}",
        ]
    if ee_type == "flip-h-out":
        expr = f"max(2,trunc({w}*max(0,({dur:.3f}-t)/{D:.3f})/2)*2)"
        return [
            f"scale='{expr}':{h}:eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:0:black",
        ]
    if ee_type == "hide-center":
        expr = f"max(0,min(1,({dur:.3f}-t)/{D:.3f}))"
        return [
            f"scale='max(2,trunc({w}*({expr})/2)*2)':'max(2,trunc({h}*({expr})/2)*2)':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
        ]
    if ee_type == "bounce-out":
        expr = f"min(1.1,1.1*max(0,({dur:.3f}-t)/{D:.3f}))"
        return [
            f"scale='max(2,trunc({w}*min(1,{expr})/2)*2)':'max(2,trunc({h}*min(1,{expr})/2)*2)':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
            f"fade=type=out:start_time={st:.3f}:duration={min(D, 0.35):.3f}",
        ]
    return []


def _continuous_effect_filters(
    cont_type: str, intensity: float, dur: float, w: int, h: int, fps: int,
    clip_type: str = "image",
) -> tuple[bool, list]:
    """Returns (replaces_scale, filter_list).

    If replaces_scale is True the caller should skip the normal scale/pad
    filter and use filter_list instead (Ken Burns zoompan case).
    Otherwise filter_list should be appended AFTER the normal scale filter.
    """
    if not cont_type or cont_type == "none":
        return False, []

    intens = max(0.01, min(1.0, intensity / 100.0))
    nframes = max(2, int(round(dur * fps)))

    # ── Ken Burns (image only via zoompan) ───────────────────────────────────
    if cont_type in _KEN_BURNS_TYPES and clip_type == "image":
        if cont_type == "ken-burns-in":
            z0 = 1.0
            z1 = round(1.0 + intens * 0.5, 3)
            f = (
                f"zoompan=z='max({z0},{z0}+({z1}-{z0})*on/{nframes})'"
                f":d={nframes}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":s={w}x{h}:fps={fps}"
            )
        elif cont_type == "ken-burns-out":
            z0 = round(1.0 + intens * 0.5, 3)
            z1 = 1.0
            f = (
                f"zoompan=z='max(1,{z0}+({z1}-{z0})*on/{nframes})'"
                f":d={nframes}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":s={w}x{h}:fps={fps}"
            )
        elif cont_type == "ken-burns-lr":
            zoom = round(1.0 + intens * 0.15, 3)
            f = (
                f"zoompan=z='{zoom}'"
                f":d={nframes}:x='(iw-iw/zoom)*on/{nframes}':y='ih/2-(ih/zoom/2)'"
                f":s={w}x{h}:fps={fps}"
            )
        else:  # ken-burns-rl
            zoom = round(1.0 + intens * 0.15, 3)
            f = (
                f"zoompan=z='{zoom}'"
                f":d={nframes}:x='(iw-iw/zoom)*(1-on/{nframes})':y='ih/2-(ih/zoom/2)'"
                f":s={w}x{h}:fps={fps}"
            )
        return True, [f, f"format=yuv420p"]

    # ── Oscillating effects (applied after scale) ─────────────────────────────
    if cont_type == "pulse":
        amp = intens * 0.08
        expr_s = f"1+{amp:.4f}*sin(2*PI*t/2.5)"
        return False, [
            f"scale='trunc({w}*({expr_s})/2)*2':'trunc({h}*({expr_s})/2)*2':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
        ]
    if cont_type == "shake":
        amp = max(1, int(intens * w * 0.025))
        return False, [
            f"pad={w + amp * 2}:{h}:{amp}:0:black",
            f"crop={w}:{h}:'round({amp}+{amp}*sin(2*PI*t/0.9))':0",
        ]
    if cont_type == "float":
        amp = max(1, int(intens * h * 0.025))
        return False, [
            f"pad={w}:{h + amp * 2}:0:{amp}:black",
            f"crop={w}:{h}:0:'round({amp}+{amp}*sin(2*PI*t/3.5))'",
        ]
    if cont_type == "zoom-breathe":
        amp = intens * 0.06
        expr_s = f"1+{amp:.4f}*sin(2*PI*t/5.0)"
        return False, [
            f"scale='trunc({w}*({expr_s})/2)*2':'trunc({h}*({expr_s})/2)*2':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
        ]
    if cont_type == "rotate-slow":
        deg_per_sec = intens * 30
        return False, [
            f"rotate=a='{deg_per_sec:.2f}*(PI/180)*t':fillcolor=black"
            f",scale={w}:{h},setsar=1",
        ]
    return False, []
