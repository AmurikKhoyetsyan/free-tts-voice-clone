import time
import tempfile
import os
import traceback
from core.audio import wav_to_numpy, save_named_audio

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


_status_cache = None

def check_status():
    global _status_cache
    if _status_cache is not None:
        return _status_cache
    try:
        from TTS.api import TTS
        import torch
        cuda = torch.cuda.is_available()
        device_name = torch.cuda.get_device_name(0) if cuda else "CPU"
        _status_cache = f"XTTS v2 установлен | Устройство: {device_name}"
    except ImportError:
        _status_cache = "XTTS v2 не установлен. Запусти install_xtts.bat и перезапусти приложение."
    return _status_cache


def _emit(progress, value, desc):
    if progress is not None:
        try:
            progress(value, desc=desc)
        except Exception:
            pass
    print(f"[{time.strftime('%H:%M:%S')}] [{int(value * 100):3d}%] {desc}", flush=True)


def synthesize(text, speaker_audio, language_label, progress=None):
    start_time = time.time()
    _emit(progress, 0.0, "Подготовка")

    if not text or not text.strip():
        return None, "❌ Введите текст для синтеза"
    if speaker_audio is None:
        return None, "❌ Загрузите аудио образец голоса (10–30 сек)"

    _emit(progress, 0.05, "Загрузка модели XTTS v2")
    tts, err = _get_model()
    if tts is None:
        msg = f"❌ Модель не загружена: {err}"
        print(f"[ERROR] {msg}", flush=True)
        return None, msg

    lang = LANGUAGES.get(language_label, "ru")
    word_count = len(text.split())
    print(
        f"[{time.strftime('%H:%M:%S')}] Клонирование | язык: {lang} | слов: {word_count}",
        flush=True,
    )

    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()

    try:
        _emit(progress, 0.15, f"Анализ образца голоса (язык: {lang})")
        _emit(progress, 0.25, f"Синтез речи ({word_count} слов)")
        tts.tts_to_file(
            text=text, speaker_wav=speaker_audio, language=lang, file_path=tmp.name
        )
        _emit(progress, 0.85, "Аудио сгенерировано")
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[ERROR] Ошибка синтеза XTTS:\n{tb}", flush=True)
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        return None, f"❌ Ошибка синтеза: {e}"

    if os.path.getsize(tmp.name) == 0:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        return None, "❌ Ошибка: пустой файл результата"

    _emit(progress, 0.92, "Сохранение файла")
    out = save_named_audio(*wav_to_numpy(tmp.name))
    try:
        os.unlink(tmp.name)
    except OSError:
        pass

    elapsed = time.time() - start_time
    _emit(progress, 1.0, f"Готово за {elapsed:.1f}с")
    print(f"[{time.strftime('%H:%M:%S')}] Готово | время: {elapsed:.2f}с", flush=True)
    return out, f"✓ Готово — голос клонирован ({elapsed:.1f}с)"
