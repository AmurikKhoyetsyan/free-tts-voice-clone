"""Стриминг прогресса синтеза в status-поле через queue + threading.

Подход:
- Core-функция синтеза блокирующая (tts_to_file / engine.runAndWait), уносим её
  в worker-поток.
- Worker пишет события в queue.Queue (thread-safe).
- Главный поток (генератор) делает q.get() — БЛОКИРУЕТ нить до события, без
  sleep-полл-цикла. Каждое событие → yield в Gradio.
"""
import sys
import threading
import traceback
from queue import Queue


def stream(core_fn, args, progress):
    """Запускает core_fn(*args, progress=cb) в фоне и yield-ит прогресс.

    Yields:
        (None, "[NN%] описание") — каждое событие прогресса.
        (audio_path, final_status) — финальный результат.
    """
    q = Queue()
    holder = {'audio': None, 'status': '✓ Готово'}

    def _cb(value, desc=''):
        # Зовётся из worker. Только put в queue, никаких Gradio-вызовов.
        q.put(('progress', float(value), desc or ''))

    def _worker():
        print(f"[stream] worker thread started for {core_fn.__name__}", flush=True)
        try:
            audio, status = core_fn(*args, progress=_cb)
            holder['audio'] = audio
            holder['status'] = status
            print(f"[stream] worker finished OK: status={status!r}", flush=True)
        except Exception as e:
            traceback.print_exc()
            holder['status'] = f"❌ Сбой синтеза: {e}"
            print(f"[stream] worker FAILED: {e}", flush=True)
        finally:
            q.put(('done',))

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

    # Первый кадр — пока worker раскручивается.
    progress(0.0, desc="Запуск")
    yield None, "[  0%] Запуск синтеза..."

    while True:
        msg = q.get()  # блокируется до прихода события
        if msg[0] == 'done':
            break
        _, value, desc = msg
        try:
            progress(value, desc=desc)
        except Exception as e:
            print(f"[stream] progress() failed: {e}", file=sys.stderr, flush=True)
        yield None, f"[{int(value * 100):3d}%] {desc}"

    yield holder['audio'], holder['status']
