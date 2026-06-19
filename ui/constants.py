import os

_STATIC = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


def _load_js(name: str) -> str:
    with open(os.path.join(_STATIC, "js", name), encoding="utf-8") as f:
        return f.read()


def _load_css() -> str:
    with open(os.path.join(_STATIC, "styles.css"), encoding="utf-8") as f:
        return f.read()


STOP_ALL_JS = (
    "(...args) => { "
    "if (window.__ttsAudio) window.__ttsAudio.stop(); "
    "else document.querySelectorAll('audio').forEach(a => { try { a.pause(); a.currentTime = 0; } catch(_) {} }); "
    "return args; }"
)

PLAY_PREVIEW_JS = """
(...args) => {
    const root = document.querySelector('#voice_preview_audio');
    if (!root) return args;
    const tryPlay = (attempt = 0) => {
        const el = root.querySelector('audio');
        if (!el || !el.src) {
            if (attempt < 20) setTimeout(() => tryPlay(attempt + 1), 100);
            return;
        }
        if (window.__ttsAudio) {
            window.__ttsAudio.play(el.src).catch(() => {});
        }
    };
    tryPlay();
    return args;
}
"""
