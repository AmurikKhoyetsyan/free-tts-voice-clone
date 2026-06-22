import json
import os
import shutil
import gradio as gr

VOICES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "saved_voices")
os.makedirs(VOICES_DIR, exist_ok=True)


def get_saved_voices():
    files = sorted(f for f in os.listdir(VOICES_DIR) if f.endswith('.wav'))
    return [os.path.splitext(f)[0] for f in files]


def voices_dropdown(**kwargs):
    return gr.Dropdown(choices=get_saved_voices(), **kwargs)


def save_voice(audio_path, name):
    if not name or not name.strip():
        return "Введите имя голоса", voices_dropdown()
    if audio_path is None:
        return "Сначала загрузите или запишите аудио образец", voices_dropdown()
    safe = name.strip().replace(" ", "_")
    shutil.copy2(audio_path, os.path.join(VOICES_DIR, f"{safe}.wav"))
    return f"Голос «{safe}» сохранён", voices_dropdown(value=safe)


def load_voice(name):
    if not name:
        return None
    path = os.path.join(VOICES_DIR, f"{name}.wav")
    return path if os.path.exists(path) else None


def delete_voice(name):
    if not name:
        return "Выберите голос для удаления", voices_dropdown()
    path = os.path.join(VOICES_DIR, f"{name}.wav")
    if os.path.exists(path):
        os.remove(path)
        return f"Голос «{name}» удалён", voices_dropdown(value=None)
    return "Файл не найден", voices_dropdown()


def rename_voice(old_name, new_name):
    if not old_name:
        return "Выберите голос", voices_dropdown()
    if not new_name or not new_name.strip():
        return "Введите новое имя", voices_dropdown(value=old_name)
    safe = new_name.strip().replace(" ", "_")
    old_path = os.path.join(VOICES_DIR, f"{old_name}.wav")
    new_path = os.path.join(VOICES_DIR, f"{safe}.wav")
    if not os.path.exists(old_path):
        return "Файл не найден", voices_dropdown()
    if os.path.exists(new_path):
        return f"Голос «{safe}» уже существует", voices_dropdown(value=old_name)
    os.rename(old_path, new_path)
    return f"Переименован в «{safe}»", voices_dropdown(value=safe)


def voices_urls_json():
    voices = get_saved_voices()
    paths = {
        v: os.path.join(VOICES_DIR, f"{v}.wav").replace(os.sep, "/")
        for v in voices
    }
    return json.dumps(paths)
