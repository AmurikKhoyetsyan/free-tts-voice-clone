import gradio as gr

from core.history_manager import load_audio
from ui.components.history_list import build as build_history_list, render_list
from ui.modals.delete_modal import build as build_delete_modal, wire as wire_delete_modal
from ui.modals.rename_modal import build as build_rename_modal, wire as wire_rename_modal

# JS snippet: reads the filename set by the event-delegation click handler in global.js
_HIST_JS = "(...args) => { const f = window.__ttsHistFile || ''; if (window.voiceLog) window.voiceLog('[hist-js] file=' + f); return [f]; }"


def build():
    with gr.Tab("История") as tab:
        with gr.Row():
            with gr.Column(scale=3):
                (file_list_html,
                 hidden_play_btn, hidden_delete_btn, hidden_rename_btn,
                 delete_done, rename_done, log_out,
                 hist_file_box) = build_history_list()

            with gr.Column(scale=2):
                audio_out = gr.Audio(
                    label="Воспроизведение",
                    interactive=False,
                    elem_classes=["js-audio-loader"],
                )

        del_modal, del_text, del_pending, del_yes_btn, del_no_btn = build_delete_modal()
        ren_modal, ren_input, ren_pending, ren_save_btn, ren_cancel_btn = build_rename_modal()

        def _handle_play(val):
            filename = (val or "").strip()
            if not filename:
                return gr.update()
            return load_audio(filename)

        hidden_play_btn.click(
            fn=_handle_play,
            inputs=[hist_file_box],
            outputs=[audio_out],
            js=_HIST_JS,
            show_progress="hidden",
        )

        wire_delete_modal(
            del_modal, del_text, del_pending, del_yes_btn, del_no_btn,
            hidden_delete_btn, hist_file_box, _HIST_JS,
            file_list_html, audio_out, log_out, delete_done,
        )
        wire_rename_modal(
            ren_modal, ren_input, ren_pending, ren_save_btn, ren_cancel_btn,
            hidden_rename_btn, hist_file_box, _HIST_JS,
            file_list_html, audio_out, log_out, rename_done,
        )

        tab.select(fn=lambda: gr.update(value=render_list()), outputs=[file_list_html])
