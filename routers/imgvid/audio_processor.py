"""Audio processing helpers for the image-video export pipeline.

Builds FFmpeg audio filter chains for individual tracks, applies sound effects,
and assembles multi-track mixes ready to be embedded in a ``-filter_complex``
argument.
"""

from typing import Optional


def build_acodec(codec_name: str, bitrate: str) -> list[str]:
    """Return FFmpeg audio encoder arguments for the given codec and bitrate.

    Supports: aac, mp3, opus, vorbis, pcm.  Unrecognised names default to AAC.
    """
    _amap: dict[str, list[str]] = {
        "aac":    ["-c:a", "aac",        "-b:a", bitrate],
        "mp3":    ["-c:a", "libmp3lame",  "-b:a", bitrate],
        "opus":   ["-c:a", "libopus",     "-b:a", bitrate],
        "vorbis": ["-c:a", "libvorbis",   "-b:a", bitrate],
        "pcm":    ["-c:a", "pcm_s16le"],
    }
    return _amap.get(codec_name, ["-c:a", "aac", "-b:a", bitrate])


def sfx_filter(sfx_type: str, sfx: dict) -> Optional[str]:
    """Return the FFmpeg audio filter string for a single sound-effect descriptor.

    Returns *None* when *sfx_type* is unknown so the caller can skip it.
    Supported effects: echo, reverb, bassboost, treble, compressor, phone,
    radio, lowpass, highpass, chorus, flanger, distortion, noise, pitch.
    """
    if sfx_type == "echo":
        d = int(sfx.get("delay", 500))
        dc = float(sfx.get("decay", 0.5))
        return f"aecho=0.6:0.3:{d}:{dc}"
    if sfx_type == "reverb":
        d = int(sfx.get("delay", 1000))
        dc = float(sfx.get("decay", 0.8))
        return f"aecho=0.8:0.9:{d}:{dc}"
    if sfx_type == "bassboost":
        g = float(sfx.get("gain", 10))
        return f"equalizer=f=60:t=o:w=1:g={g}"
    if sfx_type == "treble":
        g = float(sfx.get("gain", 8))
        return f"equalizer=f=8000:t=o:w=1:g={g}"
    if sfx_type == "compressor":
        r = float(sfx.get("ratio", 4))
        return f"acompressor=threshold=0.5:ratio={r}:attack=5:release=50"
    if sfx_type == "phone":
        return "highpass=f=300,lowpass=f=3400"
    if sfx_type == "radio":
        return "highpass=f=200,lowpass=f=3000"
    if sfx_type == "lowpass":
        return f"lowpass=f={int(sfx.get('freq', 500))}"
    if sfx_type == "highpass":
        return f"highpass=f={int(sfx.get('freq', 2000))}"
    if sfx_type == "chorus":
        return "chorus=0.7:0.9:55:0.4:0.25:2"
    if sfx_type == "flanger":
        return "flanger=delay=5:depth=2:speed=0.2:shape=sinusoidal"
    if sfx_type == "distortion":
        lv = float(sfx.get("level", 1.5))
        return f"acrusher=level_in={lv}:level_out=0.5:bits=8:mode=log"
    if sfx_type == "noise":
        return "afftdn=nf=-25"
    if sfx_type == "pitch":
        semi = float(sfx.get("semitones", 2))
        factor = 2 ** (semi / 12)
        rate = int(44100 * factor)
        inv = round(1.0 / factor, 4)
        return f"asetrate={rate},aresample=44100,atempo={inv}"
    return None


