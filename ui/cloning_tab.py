import gradio as gr
from core.tts_xtts import synthesize as _core_synthesize, check_status, LANGUAGES
from core.voice_manager import save_voice
from ui.progress_stream import stream

_STOP_ALL_JS = (
    "(...args) => { "
    "if (window.__ttsAudio) window.__ttsAudio.stop(); "
    "else document.querySelectorAll('audio').forEach(a => { try { a.pause(); a.currentTime = 0; } catch(_) {} }); "
    "return args; }"
)


def _synthesize(text, audio_in, lang, progress=gr.Progress()):
    print(f"[cloning_tab] _synthesize CALLED text_len={len(text or '')} audio={audio_in!r}", flush=True)
    if audio_in is None:
        msg = "❌ Загрузите аудио образец голоса (10–30 сек)"
        gr.Warning(msg)
        progress(1.0, desc=msg)
        yield None, msg
        return
    if not text or not text.strip():
        msg = "❌ Введите текст для синтеза"
        gr.Warning(msg)
        progress(1.0, desc=msg)
        yield None, msg
        return
    yield from stream(_core_synthesize, (text, audio_in, lang), progress)


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
                status    = gr.Textbox(label="Статус", interactive=False, elem_classes=["js-status-poll"])

        save_btn.click(fn=save_voice, inputs=[audio_in, save_name], outputs=[status, gr.State()])
        btn.click(fn=_synthesize, inputs=[text, audio_in, lang], outputs=[audio_out, status], js=_STOP_ALL_JS)
