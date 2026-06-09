import gradio as gr
from core.tts_xtts import synthesize, check_status, LANGUAGES
from core.voice_manager import save_voice


def build():
    with gr.Tab("Клонирование голоса (XTTS v2)"):
        gr.Textbox(value=check_status(), label="Статус XTTS", interactive=False)
        gr.Markdown("Загрузи **10–30 секунд** чистой записи голоса (без музыки, без шума).")
        with gr.Row():
            with gr.Column(scale=3):
                text     = gr.Textbox(label="Текст", placeholder="Введите текст на выбранном языке...", lines=5)
                audio_in = gr.Audio(label="Образец голоса", type="filepath", sources=["upload", "microphone"])
                with gr.Row():
                    save_name = gr.Textbox(label="Сохранить голос как", placeholder="Имя голоса...", scale=3)
                    save_btn  = gr.Button("Сохранить", scale=1)
                lang = gr.Dropdown(choices=list(LANGUAGES.keys()), value="Русский", label="Язык текста")
                btn  = gr.Button("Клонировать и синтезировать", variant="primary", size="lg")
            with gr.Column(scale=2):
                audio_out = gr.Audio(label="Результат")
                status    = gr.Textbox(label="Статус", interactive=False)

        save_btn.click(fn=save_voice, inputs=[audio_in, save_name], outputs=[status, gr.State()])
        btn.click(fn=synthesize, inputs=[text, audio_in, lang], outputs=[audio_out, status])
