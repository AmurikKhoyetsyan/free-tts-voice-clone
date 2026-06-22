import gradio as gr

import core.history_manager as hm


def build():
    """
    Build the delete confirmation modal.

    Returns:
        (modal, text, pending, yes_btn, no_btn)

    Must be called inside a gr.Blocks context.
    """
    with gr.Column(visible=False, elem_classes=["tts-modal-overlay"]) as modal:
        with gr.Column(elem_classes=["tts-modal-box"]):
            gr.Markdown("### Удалить аудио")
            text = gr.Markdown("")
            with gr.Row():
                yes_btn = gr.Button("Удалить", variant="stop")
                no_btn  = gr.Button("Отмена")
    pending = gr.State(None)
    return modal, text, pending, yes_btn, no_btn


def wire(modal, text, pending, yes_btn, no_btn,
         trigger_btn, file_box, hist_js,
         file_list_html, audio_out, log_out, delete_done):
    """Wire all event handlers for the delete modal."""

    def _open(val):
        filename = (val or "").strip()
        if not filename:
            return gr.update(), gr.update(), None
        return (
            gr.update(visible=True),
            gr.update(value=f"Вы уверены, что хотите удалить **{filename}**?"),
            filename,
        )

    def _do(filename):
        html_list, status, signal = hm.delete_file(filename)
        if signal:
            gr.Info(f"Удалено: {filename}")
        else:
            gr.Warning(status)
        return html_list, None, status, signal

    trigger_btn.click(
        fn=_open,
        inputs=[file_box],
        outputs=[modal, text, pending],
        js=hist_js,
        show_progress="hidden",
    )
    no_btn.click(fn=lambda: gr.update(visible=False), outputs=[modal], show_progress="hidden")
    yes_btn.click(
        fn=_do,
        inputs=[pending],
        outputs=[file_list_html, audio_out, log_out, delete_done],
    ).then(fn=lambda: gr.update(visible=False), outputs=[modal], show_progress="hidden")
