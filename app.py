import gradio as gr
from asyncio.proactor_events import _ProactorBasePipeTransport

from core.voice_manager import voices_dropdown, voices_urls_json, VOICES_DIR
from core.audio import OUTPUT_DIR
from ui.constants import _load_css, _load_js, build_icons_js
from ui.windows_tab import build as build_windows
from ui.cloning_tab import build as build_cloning
from ui.my_voices_tab import build as build_my_voices
from ui.history_tab import build as build_history

# Suppress harmless Windows asyncio "connection forcibly closed" noise.
_orig = _ProactorBasePipeTransport._call_connection_lost
def _silent(self, exc):
    try:
        _orig(self, exc)
    except ConnectionResetError:
        pass
_ProactorBasePipeTransport._call_connection_lost = _silent

_css = _load_css()
# All JS combined in order: icons first → global → options.
# Single js= in launch() guarantees they run together before Gradio load events.
_all_js = "\n;\n".join([
    build_icons_js(),
    _load_js("global.js"),
    _load_js("inject_options.js"),
])

with gr.Blocks(title="TTS — Синтез речи") as app:
    gr.Markdown("# Синтез речи и клонирование голоса")
    with gr.Tabs():
        build_windows()
        build_cloning()
        sv_voice, sv_urls = build_my_voices()
        build_history()

    app.load(fn=voices_dropdown, outputs=[sv_voice])
    app.load(fn=voices_urls_json, outputs=[sv_urls])

if __name__ == "__main__":
    # Gradio 6 bug: url_ok() can return False even when server is running.
    # Bypass the check to prevent "localhost not accessible" ValueError.
    try:
        import gradio.networking as _gn
        _gn.url_ok = lambda url: True
    except Exception:
        pass

    app.launch(
        inbrowser=True,
        allowed_paths=[VOICES_DIR, OUTPUT_DIR],
        theme=gr.themes.Soft(),
        css=_css,
        js=_all_js,            # icons → global → options, all in one shot
        footer_links=[],       # hide API / Gradio footer links
    )
