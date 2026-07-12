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


def _start_effect_filters(se_type: str, se_dur: float, dur: float, w: int, h: int) -> list:
    if not se_type or se_type == "none":
        return []
    D = max(0.001, se_dur)
    if se_type == "fade-in":
        return [f"fade=type=in:start_time=0:duration={D:.3f}"]
    if se_type == "zoom-in":
        # Scale from 50%→100% with fade; single-quoted exprs allow literal commas
        expr = f"min(1,0.5+0.5*min(1,t/{D:.3f}))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black:eval=frame",
            f"fade=type=in:start_time=0:duration={D:.3f}",
        ]
    if se_type == "zoom-out":
        # Scale from 150%→100% with fade; crop centers the oversized frame
        expr = f"min(2,1.5-0.5*min(1,t/{D:.3f}))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"crop={w}:{h}:(iw-{w})/2:(ih-{h})/2:eval=frame",
            f"fade=type=in:start_time=0:duration={D:.3f}",
        ]
    if se_type == "slide-left":
        # Clip enters from left; crop window shifts from right-of-pad to origin
        return [
            f"pad={w*2}:{h}:0:0:black",
            f"crop={w}:{h}:'round({w}*(1-min(1,t/{D:.3f})))':0:eval=frame",
        ]
    if se_type == "slide-right":
        # Clip enters from right; crop window shifts left-to-right into image
        return [
            f"pad={w*2}:{h}:{w}:0:black",
            f"crop={w}:{h}:'round({w}*min(1,t/{D:.3f}))':0:eval=frame",
        ]
    if se_type == "slide-up":
        return [
            f"pad={w}:{h*2}:0:0:black",
            f"crop={w}:{h}:0:'round({h}*(1-min(1,t/{D:.3f})))':eval=frame",
        ]
    if se_type == "slide-down":
        return [
            f"pad={w}:{h*2}:0:{h}:black",
            f"crop={w}:{h}:0:'round({h}*min(1,t/{D:.3f}))':eval=frame",
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
        # Scale from 100%→150% as clip ends, crop to maintain size, then fade-out
        expr = f"min(2,1+0.5*(1-min(1,max(0,({dur:.3f}-t)/{D:.3f}))))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"crop={w}:{h}:(iw-{w})/2:(ih-{h})/2:eval=frame",
            f"fade=type=out:start_time={st:.3f}:duration={D:.3f}",
        ]
    if ee_type == "zoom-out":
        # Scale from 100%→50% as clip ends, pad to maintain size, then fade-out
        expr = f"max(0.5,min(1,({dur:.3f}-t)/{D:.3f}))"
        return [
            f"scale='trunc({w}*({expr})/2)*2':'trunc({h}*({expr})/2)*2':eval=frame",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black:eval=frame",
            f"fade=type=out:start_time={st:.3f}:duration={D:.3f}",
        ]
    if ee_type == "slide-left":
        return [
            f"pad={w*2}:{h}:0:0:black",
            f"crop={w}:{h}:'round({w}*(1-min(1,max(0,({dur:.3f}-t)/{D:.3f}))))':0:eval=frame",
        ]
    if ee_type == "slide-right":
        return [
            f"pad={w*2}:{h}:{w}:0:black",
            f"crop={w}:{h}:'round({w}*min(1,max(0,({dur:.3f}-t)/{D:.3f})))':0:eval=frame",
        ]
    if ee_type == "slide-up":
        return [
            f"pad={w}:{h*2}:0:0:black",
            f"crop={w}:{h}:0:'round({h}*(1-min(1,max(0,({dur:.3f}-t)/{D:.3f}))))':eval=frame",
        ]
    if ee_type == "slide-down":
        return [
            f"pad={w}:{h*2}:0:{h}:black",
            f"crop={w}:{h}:0:'round({h}*min(1,max(0,({dur:.3f}-t)/{D:.3f})))':eval=frame",
        ]
    return []
