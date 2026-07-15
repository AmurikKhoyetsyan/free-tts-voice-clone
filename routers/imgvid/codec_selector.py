"""Codec selection helpers for the image-video export pipeline.

Translates human-readable codec names and quality settings into FFmpeg
argument lists that can be inserted directly into a subprocess command.
"""

# Maps user-facing codec names to FFmpeg encoder identifiers.
_CODEC_NAME_MAP: dict[str, str] = {
    "h264":   "libx264",
    "h265":   "libx265",
    "hevc":   "libx265",
    "vp9":    "libvpx-vp9",
    "vp8":    "libvpx",
    "av1":    "libaom-av1",
    "prores": "prores_ks",
    "mpeg4":  "mpeg4",
}

# Default encoder for each output container when no explicit codec is chosen.
_FMT_DEFAULT_CODEC: dict[str, str] = {
    "mp4":  "libx264",
    "mov":  "libx264",
    "mkv":  "libx264",
    "m4v":  "libx264",
    "avi":  "libx264",
    "flv":  "libx264",
    "webm": "libvpx-vp9",
    "ogv":  "libtheora",
    "wmv":  "wmv2",
    "mpeg": "mpeg2video",
    "gif":  "gif",
}


def resolve_codec_name(codec: str, output_format: str) -> str:
    """Return the FFmpeg encoder name to use for a given user codec choice and container.

    If *codec* is empty or unknown, the function falls back to the format's
    default encoder.  Alias resolution (e.g. 'h264' → 'libx264') is applied
    before the fallback lookup.
    """
    name = _CODEC_NAME_MAP.get(codec.lower(), codec.lower()) if codec else ""
    return name or _FMT_DEFAULT_CODEC.get(output_format.lower(), "libx264")


def select_video_codec(vcodec_name: str, crf: int, output_format: str) -> list[str]:
    """Return the FFmpeg video codec argument list for the given encoder and quality.

    Handles special cases:
    - GIF: palette-based encoding, no CRF concept (returns ``["-c:v", "gif"]``).
    - libx264 lossless (crf=0): uses CRF 1 instead of 0 to avoid a Windows FFmpeg
      bug where CRF=0 activates a special lossless path that produces audio-only files.
    - libx265 lossless: CRF=0 is safe and near-lossless.
    - VP9, VP8, AV1, ProRes, Theora, WMV, MPEG-2, MPEG-4: appropriate parameters
      for each encoder are applied.
    - Unknown codecs fall back to libx264.
    """
    ext = output_format.lower()

    if ext == "gif":
        return ["-c:v", "gif"]

    if vcodec_name in ("libx264", "libx265"):
        if crf == 0:
            if vcodec_name == "libx264":
                # CRF=1 instead of CRF=0: x264 CRF=0 activates a special internal
                # lossless encoding path which is broken in many Windows FFmpeg builds
                # (encoder fails silently, muxer writes an audio-only file).
                # CRF=1 uses the standard encoding path and is visually identical.
                return ["-c:v", "libx264", "-crf", "1", "-preset", "slow", "-pix_fmt", "yuv420p"]
            else:
                return ["-c:v", "libx265", "-crf", "0", "-preset", "slow", "-pix_fmt", "yuv420p"]
        return ["-c:v", vcodec_name, "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p"]

    if vcodec_name == "libvpx-vp9":
        vp9_crf = max(0, min(63, crf * 63 // 51))
        return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(vp9_crf), "-pix_fmt", "yuv420p"]

    if vcodec_name == "libvpx":
        return ["-c:v", "libvpx", "-b:v", "2M", "-pix_fmt", "yuv420p"]

    if vcodec_name == "libaom-av1":
        av1_crf = max(0, min(63, crf))
        return ["-c:v", "libaom-av1", "-crf", str(av1_crf), "-b:v", "0", "-pix_fmt", "yuv420p"]

    if vcodec_name == "prores_ks":
        return ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"]

    if vcodec_name == "libtheora":
        return ["-c:v", "libtheora", "-q:v", "7", "-pix_fmt", "yuv420p"]

    if vcodec_name == "wmv2":
        return ["-c:v", "wmv2", "-b:v", "2M", "-pix_fmt", "yuv420p"]

    if vcodec_name == "mpeg2video":
        return ["-c:v", "mpeg2video", "-b:v", "4M", "-pix_fmt", "yuv420p"]

    if vcodec_name == "mpeg4":
        return ["-c:v", "mpeg4", "-b:v", "2M", "-pix_fmt", "yuv420p"]

    # Unknown codec: fall back to libx264
    if crf == 0:
        return ["-c:v", "libx264", "-crf", "1", "-preset", "slow", "-pix_fmt", "yuv420p"]
    return ["-c:v", "libx264", "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p"]


def select_audio_codec(audio_codec: str, audio_bitrate: str, has_audio: bool) -> list[str]:
    """Return the FFmpeg audio codec argument list for the given encoder settings.

    Returns an empty list when *has_audio* is False (no audio track in the
    project) or when the container does not support audio (e.g. GIF).
    """
    if not has_audio:
        return []
    return _build_acodec(audio_codec, audio_bitrate)


def _build_acodec(acodec_name: str, abitrate: str) -> list[str]:
    """Map a user-facing audio codec name to FFmpeg ``-c:a`` / ``-b:a`` arguments."""
    _amap: dict[str, list[str]] = {
        "aac":    ["-c:a", "aac",         "-b:a", abitrate],
        "mp3":    ["-c:a", "libmp3lame",   "-b:a", abitrate],
        "opus":   ["-c:a", "libopus",      "-b:a", abitrate],
        "vorbis": ["-c:a", "libvorbis",    "-b:a", abitrate],
        "pcm":    ["-c:a", "pcm_s16le"],
    }
    return _amap.get(acodec_name, ["-c:a", "aac", "-b:a", abitrate])
