import time
import tempfile
import os
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


def _progress_bar(current, total, start_time, width=40):
    pct = int(current / total * 100) if total > 0 else 100
    filled = int(width * current / total) if total > 0 else width
    bar = '#' * filled + '-' * (width - filled)
    elapsed = time.time() - start_time
    print(f'\r  [{bar}] {pct:3d}%  {elapsed:.1f}s', end='', flush=True)
    if current >= total:
        print(flush=True)


def synthesize(text, voice_name, rate, volume):
    if not text or not text.strip():
        return None, "Введите текст"

    words = text.split()
    word_count = max(len(words), 1)
    progress = [0]
    start_time = time.time()

    print(f"\n[{time.strftime('%H:%M:%S')}] Синтез начат | голос: {voice_name} | слов: {word_count}", flush=True)
    _progress_bar(0, word_count, start_time)

    def on_word(name, location, length):
        progress[0] += 1
        _progress_bar(min(progress[0], word_count), word_count, start_time)

    engine = pyttsx3.init()
    engine.setProperty('voice', WIN_VOICES[voice_name])
    engine.setProperty('rate', int(rate))
    engine.setProperty('volume', volume / 100.0)
    engine.connect('started-word', on_word)

    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    engine.save_to_file(text, tmp.name)
    engine.runAndWait()

    _progress_bar(word_count, word_count, start_time)
    elapsed = time.time() - start_time
    print(f"[{time.strftime('%H:%M:%S')}] Готово | время: {elapsed:.2f}с", flush=True)

    if not os.path.exists(tmp.name) or os.path.getsize(tmp.name) == 0:
        return None, "Ошибка синтеза"

    out = save_named_audio(*wav_to_numpy(tmp.name))
    os.unlink(tmp.name)
    return out, f"Готово — {voice_name}"
