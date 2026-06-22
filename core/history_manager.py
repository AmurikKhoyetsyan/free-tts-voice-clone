import json
import os

from core.audio import OUTPUT_DIR


def list_files():
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


def load_audio(filename):
    if not filename:
        return None
    path = os.path.join(OUTPUT_DIR, filename)
    return path if os.path.exists(path) else None


def delete_file(filename):
    """Returns (status, signal) — signal is filename if deleted, else ''."""
    if not filename:
        return "", ""
    path = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
        return f"✓ Удалено: {filename}", filename
    return f"❌ Файл не найден: {filename}", ""


def rename_file(filename, new_name):
    """Returns (audio_path, status, signal) — signal is JSON [old, new] if renamed."""
    if not filename:
        return None, "", ""
    new_name = (new_name or "").strip()
    if not new_name:
        return None, "❌ Пустое имя", ""
    if not new_name.lower().endswith(".wav"):
        new_name += ".wav"
    old_path = os.path.join(OUTPUT_DIR, filename)
    new_path = os.path.join(OUTPUT_DIR, new_name)
    if not os.path.exists(old_path):
        return None, f"❌ Файл не найден: {filename}", ""
    if os.path.exists(new_path) and old_path != new_path:
        return None, f"❌ Имя занято: {new_name}", ""
    os.rename(old_path, new_path)
    audio_path = new_path if os.path.exists(new_path) else None
    signal = json.dumps([filename, new_name])
    return audio_path, f"✓ {filename} → {new_name}", signal
