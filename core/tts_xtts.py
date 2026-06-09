import time
import tempfile
import os
import threading
from .audio import wav_to_numpy, save_named_audio

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

_tts_model = None


def _get_model():
    global _tts_model
    if _tts_model is None:
        try:
            import torch
            import functools

            _orig_load = torch.load

            @functools.wraps(_orig_load)
            def _patched_load(*args, **kwargs):
                kwargs.setdefault('weights_only', False)
                return _orig_load(*args, **kwargs)

            torch.load = _patched_load

            from TTS.tts.models.xtts import Xtts
            _orig_ckpt = Xtts.load_checkpoint

            def _patched_ckpt(self, config, **kwargs):
                kwargs['strict'] = False
                return _orig_ckpt(self, config, **kwargs)

            Xtts.load_checkpoint = _patched_ckpt

            from TTS.api import TTS
            device = "cuda" if torch.cuda.is_available() else "cpu"
            _tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

            torch.load = _orig_load
            Xtts.load_checkpoint = _orig_ckpt
        except Exception as e:
            return None, str(e)
    return _tts_model, None


def check_status():
    try:
        from TTS.api import TTS
        import torch
        cuda = torch.cuda.is_available()
        device_name = torch.cuda.get_device_name(0) if cuda else "CPU"
        return f"XTTS v2 установлен | Устройство: {device_name}"
    except ImportError:
        return "XTTS v2 не установлен. Запусти install_xtts.bat и перезапусти приложение."


def synthesize(text, speaker_audio, language_label):
    if not text or not text.strip():
        return None, "Введите текст"
    if speaker_audio is None:
        return None, "Загрузите аудио образец голоса (10–30 сек)"

    tts, err = _get_model()
    if tts is None:
        return None, f"Модель не загружена: {err}"

    lang = LANGUAGES.get(language_label, "ru")
    start_time = time.time()
    print(f"\n[{time.strftime('%H:%M:%S')}] Клонирование | язык: {lang} | слов: {len(text.split())}", flush=True)

    done = [False]
    frames = ['-', '\\', '|', '/']

    def _spinner():
        i = 0
        while not done[0]:
            elapsed = time.time() - start_time
            print(f'\r  [{frames[i % 4]}]   ?%  {elapsed:.1f}s', end='', flush=True)
            i += 1
            time.sleep(0.15)

    t = threading.Thread(target=_spinner, daemon=True)
    t.start()

    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()

    try:
        tts.tts_to_file(text=text, speaker_wav=speaker_audio, language=lang, file_path=tmp.name)
    except Exception as e:
        done[0] = True
        t.join(timeout=1)
        print(flush=True)
        return None, f"Ошибка: {e}"

    done[0] = True
    t.join(timeout=1)
    elapsed = time.time() - start_time
    print(f'\r  [{"#" * 40}] 100%  {elapsed:.1f}s', flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] Готово | время: {elapsed:.2f}с", flush=True)

    if os.path.getsize(tmp.name) == 0:
        return None, "Ошибка: пустой файл"

    out = save_named_audio(*wav_to_numpy(tmp.name))
    os.unlink(tmp.name)
    return out, "Готово — голос клонирован"