def build_audio_filter(
    track: dict,
    ai_idx: int,
    out_label: str,
    total_dur: float,
    clip_to_total: bool = True,
) -> str:
    """Build the FFmpeg filter chain string for one audio track.

    Handles: volume, trim, speed (chained atempo passes), fade-in/out, sound
    effects, start offset, and an optional hard trim to *total_dur*.

    Args:
        track:         Project audio-track descriptor dict.
        ai_idx:        FFmpeg input index for this audio file.
        out_label:     Output label, e.g. ``[aout]`` or ``[a0]``.
        total_dur:     Total video duration in seconds (used for fade-out and trim).
        clip_to_total: When True, append ``atrim=0:total_dur`` so the track
                       doesn't extend beyond the video length.

    Returns:
        A complete filter string ready to be joined with ``;`` in
        ``-filter_complex``.
    """
    vol = float(track.get("volume", 1.0))
    fi = float(track.get("fadeIn", track.get("fade_in", 0)))
    fo = float(track.get("fadeOut", track.get("fade_out", 0)))
    trim_in = float(track.get("trimIn", 0))
    start_off = float(track.get("startOffset", 0))
    track_dur = track.get("duration")
    track_dur_f = float(track_dur) if track_dur is not None else None
    speed = float(track.get("speed", 1.0))
    sound_fx = track.get("soundEffects") or []

    af: list[str] = []

    # Trim file start and/or limit segment duration
    if trim_in > 0 or track_dur_f is not None:
        atrim_args: list[str] = []
        if trim_in > 0:
            atrim_args.append(f"start={trim_in:.3f}")
        if track_dur_f is not None:
            atrim_args.append(f"end={trim_in + track_dur_f * speed:.3f}")
        af.append(f"atrim={':'.join(atrim_args)}")
        af.append("asetpts=PTS-STARTPTS")

    # Speed (atempo supports 0.5–2.0 per pass; chain for wider range)
    if abs(speed - 1.0) > 0.001:
        remaining = speed
        while remaining < 0.5:
            af.append("atempo=0.5")
            remaining /= 0.5
        while remaining > 2.0:
            af.append("atempo=2.0")
            remaining /= 2.0
        af.append(f"atempo={remaining:.6f}")

    af.append(f"volume={vol}")

    # Sound effects
    for sfx in sound_fx:
        sfx_type = (sfx.get("type") or "").strip()
        f_str = sfx_filter(sfx_type, sfx)
        if f_str:
            af.extend(f_str.split(","))

    if fi > 0:
        af.append(f"afade=t=in:ss=0:d={fi:.2f}")
    if fo > 0:
        fade_start = (
            (track_dur_f - fo)
            if track_dur_f
            else max(0, total_dur - fo - start_off)
        )
        af.append(f"afade=t=out:st={max(0, fade_start):.2f}:d={fo:.2f}")

    if start_off > 0:
        af.append(f"adelay={int(start_off * 1000)}:all=1")

    if clip_to_total:
        af.append(f"atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS")

    return f"[{ai_idx}:a]{','.join(af)}{out_label}"


def build_audio_chain(
    valid_audio: list,
    audio_start_idx: int,
    total_dur: float,
) -> tuple[list[str], list[str]]:
    """Build the complete audio filter chain for all valid audio tracks.

    For a single track the chain is a simple filter + clip.
    For multiple tracks individual filter outputs are mixed with ``amix``.

    Args:
        valid_audio:      List of audio track dicts (only existing-file tracks).
        audio_start_idx:  FFmpeg input index of the first audio file.
        total_dur:        Total video duration used for trimming and fade timing.

    Returns:
        A tuple of ``(filter_parts, audio_map)`` where *filter_parts* is a list
        of filter strings to append to the main filter_complex list, and
        *audio_map* is the ``-map`` argument list (e.g. ``["-map", "[aout]"]``).
    """
    if not valid_audio:
        return [], []

    filter_parts: list[str] = []
    audio_map: list[str] = []

    if len(valid_audio) == 1:
        filter_parts.append(
            build_audio_filter(valid_audio[0], audio_start_idx, "[aout]", total_dur, clip_to_total=True)
        )
        audio_map = ["-map", "[aout]"]
    else:
        for j, t in enumerate(valid_audio):
            filter_parts.append(
                build_audio_filter(t, audio_start_idx + j, f"[a{j}]", total_dur, clip_to_total=False)
            )
        amix_in = "".join(f"[a{j}]" for j in range(len(valid_audio)))
        filter_parts.append(
            f"{amix_in}amix=inputs={len(valid_audio)}:duration=longest:normalize=0,"
            f"atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS[aout]"
        )
        audio_map = ["-map", "[aout]"]

    return filter_parts, audio_map
