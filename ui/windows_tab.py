import gradio as gr
from core.tts_windows import synthesize, WIN_VOICE_NAMES, WIN_DEFAULT


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

        btn.click(fn=synthesize, inputs=[text, voice, rate, vol], outputs=[audio, status])
