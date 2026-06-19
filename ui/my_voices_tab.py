import json
import os

import gradio as gr
from services.tts_xtts import synthesize as xtts_synthesize, LANGUAGES
from core.voice_manager import (
    load_voice, delete_voice, rename_voice, voices_dropdown,
    get_saved_voices, VOICES_DIR,
)
from ui.progress_stream import stream
from ui.constants import STOP_ALL_JS, PLAY_PREVIEW_JS


def _synthesize(voice_name, text, language_label):
    print(f"[my_voices_tab] _synthesize CALLED voice={voice_name!r} text_len={len(text or '')}", flush=True)
    if not voice_name:
        msg = "❌ Выберите голос из списка"
        gr.Warning(msg)
        yield None, msg
        return
    if not text or not text.strip():
        msg = "❌ Введите текст для синтеза"
        gr.Warning(msg)
        yield None, msg
        return
    audio_path = load_voice(voice_name)
    if audio_path is None:
        msg = f"❌ Файл голоса «{voice_name}» не найден"
        gr.Warning(msg)
        yield None, msg
        return
    yield from stream(xtts_synthesize, (text, audio_path, language_label))


def _voice_urls_json():
    voices = get_saved_voices()
    paths = {
        v: os.path.join(VOICES_DIR, f"{v}.wav").replace(os.sep, "/")
        for v in voices
    }
    return json.dumps(paths)


def _on_voice_change(name):
    return (name or ""), load_voice(name)


def build():
    with gr.Tab("Мои голоса"):
        with gr.Row():
            with gr.Column(scale=3):
                voice = gr.Dropdown(choices=[], value=None, label="Выберите голос", elem_id="voice_select")
                voice_urls_data = gr.Textbox(value=_voice_urls_json(), elem_id="voice_urls_data", visible=False)
                preview = gr.Audio(type="filepath", interactive=False, show_label=False, elem_id="voice_preview_audio")
                with gr.Row():
                    rename_input = gr.Textbox(placeholder="Новое имя...", show_label=False, scale=3)
                    rename_btn   = gr.Button("Переименовать", scale=2)
                    refresh_btn  = gr.Button("⟳", scale=1, min_width=48)
                    del_btn      = gr.Button("🗑", variant="stop", scale=1, min_width=48)
                text = gr.Textbox(label="Текст", placeholder="Введите текст...", lines=6)
                lang = gr.Dropdown(choices=list(LANGUAGES.keys()), value="Русский", label="Язык")
                btn  = gr.Button("Синтезировать", variant="primary", size="lg")
            with gr.Column(scale=2):
                audio  = gr.Audio(label="Результат", elem_classes=["js-audio-loader"])
                status = gr.Textbox(label="Статус", interactive=False, elem_classes=["js-status-poll"])

        voice.change(
            fn=_on_voice_change, inputs=[voice], outputs=[rename_input, preview]
        ).then(fn=None, inputs=None, outputs=None, js=PLAY_PREVIEW_JS)
        refresh_btn.click(fn=voices_dropdown, outputs=[voice]).then(
            fn=_voice_urls_json, outputs=[voice_urls_data]
        )
        del_btn.click(fn=delete_voice, inputs=[voice], outputs=[status, voice]).then(
            fn=_voice_urls_json, outputs=[voice_urls_data]
        )
        rename_btn.click(fn=rename_voice, inputs=[voice, rename_input], outputs=[status, voice]).then(
            fn=_voice_urls_json, outputs=[voice_urls_data]
        )
        btn.click(fn=_synthesize, inputs=[voice, text, lang], outputs=[audio, status], js=STOP_ALL_JS)

    return voice, voice_urls_data
