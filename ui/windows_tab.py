import gradio as gr
from core.tts_windows import synthesize as _core_synthesize, WIN_VOICE_NAMES, WIN_DEFAULT
from ui.progress_stream import stream

_STOP_ALL_JS = (
    "(...args) => { "
    "if (window.__ttsAudio) window.__ttsAudio.stop(); "
    "else document.querySelectorAll('audio').forEach(a => { try { a.pause(); a.currentTime = 0; } catch(_) {} }); "
    "return args; }"
)


def _synthesize(text, voice, rate, vol, progress=gr.Progress()):
    print(f"[windows_tab] _synthesize CALLED text_len={len(text or '')} voice={voice!r}", flush=True)
    if not voice:
        msg = "❌ Выберите голос из списка"
        gr.Warning(msg)
        progress(1.0, desc=msg)
        yield None, msg
        return
    if not text or not text.strip():
        msg = "❌ Введите текст для синтеза"
        gr.Warning(msg)
        progress(1.0, desc=msg)
        yield None, msg
        return
    yield from stream(_core_synthesize, (text, voice, rate, vol), progress)


def build():
    with gr.Tab("Windows голоса"):
        gr.Markdown(f"Офлайн голоса Windows. Доступно: **{len(WIN_VOICE_NAMES)}**")
        with gr.Row():
            with gr.Column(scale=3):
                text  = gr.Textbox(label="Текст", placeholder="Введите текст...", lines=5)
                voice = gr.Dropdown(choices=WIN_VOICE_NAMES, value=WIN_DEFAULT, label="Голос")
                with gr.Row():
                    rate = gr.Slider(50, 350, value=150, step=10, label="Скорость")
                    vol  = gr.Slider(0, 100, value=90, step=5, label="Громкость (%)")
                btn = gr.Button("Синтезировать", variant="primary", size="lg")
            with gr.Column(scale=2):
                audio  = gr.Audio(label="Результат")
                status = gr.Textbox(label="Статус", interactive=False)

        btn.click(fn=_synthesize, inputs=[text, voice, rate, vol], outputs=[audio, status], js=_STOP_ALL_JS)
