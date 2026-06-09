import gradio as gr
from core.tts_xtts import synthesize as xtts_synthesize, LANGUAGES
from core.voice_manager import load_voice, delete_voice, rename_voice, voices_dropdown


def _synthesize(voice_name, text, language_label):
    if not voice_name:
        return None, "Выберите голос из списка"
    audio_path = load_voice(voice_name)
    if audio_path is None:
        return None, f"Файл голоса «{voice_name}» не найден"
    return xtts_synthesize(text, audio_path, language_label)


def build():
    with gr.Tab("Мои голоса"):
        with gr.Row():
            with gr.Column(scale=3):
                voice = gr.Dropdown(choices=[], value=None, label="Выберите голос")
                with gr.Row():
                    rename_input = gr.Textbox(placeholder="Новое имя...", show_label=False, scale=3)
                    rename_btn   = gr.Button("Переименовать", scale=2)
                    refresh_btn  = gr.Button("⟳", scale=1, min_width=48)
                    del_btn      = gr.Button("🗑", variant="stop", scale=1, min_width=48)
                text = gr.Textbox(label="Текст", placeholder="Введите текст...", lines=6)
                lang = gr.Dropdown(choices=list(LANGUAGES.keys()), value="Русский", label="Язык")
                btn  = gr.Button("Синтезировать", variant="primary", size="lg")
            with gr.Column(scale=2):
                audio  = gr.Audio(label="Результат")
                status = gr.Textbox(label="Статус", interactive=False)

        refresh_btn.click(fn=voices_dropdown, outputs=[voice])
        del_btn.click(fn=delete_voice, inputs=[voice], outputs=[status, voice])
        rename_btn.click(fn=rename_voice, inputs=[voice, rename_input], outputs=[status, voice])
        btn.click(fn=_synthesize, inputs=[voice, text, lang], outputs=[audio, status])

    return voice
