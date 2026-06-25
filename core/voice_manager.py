import json
import os
import shutil

VOICES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "saved_voices")
os.makedirs(VOICES_DIR, exist_ok=True)


def get_saved_voices():
    files = sorted(f for f in os.listdir(VOICES_DIR) if f.endswith('.wav'))
    return [os.path.splitext(f)[0] for f in files]


def save_voice(audio_path, name):
    if not name or not name.strip():
        return False, "Введите имя голоса"
    if audio_path is None or not os.path.exists(audio_path):
        return False, "Сначала загрузите или запишите аудио образец"
    safe = name.strip().replace(" ", "_")
    shutil.copy2(audio_path, os.path.join(VOICES_DIR, f"{safe}.wav"))
    return True, f"Голос «{safe}» сохранён"


def load_voice(name):
    if not name:
        return None
    path = os.path.join(VOICES_DIR, f"{name}.wav")
    return path if os.path.exists(path) else None


def delete_voice(name):
    if not name:
        return False, "Выберите голос для удаления"
    path = os.path.join(VOICES_DIR, f"{name}.wav")
    if os.path.exists(path):
        os.remove(path)
        return True, f"Голос «{name}» удалён"
    return False, "Файл не найден"


def rename_voice(old_name, new_name):
    if not old_name:
        return False, "Выберите голос"
    if not new_name or not new_name.strip():
        return False, "Введите новое имя"
    safe = new_name.strip().replace(" ", "_")
    old_path = os.path.join(VOICES_DIR, f"{old_name}.wav")
    new_path = os.path.join(VOICES_DIR, f"{safe}.wav")
    if not os.path.exists(old_path):
        return False, "Файл не найден"
    if os.path.exists(new_path) and old_path != new_path:
        return False, f"Голос «{safe}» уже существует"
    os.rename(old_path, new_path)
    return True, safe


def voices_urls_json():
    voices = get_saved_voices()
    paths = {
        v: os.path.join(VOICES_DIR, f"{v}.wav").replace(os.sep, "/")
        for v in voices
    }
    return json.dumps(paths)
