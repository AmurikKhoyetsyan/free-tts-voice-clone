import gradio as gr
from asyncio.proactor_events import _ProactorBasePipeTransport

from core.voice_manager import voices_dropdown, VOICES_DIR
from core.audio import OUTPUT_DIR
from ui.constants import _load_css, _load_js
from ui.windows_tab import build as build_windows
from ui.cloning_tab import build as build_cloning
from ui.my_voices_tab import build as build_my_voices, _voice_urls_json

# Suppress harmless Windows asyncio "connection forcibly closed" noise.
_orig = _ProactorBasePipeTransport._call_connection_lost
def _silent(self, exc):
    try:
        _orig(self, exc)
    except ConnectionResetError:
        pass
_ProactorBasePipeTransport._call_connection_lost = _silent

_css = _load_css()
_global_js = _load_js("global.js")


with gr.Blocks(title="TTS — Синтез речи", theme=gr.themes.Soft(), css=_css, js=_global_js) as app:
    gr.Markdown("# Синтез речи и клонирование голоса")
    with gr.Tabs():
        build_windows()
        build_cloning()
        sv_voice, sv_urls = build_my_voices()

    # Обновляем список голосов и URL-карту при каждом открытии страницы
    app.load(fn=voices_dropdown, outputs=[sv_voice])
    app.load(fn=_voice_urls_json, outputs=[sv_urls])
    # Дублирующий запуск логгера через app.load — на случай если js= на Blocks
    # по какой-то причине не отработал (старая версия Gradio, кэш, и т.п.).
    app.load(fn=None, inputs=None, outputs=None, js=_global_js)
    # Инжектим ▶ в опции дропдауна голосов (один раз, ставит MutationObserver)
    app.load(fn=None, inputs=None, outputs=None, js=_load_js("inject_options.js"))

if __name__ == "__main__":
    app.launch(inbrowser=True, allowed_paths=[VOICES_DIR, OUTPUT_DIR])
