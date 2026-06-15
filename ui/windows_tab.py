import gradio as gr
from core.tts_windows import synthesize as _core_synthesize, WIN_VOICE_NAMES, WIN_DEFAULT

_STOP_ALL_JS = "(...args) => { document.querySelectorAll('audio').forEach(a => { a.pause(); }); return args; }"


def _synthesize(text, voice, rate, vol, progress=gr.Progress()):
    if not voice:
        msg = "❌ Выберите голос из списка"
        gr.Warning(msg)
        progress(1.0, desc=msg)
        return None, msg
    if not text or not text.strip():
        msg = "❌ Введите текст для синтеза"
        gr.Warning(msg)
        progress(1.0, desc=msg)
        return None, msg
    return _core_synthesize(text, voice, rate, vol, progress=progress)


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
