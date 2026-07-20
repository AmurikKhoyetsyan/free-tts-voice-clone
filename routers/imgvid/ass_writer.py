import re


def _safe_font(name: str) -> str:
    """Strip path chars and validate font name for use in ASS \\fn tags; fall back to Arial."""
    if not name:
        return "Arial"
    clean = re.sub(r'[\\/:*?"<>|{}]', '', str(name)).strip()
    return clean if clean else "Arial"


def _ass_time(sec: float) -> str:
    sec      = max(0.0, sec)
    total_cs = int(round(sec * 100))
    cs       = total_cs % 100
    total_s  = total_cs // 100
    h        = total_s // 3600
    m        = (total_s % 3600) // 60
    s        = total_s % 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _write_ass(subs: list, path: str, width: int, height: int) -> None:
    head = "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,"
        " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle,"
        " Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        "0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    lines = [head]

    for sub in subs:
        raw_text  = str(sub.get("text", "")).replace("\n", "\\N")
        abs_start = float(sub.get("abs_start", 0))
        abs_end   = float(sub.get("abs_end",   3))

        font      = _safe_font(sub.get("fontFamily", "Arial"))
        size      = int(sub.get("fontSize", 40))
        color_hex = sub.get("color", "#ffffff").lstrip("#")
        try:
            cr, cg, cb = int(color_hex[0:2],16), int(color_hex[2:4],16), int(color_hex[4:6],16)
            primary = f"&H00{cb:02X}{cg:02X}{cr:02X}"
        except Exception:
            primary = "&H00FFFFFF"

        bold      = 1 if sub.get("bold")      else 0
        italic    = 1 if sub.get("italic")    else 0
        underline = 1 if sub.get("underline") else 0
        outline   = float(sub.get("outline", 2))
        shadow    = float(sub.get("shadow",  1))
        rotation  = float(sub.get("rotation", 0))

        x_pct = float(sub.get("x", 50))
        y_pct = float(sub.get("y", 88))
        px    = int(width  * x_pct / 100)
        py    = int(height * y_pct / 100)

        # Width constraint: matches preview's max-width:90% default (or sub.w%)
        w_pct     = float(sub.get("w", 0))
        half_w_px = (w_pct / 200.0 * width) if w_pct > 0 else (0.45 * width)
        margin_l  = max(0, int(px - half_w_px))
        margin_r  = max(0, int(width - px - half_w_px))

        # Text alignment → ASS anchor code + anchor x position.
        # Preview uses translate(-50%,-50%) so CENTER of the subtitle box is at (x%,y%).
        # \an5 = center anchor → matches preview for center-aligned text.
        # For left/right, the anchor shifts to the edge of the allowed text region.
        align = (sub.get("align") or "center").lower()
        if align == "left":
            an_code = 4
            text_px = max(0, int(px - half_w_px))
        elif align == "right":
            an_code = 6
            text_px = min(width, int(px + half_w_px))
        else:
            an_code = 5
            text_px = px

        anim     = sub.get("animation", "none") or "none"
        anim_dur = float(sub.get("animDuration", 0.6))
        anim_ms  = int(anim_dur * 1000)
        half_ms  = anim_ms // 2

        oc = sub.get("outlineColor", "#000000").lstrip("#")
        try:    ass_oc = f"&H00{int(oc[4:6],16):02X}{int(oc[2:4],16):02X}{int(oc[0:2],16):02X}"
        except: ass_oc = "&H00000000"
        sc_hex = sub.get("shadowColor", "#000000").lstrip("#")
        try:    ass_sc = f"&H00{int(sc_hex[4:6],16):02X}{int(sc_hex[2:4],16):02X}{int(sc_hex[0:2],16):02X}"
        except: ass_sc = "&H00000000"

        # Position / rotation tags (separated so slides can swap \pos for \move)
        rot_tag = f"\\frz{rotation:.1f}" if rotation else ""
        pos_tag = f"\\an{an_code}\\pos({text_px},{py}){rot_tag}"

        # Style tags (font + colours + border/shadow — no position here)
        style_tags = (f"\\fn{font}\\fs{size}\\c{primary}"
                      f"\\b{bold}\\i{italic}\\u{underline}"
                      f"\\bord{outline:.1f}\\shad{shadow:.1f}"
                      f"\\3c{ass_oc}\\4c{ass_sc}")

        base = style_tags + pos_tag  # full per-event tag string

        # ── Background box ─────────────────────────────────────────────────────
        # Dual-layer approach: Layer 0 = invisible-text + thick coloured border (box),
        #                      Layer 1 = actual styled text on top.
        bg_op  = float(sub.get("bgOpacity", 0))
        has_bg = bg_op > 0
        ass_bg = ass_bg_a = bgpad = None
        if has_bg:
            bg_hex = sub.get("bgColor", "#000000").lstrip("#")
            try:
                bg_r, bg_g, bg_b = int(bg_hex[0:2],16), int(bg_hex[2:4],16), int(bg_hex[4:6],16)
                ass_bg   = f"&H00{bg_b:02X}{bg_g:02X}{bg_r:02X}"
                ass_bg_a = f"&H{int((1.0 - bg_op) * 255):02X}&"
            except Exception:
                ass_bg   = "&H00000000"
                ass_bg_a = "&H80&"
            bgpad = max(4, int(float(sub.get("bgPadX", 12))), int(float(sub.get("bgPadY", 6))))

        text_layer = 1 if has_bg else 0  # text goes on layer 1 when box is layer 0

        def _bg_tags(extra=""):
            """Tags for the background box layer (Layer 0)."""
            return (f"\\fn{font}\\fs{size}\\b{bold}\\i{italic}\\u{underline}"
                    f"\\1a&HFF&"                          # primary text invisible
                    f"\\3c{ass_bg}\\3a{ass_bg_a}"         # outline = box colour + alpha
                    f"\\4a&HFF&\\shad0\\bord{bgpad}"      # no shadow, thick border = box
                    + pos_tag + extra)

        def _dl(layer, t0, t1, tag_body, txt):
            lines.append(
                f"Dialogue: {layer},{_ass_time(t0)},{_ass_time(t1)},"
                f"Default,,{margin_l},{margin_r},0,,{{{tag_body}}}{txt}"
            )

        def _box(t0, t1, extra=""):
            if has_bg:
                _dl(0, t0, t1, _bg_tags(extra), raw_text)

        def _text(t0, t1, extra="", txt=None):
            _dl(text_layer, t0, t1, base + extra, raw_text if txt is None else txt)

        # ── Karaoke ────────────────────────────────────────────────────────────
        karaoke_on = bool(sub.get("karaokeEnable", False))
        kc_hex = sub.get("karaokeColor", "#ffdd00").lstrip("#")
        try:    ass_kc = f"&H00{int(kc_hex[4:6],16):02X}{int(kc_hex[2:4],16):02X}{int(kc_hex[0:2],16):02X}"
        except: ass_kc = "&H0000DDFF"

        if karaoke_on and raw_text.strip() and abs_end > abs_start:
            _box(abs_start, abs_end)  # box spans full subtitle duration
            words = [w for w in re.split(r'(?:\\N|\s)+', raw_text) if w]
            n = max(1, len(words))
            word_dur = (abs_end - abs_start) / n
            kmode = sub.get("karaokeMode", "word")
            abs_start_cs = int(round(abs_start * 100))
            abs_end_cs   = int(round(abs_end   * 100))
            for stage in range(n):
                t0_cs = abs_start_cs + int(round(stage * word_dur * 100))
                t1_cs = (abs_start_cs + int(round((stage + 1) * word_dur * 100))
                         if stage < n - 1 else abs_end_cs)
                t1_cs = min(t1_cs, abs_end_cs)
                if t0_cs >= t1_cs:
                    t0_cs = max(abs_start_cs, t1_cs - 1)
                if t0_cs >= t1_cs:
                    continue
                t0_k, t1_k = t0_cs / 100.0, t1_cs / 100.0
                raw_tokens = re.split(r'((?:\\N|\s)+)', raw_text)
                wi, ktext_parts = 0, []
                for tok in raw_tokens:
                    if not tok:
                        continue
                    if re.fullmatch(r'(?:\\N|\s)+', tok):
                        ktext_parts.append(tok)
                    else:
                        if kmode == "cumulative":
                            c = ass_kc if wi <= stage else primary
                            ktext_parts.append(f"{{\\1c{c}}}{tok}")
                        else:
                            ktext_parts.append(
                                f"{{\\1c{ass_kc}}}{tok}{{\\1c{primary}}}"
                                if wi == stage else tok
                            )
                        wi += 1
                _dl(text_layer, t0_k, t1_k, base, "".join(ktext_parts))

        elif anim == "fade-in":
            fad = f"\\fad({anim_ms},0)"
            _box(abs_start, abs_end, fad)
            _text(abs_start, abs_end, fad)

        elif anim == "fade-out":
            fad = f"\\fad(0,{anim_ms})"
            _box(abs_start, abs_end, fad)
            _text(abs_start, abs_end, fad)

        elif anim in ("slide-up", "slide-down"):
            # \move replaces \pos; keep the same \an anchor code
            dy = 30 if anim == "slide-up" else -30
            move_pos  = f"\\an{an_code}\\move({text_px},{py + dy},{text_px},{py},0,{anim_ms}){rot_tag}"
            anim_fad  = f"\\fad({half_ms},{half_ms})"
            if has_bg:
                _dl(0, abs_start, abs_end,
                    f"\\fn{font}\\fs{size}\\b{bold}\\i{italic}\\u{underline}"
                    f"\\1a&HFF&\\3c{ass_bg}\\3a{ass_bg_a}\\4a&HFF&\\shad0\\bord{bgpad}"
                    + move_pos + anim_fad,
                    raw_text)
            _dl(text_layer, abs_start, abs_end,
                style_tags + move_pos + anim_fad,
                raw_text)

        elif anim == "zoom-in":
            # Scale from 5% + fade in — matches CSS sub-zoom-in (opacity:0,scale:.5 → 1)
            zoom = f"\\fad({anim_ms},0)\\fscx5\\fscy5\\t(0,{anim_ms},\\fscx100\\fscy100)"
            _box(abs_start, abs_end, zoom)
            _text(abs_start, abs_end, zoom)

        elif anim == "typewriter":
            # Character-by-character reveal over animDuration, then hold until abs_end.
            # Background box is visible for the full duration.
            _box(abs_start, abs_end)
            visible = []
            idx = 0
            while idx < len(raw_text):
                if raw_text[idx:idx+2] == "\\N":
                    visible.append("\\N"); idx += 2
                else:
                    visible.append(raw_text[idx]); idx += 1
            n_chars  = max(1, len([c for c in visible if c != "\\N"]))
            char_dur = anim_dur / n_chars
            shown, char_count = [], 0
            for step, ch in enumerate(visible):
                shown.append(ch)
                if ch != "\\N":
                    char_count += 1
                t0_tw = abs_start + (char_count - 1) * char_dur if ch != "\\N" else abs_start
                t1_tw = abs_start + char_count * char_dur if step < len(visible) - 1 else abs_end
                _dl(text_layer, t0_tw, min(t1_tw, abs_end), base, "".join(shown))

        else:  # none / unknown animation
            _box(abs_start, abs_end)
            _text(abs_start, abs_end)

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
