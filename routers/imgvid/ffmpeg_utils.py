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
    """Exact video stream duration after xfade transitions shorten it."""
    total = sum(float(s.get("duration", 3)) for s in slides)
    for i in range(1, len(slides)):
        trans = slides[i].get("transition", {})
        if _XFADE.get(trans.get("type", "none")):
            total -= float(trans.get("duration", 0.5))
    return max(0.0, total)
