import gradio as gr
from asyncio.proactor_events import _ProactorBasePipeTransport

from core.voice_manager import voices_dropdown
from ui.windows_tab import build as build_windows
from ui.cloning_tab import build as build_cloning
from ui.my_voices_tab import build as build_my_voices

# Suppress harmless Windows asyncio "connection forcibly closed" noise.
_orig = _ProactorBasePipeTransport._call_connection_lost
def _silent(self, exc):
    try:
        _orig(self, exc)
    except ConnectionResetError:
        pass
_ProactorBasePipeTransport._call_connection_lost = _silent

_css = """
.tab-nav button { font-size: 15px; padding: 10px 20px; }
footer { display: none !important; }
"""

with gr.Blocks(title="TTS — Синтез речи", theme=gr.themes.Soft(), css=_css) as app:
    gr.Markdown("# Синтез речи и клонирование голоса")
    with gr.Tabs():
        build_windows()
        build_cloning()
        sv_voice = build_my_voices()

    # Обновляем список голосов при каждом открытии страницы
    app.load(fn=voices_dropdown, outputs=[sv_voice])

if __name__ == "__main__":
    app.launch(inbrowser=True)
