import os

_STATIC = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


def _load_js(name: str) -> str:
    with open(os.path.join(_STATIC, "js", name), encoding="utf-8") as f:
        return f.read()


def _load_css() -> str:
    with open(os.path.join(_STATIC, "styles.css"), encoding="utf-8") as f:
        return f.read()


def _load_svg(name: str) -> str:
    with open(os.path.join(_STATIC, "img", f"{name}.svg"), encoding="utf-8") as f:
        return f.read().strip()


def build_icons_js() -> str:
    """Returns a JS snippet that sets window.__ttsIconSvg from static/img/ files."""
    import json
    names = ["icon_play", "icon_pause", "icon_edit", "icon_download", "icon_delete", "icon_note", "icon_loader"]
    entries = []
    for name in names:
        try:
            key = name.replace("icon_", "")
            entries.append(f"  {json.dumps(key)}: {json.dumps(_load_svg(name))}")
        except FileNotFoundError:
            pass
    return "window.__ttsIconSvg = {\n" + ",\n".join(entries) + "\n};"


STOP_ALL_JS     = _load_js("snippets/stop_all.js")
PLAY_PREVIEW_JS = _load_js("snippets/play_preview.js")
HIST_FILE_JS    = _load_js("snippets/hist_file.js")
