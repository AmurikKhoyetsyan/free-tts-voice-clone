import gradio as gr

from core.history_manager import render_list


def build():
    """
    Build the history file list UI component.

    Returns:
        (file_list_html, hidden_play_btn, hidden_delete_btn, hidden_rename_btn,
         delete_done, rename_done, log_out, hist_file_box)

    Must be called inside a gr.Blocks context.
    """
    file_list_html    = gr.HTML(value=render_list(), elem_id="tts_hist_list")
    hidden_play_btn   = gr.Button("", elem_id="tts_hist_play_btn",   elem_classes=["tts-js-trigger"])
    hidden_delete_btn = gr.Button("", elem_id="tts_hist_delete_btn", elem_classes=["tts-js-trigger"])
    hidden_rename_btn = gr.Button("", elem_id="tts_hist_rename_btn", elem_classes=["tts-js-trigger"])
    delete_done       = gr.Textbox(elem_classes=["tts-js-trigger", "js-hist-delete-done"])
    rename_done       = gr.Textbox(elem_classes=["tts-js-trigger", "js-hist-rename-done"])
    log_out           = gr.Textbox(elem_classes=["tts-js-trigger", "js-hist-log"])
    hist_file_box     = gr.Textbox(value="", elem_id="hist_file_box", elem_classes=["tts-js-trigger"])
    return (
        file_list_html,
        hidden_play_btn, hidden_delete_btn, hidden_rename_btn,
        delete_done, rename_done, log_out,
        hist_file_box,
    )
