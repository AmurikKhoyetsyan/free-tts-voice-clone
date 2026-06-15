import gradio as gr
from asyncio.proactor_events import _ProactorBasePipeTransport

from core.voice_manager import voices_dropdown, VOICES_DIR
from ui.windows_tab import build as build_windows
from ui.cloning_tab import build as build_cloning
from ui.my_voices_tab import (
    build as build_my_voices,
    INJECT_OPTIONS_PLAY_JS,
    _voice_urls_json,
)

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

# Только один audio играет одновременно + стоп при смене вкладки.
_global_js = """
() => {
    if (window.__ttsAudioMutex) return;
    window.__ttsAudioMutex = true;

    document.addEventListener('play', (e) => {
        const t = e.target;
        if (!t || t.tagName !== 'AUDIO') return;
        document.querySelectorAll('audio').forEach(a => {
            if (a !== t && !a.paused) a.pause();
        });
    }, true);

    const wireTabs = () => {
        document.querySelectorAll('.tab-nav button').forEach(b => {
            if (b.__ttsWired) return;
            b.__ttsWired = true;
            b.addEventListener('click', () => {
                document.querySelectorAll('audio').forEach(a => a.pause());
            });
        });
    };
    wireTabs();
    new MutationObserver(wireTabs).observe(document.body, { childList: true, subtree: true });
}
"""

with gr.Blocks(title="TTS — Синтез речи", theme=gr.themes.Soft(), css=_css, js=_global_js) as app:
    gr.Markdown("# Синтез речи и клонирование голоса")
    with gr.Tabs():
        build_windows()
        build_cloning()
        sv_voice, sv_urls = build_my_voices()

    # Обновляем список голосов и URL-карту при каждом открытии страницы
    app.load(fn=voices_dropdown, outputs=[sv_voice])
    app.load(fn=_voice_urls_json, outputs=[sv_urls])
    # Инжектим ▶ в опции дропдауна голосов (один раз, ставит MutationObserver)
    app.load(fn=None, inputs=None, outputs=None, js=INJECT_OPTIONS_PLAY_JS)

if __name__ == "__main__":
    app.launch(inbrowser=True, allowed_paths=[VOICES_DIR])
