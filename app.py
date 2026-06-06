import gradio as gr
import pyttsx3
import tempfile
import os
import numpy as np
import soundfile as sf

# ── Windows voices (pyttsx3) ────────────────────────────────────────────────

def _load_win_voices():
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    result = {v.name: v.id for v in voices}
    try:
        engine.stop()
    except Exception:
        pass
    return result

WIN_VOICES = _load_win_voices()

def _sort_key(name):
    return (0, name) if any(x in name.lower() for x in ('russian', 'irina', 'pavel', 'ru-ru')) else (1, name)

WIN_VOICE_NAMES = sorted(WIN_VOICES.keys(), key=_sort_key)
WIN_DEFAULT = next((n for n in WIN_VOICE_NAMES if 'irina' in n.lower()), WIN_VOICE_NAMES[0] if WIN_VOICE_NAMES else None)


def _wav_to_numpy(path):
    data, sr = sf.read(path, dtype='float32')
    if data.ndim > 1:
        data = data[:, 0]
    return sr, data


def win_synthesize(text, voice_name, rate, volume):
    if not text or not text.strip():
        return None, "Введите текст"
    engine = pyttsx3.init()
    engine.setProperty('voice', WIN_VOICES[voice_name])
    engine.setProperty('rate', int(rate))
    engine.setProperty('volume', volume / 100.0)
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    engine.save_to_file(text, tmp.name)
    engine.runAndWait()
    if not os.path.exists(tmp.name) or os.path.getsize(tmp.name) == 0:
        return None, "Ошибка синтеза"
    audio = _wav_to_numpy(tmp.name)
    os.unlink(tmp.name)
    return audio, f"Готово — {voice_name}"


# ── Voice cloning (XTTS v2) ─────────────────────────────────────────────────

_tts_model = None

def _get_tts():
    global _tts_model
    if _tts_model is None:
        try:
            import torch
            import functools

            # PyTorch 2.6 changed weights_only default to True, which breaks TTS model loading.
            # Patch torch.load to keep weights_only=False for trusted local models.
            _original_torch_load = torch.load
            @functools.wraps(_original_torch_load)
            def _patched_load(*args, **kwargs):
                kwargs.setdefault('weights_only', False)
                return _original_torch_load(*args, **kwargs)
            torch.load = _patched_load

            from TTS.api import TTS
            device = "cuda" if torch.cuda.is_available() else "cpu"
            _tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

            torch.load = _original_torch_load  # restore after loading
        except Exception as e:
            return None, str(e)
    return _tts_model, None

LANGUAGES = {
    "Русский": "ru",
    "English": "en",
    "Deutsch": "de",
    "Français": "fr",
    "Español": "es",
    "Italiano": "it",
    "Polski": "pl",
    "Українська": "uk",
}

def clone_synthesize(text, speaker_audio, language_label):
    if not text or not text.strip():
        return None, "Введите текст"
    if speaker_audio is None:
        return None, "Загрузите аудио образец голоса (10–30 сек)"

    tts, err = _get_tts()
    if tts is None:
        return None, f"Модель не загружена: {err}"

    lang = LANGUAGES.get(language_label, "ru")
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()

    try:
        tts.tts_to_file(
            text=text,
            speaker_wav=speaker_audio,
            language=lang,
            file_path=tmp.name,
        )
    except Exception as e:
        return None, f"Ошибка: {e}"

    if os.path.getsize(tmp.name) == 0:
        return None, "Ошибка: пустой файл"

    audio = _wav_to_numpy(tmp.name)
    os.unlink(tmp.name)
    return audio, "Готово — голос клонирован"


def check_xtts_status():
    try:
        from TTS.api import TTS
        import torch
        cuda = torch.cuda.is_available()
        device_name = torch.cuda.get_device_name(0) if cuda else "CPU"
        return f"XTTS v2 установлен | Устройство: {device_name}"
    except ImportError:
        return "XTTS v2 не установлен. Запусти install_xtts.bat и перезапусти приложение."


# ── UI ───────────────────────────────────────────────────────────────────────

with gr.Blocks(title="TTS — Синтез речи") as app:
    gr.Markdown("# Синтез речи и клонирование голоса")

    with gr.Tabs():

        with gr.Tab("Windows голоса"):
            gr.Markdown(f"Офлайн голоса Windows. Доступно: **{len(WIN_VOICE_NAMES)}**")
            with gr.Row():
                with gr.Column(scale=3):
                    w_text  = gr.Textbox(label="Текст", placeholder="Введите текст...", lines=5)
                    w_voice = gr.Dropdown(choices=WIN_VOICE_NAMES, value=WIN_DEFAULT, label="Голос")
                    with gr.Row():
                        w_rate = gr.Slider(50, 350, value=150, step=10, label="Скорость")
                        w_vol  = gr.Slider(0, 100, value=90, step=5, label="Громкость (%)")
                    w_btn = gr.Button("Синтезировать", variant="primary")
                with gr.Column(scale=2):
                    w_audio  = gr.Audio(label="Результат", type="numpy")
                    w_status = gr.Textbox(label="Статус", interactive=False)
            w_btn.click(fn=win_synthesize, inputs=[w_text, w_voice, w_rate, w_vol], outputs=[w_audio, w_status])

        with gr.Tab("Клонирование голоса (XTTS v2)"):
            gr.Textbox(value=check_xtts_status(), label="Статус XTTS", interactive=False)
            gr.Markdown("Загрузи **10–30 секунд** чистой записи голоса (без музыки, без шума).")
            with gr.Row():
                with gr.Column(scale=3):
                    c_text     = gr.Textbox(label="Текст", placeholder="Введите текст на выбранном языке...", lines=5)
                    c_audio_in = gr.Audio(label="Образец голоса", type="filepath", sources=["upload", "microphone"])
                    c_lang     = gr.Dropdown(choices=list(LANGUAGES.keys()), value="Русский", label="Язык текста")
                    c_btn      = gr.Button("Клонировать и синтезировать", variant="primary")
                with gr.Column(scale=2):
                    c_audio_out = gr.Audio(label="Результат", type="numpy")
                    c_status    = gr.Textbox(label="Статус", interactive=False)
            c_btn.click(fn=clone_synthesize, inputs=[c_text, c_audio_in, c_lang], outputs=[c_audio_out, c_status])

if __name__ == "__main__":
    app.launch(inbrowser=True, theme=gr.themes.Soft())
