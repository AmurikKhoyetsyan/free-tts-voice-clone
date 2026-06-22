import json

import gradio as gr

import core.history_manager as hm
from ui.components.history_list import render_list


def build():
    """
    Build the rename modal.

    Returns:
        (modal, rename_input, pending, save_btn, cancel_btn)
    """
    with gr.Column(visible=False, elem_classes=["tts-modal-overlay"]) as modal:
        with gr.Column(elem_classes=["tts-modal-box"]):
            gr.Markdown("### Переименовать аудио")
            rename_input = gr.Textbox(label="Новое имя", placeholder="Введите новое имя...")
            with gr.Row():
                save_btn   = gr.Button("Сохранить", variant="primary")
                cancel_btn = gr.Button("Отмена")
    pending = gr.State(None)
    return modal, rename_input, pending, save_btn, cancel_btn


def wire(modal, rename_input, pending, save_btn, cancel_btn,
         trigger_btn, file_box, hist_js,
         file_list_html, audio_out, log_out, rename_done):
    """Wire all event handlers for the rename modal."""

    def _open(val):
        filename = (val or "").strip()
        if not filename:
            return gr.update(), gr.update(), None
        stem = filename[:-4] if filename.endswith(".wav") else filename
        return gr.update(visible=True), gr.update(value=stem), filename

    def _do(filename, new_name):
        audio_path, status, signal = hm.rename_file(filename, new_name)
        if signal:
            _, renamed = json.loads(signal)
            gr.Info(f"Переименовано: {filename} → {renamed}")
        elif status.startswith("❌"):
            gr.Warning(status[2:].strip())
        return render_list(), audio_path, status, signal

    trigger_btn.click(
        fn=_open,
        inputs=[file_box],
        outputs=[modal, rename_input, pending],
        js=hist_js,
        show_progress="hidden",
    )
    cancel_btn.click(fn=lambda: gr.update(visible=False), outputs=[modal], show_progress="hidden")
    save_btn.click(
        fn=_do,
        inputs=[pending, rename_input],
        outputs=[file_list_html, audio_out, log_out, rename_done],
    ).then(fn=lambda: gr.update(visible=False), outputs=[modal], show_progress="hidden")
