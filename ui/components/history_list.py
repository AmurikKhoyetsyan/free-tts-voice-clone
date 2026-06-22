import html as _html

import gradio as gr

from core.history_manager import list_files
from ui.icons import PLAY, EDIT, DOWNLOAD, DELETE


def render_list():
    files = list_files()
    if not files:
        return "<div class='tts-hist-empty'>Нет аудиозаписей</div>"
    rows = []
    for name in files:
        safe = _html.escape(name, quote=True)
        rows.append(
            f'<div class="tts-hist-row" data-file="{safe}">'
            f'<span class="tts-hist-name" title="{safe}">{_html.escape(name)}</span>'
            f'<div class="tts-hist-btns">'
            f'<button class="tts-hist-btn"              data-action="play"     title="Воспроизвести">{PLAY}</button>'
            f'<button class="tts-hist-btn"              data-action="rename"   title="Переименовать">{EDIT}</button>'
            f'<button class="tts-hist-btn tts-hist-dl-btn"  data-action="download" title="Скачать">{DOWNLOAD}</button>'
            f'<button class="tts-hist-btn tts-hist-del-btn" data-action="delete"   title="Удалить">{DELETE}</button>'
            f'</div>'
            f'</div>'
        )
    return "<div class='tts-hist-list'>" + "".join(rows) + "</div>"


def build():
    """
    Build the history file list UI component.

    Returns:
        (file_list_html, hidden_play_btn, hidden_delete_btn, hidden_rename_btn,
         delete_done, rename_done, log_out, hist_file_box)
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
