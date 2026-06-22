import html as _html
import json
import os
import gradio as gr
from core.audio import OUTPUT_DIR

# js= snippet: reads the file name set by the event-delegation click handler
_HIST_JS = "(...args) => { const f = window.__ttsHistFile || ''; if (window.voiceLog) window.voiceLog('[hist-js] file=' + f); return [f]; }"


def _list_files():
    if not os.path.exists(OUTPUT_DIR):
        return []
    files = []
    for name in os.listdir(OUTPUT_DIR):
        if name.lower().endswith('.wav'):
            path = os.path.join(OUTPUT_DIR, name)
            try:
                files.append((name, os.path.getmtime(path)))
            except OSError:
                pass
    files.sort(key=lambda x: x[1], reverse=True)
    return [f[0] for f in files]


def _render_list():
    files = _list_files()
    if not files:
        return "<div class='tts-hist-empty'>Нет аудиозаписей</div>"
    rows = []
    for name in files:
        safe = _html.escape(name, quote=True)
        # data-action instead of onclick — Gradio strips onclick via DOMPurify
        rows.append(
            f'<div class="tts-hist-row" data-file="{safe}">'
            f'<span class="tts-hist-name" title="{safe}">{_html.escape(name)}</span>'
            f'<div class="tts-hist-btns">'
            f'<button class="tts-hist-btn" data-action="play"   title="Воспроизвести">▶</button>'
            f'<button class="tts-hist-btn" data-action="rename" title="Переименовать">✏</button>'
            f'<button class="tts-hist-btn tts-hist-del-btn" data-action="delete" title="Удалить">🗑</button>'
            f'</div>'
            f'</div>'
        )
    return "<div class='tts-hist-list'>" + "".join(rows) + "</div>"


def _load_audio(filename):
    if not filename:
        return None
    path = os.path.join(OUTPUT_DIR, filename)
    return path if os.path.exists(path) else None


