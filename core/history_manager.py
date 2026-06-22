import html as _html
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


def render_list():
    files = list_files()
    if not files:
        return "<div class='tts-hist-empty'>Нет аудиозаписей</div>"
    rows = []
    for name in files:
        safe = _html.escape(name, quote=True)
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


def load_audio(filename):
    if not filename:
        return None
    path = os.path.join(OUTPUT_DIR, filename)
    return path if os.path.exists(path) else None


def delete_file(filename):
    """Returns (html_list, status, signal) — signal is filename if deleted, else ''."""
    if not filename:
        return render_list(), "", ""
    path = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
        return render_list(), f"✓ Удалено: {filename}", filename
    return render_list(), f"❌ Файл не найден: {filename}", ""


def rename_file(filename, new_name):
    """Returns (html_list, audio_path, status, signal) — signal is JSON [old, new] if renamed."""
    if not filename:
        return render_list(), None, "", ""
    new_name = (new_name or "").strip()
    if not new_name:
        return render_list(), None, "❌ Пустое имя", ""
    if not new_name.lower().endswith(".wav"):
        new_name += ".wav"
    old_path = os.path.join(OUTPUT_DIR, filename)
    new_path = os.path.join(OUTPUT_DIR, new_name)
    if not os.path.exists(old_path):
        return render_list(), None, f"❌ Файл не найден: {filename}", ""
    if os.path.exists(new_path) and old_path != new_path:
        return render_list(), None, f"❌ Имя занято: {new_name}", ""
    os.rename(old_path, new_path)
    audio_path = new_path if os.path.exists(new_path) else None
    signal = json.dumps([filename, new_name])
    return render_list(), audio_path, f"✓ {filename} → {new_name}", signal
