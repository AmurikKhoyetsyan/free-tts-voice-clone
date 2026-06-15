import time
import tempfile
import os
import traceback
import pyttsx3
from .audio import wav_to_numpy, save_named_audio


def _load_voices():
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    result = {v.name: v.id for v in voices}
    try:
        engine.stop()
    except Exception:
        pass
    return result


def _sort_key(name):
    return (0, name) if any(x in name.lower() for x in ('russian', 'irina', 'pavel', 'ru-ru')) else (1, name)


WIN_VOICES = _load_voices()
WIN_VOICE_NAMES = sorted(WIN_VOICES.keys(), key=_sort_key)
WIN_DEFAULT = next(
    (n for n in WIN_VOICE_NAMES if 'irina' in n.lower()),
    WIN_VOICE_NAMES[0] if WIN_VOICE_NAMES else None,
)


def _emit(progress, value, desc):
    """Отправить прогресс в UI (gr.Progress) и в stdout."""
    if progress is not None:
        try:
            progress(value, desc=desc)
        except Exception:
            pass
    print(f"[{time.strftime('%H:%M:%S')}] [{int(value * 100):3d}%] {desc}", flush=True)


def synthesize(text, voice_name, rate, volume, progress=None):
    start_time = time.time()
    _emit(progress, 0.0, "Подготовка")

    if not text or not text.strip():
        return None, "❌ Введите текст для синтеза"
    if not voice_name or voice_name not in WIN_VOICES:
        return None, "❌ Выберите голос из списка"

    words = text.split()
    word_count = max(len(words), 1)
    counter = [0]

    print(
        f"[{time.strftime('%H:%M:%S')}] Синтез начат | голос: {voice_name} | слов: {word_count}",
        flush=True,
    )

    _emit(progress, 0.05, "Инициализация движка SAPI5")
    try:
        engine = pyttsx3.init()
        engine.setProperty('voice', WIN_VOICES[voice_name])
        engine.setProperty('rate', int(rate))
        engine.setProperty('volume', volume / 100.0)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[ERROR] Не удалось инициализировать движок:\n{tb}", flush=True)
        return None, f"❌ Не удалось инициализировать движок: {e}"

    def on_word(name, location, length):
        counter[0] += 1
        cur = min(counter[0], word_count)
        pct = 0.10 + 0.75 * (cur / word_count)  # от 10% до 85%
        _emit(progress, pct, f"Синтез слова {cur}/{word_count}")

    engine.connect('started-word', on_word)

    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()

    _emit(progress, 0.10, f"Синтез речи ({word_count} слов)")
    try:
        engine.save_to_file(text, tmp.name)
        engine.runAndWait()
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[ERROR] Ошибка синтеза Windows TTS:\n{tb}", flush=True)
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        return None, f"❌ Ошибка синтеза: {e}"

    if not os.path.exists(tmp.name) or os.path.getsize(tmp.name) == 0:
        return None, "❌ Ошибка синтеза: пустой файл результата"

    _emit(progress, 0.92, "Сохранение файла")
    out = save_named_audio(*wav_to_numpy(tmp.name))
    try:
        os.unlink(tmp.name)
    except OSError:
        pass

    elapsed = time.time() - start_time
    _emit(progress, 1.0, f"Готово за {elapsed:.1f}с")
    print(
        f"[{time.strftime('%H:%M:%S')}] Готово | время: {elapsed:.2f}с", flush=True
    )
    return out, f"✓ Готово — {voice_name} ({elapsed:.1f}с)"