def build():
    with gr.Tab("История") as tab:
        with gr.Row():
            with gr.Column(scale=3):
                file_list_html = gr.HTML(value=_render_list(), elem_id="tts_hist_list", sanitize_html=False)
                # Hidden Gradio buttons — JS clicks these to trigger Python handlers.
                # Must stay visible (via CSS trick) so the DOM elements exist.
                hidden_play_btn   = gr.Button("", elem_id="tts_hist_play_btn",   elem_classes=["tts-js-trigger"])
                hidden_delete_btn = gr.Button("", elem_id="tts_hist_delete_btn", elem_classes=["tts-js-trigger"])
                hidden_rename_btn = gr.Button("", elem_id="tts_hist_rename_btn", elem_classes=["tts-js-trigger"])
                # Python→JS result signals for direct DOM patching
                delete_done = gr.Textbox(elem_classes=["tts-js-trigger", "js-hist-delete-done"])
                rename_done = gr.Textbox(elem_classes=["tts-js-trigger", "js-hist-rename-done"])
                log_out     = gr.Textbox(elem_classes=["tts-js-trigger", "js-hist-log"])
                pending_delete = gr.State(None)
                pending_rename = gr.State(None)
                hist_file_box = gr.Textbox(value="", elem_id="hist_file_box", elem_classes=["tts-js-trigger"])

            with gr.Column(scale=2):
                audio_out = gr.Audio(
                    label="Воспроизведение",
                    interactive=False,
                    elem_classes=["js-audio-loader"],
                )

        # ── Delete confirmation modal ──────────────────────────────────────
        with gr.Column(visible=False, elem_classes=["tts-modal-overlay"]) as delete_modal:
            with gr.Column(elem_classes=["tts-modal-box"]):
                gr.Markdown("### Удалить аудио")
                del_text = gr.Markdown("")
                with gr.Row():
                    del_yes_btn = gr.Button("Удалить", variant="stop")
                    del_no_btn  = gr.Button("Отмена")

        # ── Rename modal ───────────────────────────────────────────────────
        with gr.Column(visible=False, elem_classes=["tts-modal-overlay"]) as rename_modal:
            with gr.Column(elem_classes=["tts-modal-box"]):
                gr.Markdown("### Переименовать аудио")
                rename_input = gr.Textbox(label="Новое имя", placeholder="Введите новое имя...")
                with gr.Row():
                    rename_save_btn   = gr.Button("Сохранить", variant="primary")
                    rename_cancel_btn = gr.Button("Отмена")

        # ── Play ───────────────────────────────────────────────────────────
        def _handle_play(val):
            print(f"[hist] _handle_play val={val!r}", flush=True)
            filename = (val or "").strip()
            if not filename:
                return gr.update()
            return _load_audio(filename)

        hidden_play_btn.click(fn=_handle_play, inputs=[hist_file_box], outputs=[audio_out], js=_HIST_JS)

        # ── Delete flow ────────────────────────────────────────────────────
        def _open_delete(val):
            print(f"[hist] _open_delete val={val!r}", flush=True)
            filename = (val or "").strip()
            if not filename:
                return gr.update(), gr.update(), None
            return (
                gr.update(visible=True),
                gr.update(value=f"Вы уверены, что хотите удалить **{filename}**?"),
                filename,
            )

        hidden_delete_btn.click(
            fn=_open_delete, inputs=[hist_file_box], outputs=[delete_modal, del_text, pending_delete], js=_HIST_JS,
            show_progress="hidden",
        )

        del_no_btn.click(fn=lambda: gr.update(visible=False), outputs=[delete_modal], show_progress="hidden")

        def _do_delete(filename):
            if not filename:
                return _render_list(), None, "", ""
            path = os.path.join(OUTPUT_DIR, filename)
            if os.path.exists(path):
                os.remove(path)
                gr.Info(f"Удалено: {filename}")
                return _render_list(), None, f"✓ Удалено: {filename}", filename
            gr.Warning(f"Файл не найден: {filename}")
            return _render_list(), None, f"❌ Файл не найден: {filename}", ""

        del_yes_btn.click(
            fn=_do_delete,
            inputs=[pending_delete],
            outputs=[file_list_html, audio_out, log_out, delete_done],
        ).then(fn=lambda: gr.update(visible=False), outputs=[delete_modal], show_progress="hidden")

        # ── Rename flow ────────────────────────────────────────────────────
        def _open_rename(val):
            filename = (val or "").strip()
            if not filename:
                return gr.update(), gr.update(), None
            stem = filename[:-4] if filename.endswith(".wav") else filename
            return gr.update(visible=True), gr.update(value=stem), filename

        hidden_rename_btn.click(
            fn=_open_rename, inputs=[hist_file_box], outputs=[rename_modal, rename_input, pending_rename], js=_HIST_JS,
            show_progress="hidden",
        )

        rename_cancel_btn.click(fn=lambda: gr.update(visible=False), outputs=[rename_modal], show_progress="hidden")

        def _do_rename(filename, new_name):
            if not filename:
                return _render_list(), None, "", ""
            new_name = (new_name or "").strip()
            if not new_name:
                gr.Warning("Введите новое имя")
                return _render_list(), None, "❌ Пустое имя", ""
            if not new_name.lower().endswith(".wav"):
                new_name += ".wav"
            old_path = os.path.join(OUTPUT_DIR, filename)
            new_path = os.path.join(OUTPUT_DIR, new_name)
            if not os.path.exists(old_path):
                gr.Warning(f"Файл не найден: {filename}")
                return _render_list(), None, f"❌ Файл не найден: {filename}", ""
            if os.path.exists(new_path) and old_path != new_path:
                gr.Warning(f"Имя уже занято: {new_name}")
                return _render_list(), None, f"❌ Имя занято: {new_name}", ""
            os.rename(old_path, new_path)
            gr.Info(f"Переименовано: {filename} → {new_name}")
            signal = json.dumps([filename, new_name])
            return _render_list(), _load_audio(new_name), f"✓ {filename} → {new_name}", signal

        rename_save_btn.click(
            fn=_do_rename,
            inputs=[pending_rename, rename_input],
            outputs=[file_list_html, audio_out, log_out, rename_done],
        ).then(fn=lambda: gr.update(visible=False), outputs=[rename_modal], show_progress="hidden")

        # Refresh list every time this tab is opened
        tab.select(fn=lambda: gr.update(value=_render_list()), outputs=[file_list_html])
