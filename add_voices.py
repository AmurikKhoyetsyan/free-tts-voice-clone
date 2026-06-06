"""
Добавляет голоса Windows OneCore в SAPI, чтобы pyttsx3 их видел.
Запускать один раз от имени администратора.
"""
import winreg
import sys
import ctypes

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False

def copy_key_tree(src, dst):
    i = 0
    while True:
        try:
            name, data, dtype = winreg.EnumValue(src, i)
            winreg.SetValueEx(dst, name, 0, dtype, data)
            i += 1
        except OSError:
            break
    i = 0
    while True:
        try:
            sub_name = winreg.EnumKey(src, i)
            s = winreg.OpenKey(src, sub_name)
            d = winreg.CreateKey(dst, sub_name)
            copy_key_tree(s, d)
            i += 1
        except OSError:
            break

def main():
    if not is_admin():
        print("Нужны права администратора. Запусти от имени администратора.")
        input("Нажми Enter для выхода...")
        sys.exit(1)

    ONECORE = r'SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens'
    SAPI    = r'SOFTWARE\Microsoft\Speech\Voices\Tokens'
    SAPI32  = r'SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens'

    try:
        oc = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, ONECORE)
    except Exception as e:
        print(f"OneCore голоса не найдены: {e}")
        input("Enter для выхода...")
        return

    added = 0
    for sapi_path in [SAPI, SAPI32]:
        try:
            sapi_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, sapi_path, 0, winreg.KEY_ALL_ACCESS)
        except Exception:
            continue

        existing = set()
        i = 0
        while True:
            try:
                existing.add(winreg.EnumKey(sapi_key, i))
                i += 1
            except OSError:
                break

        i = 0
        while True:
            try:
                name = winreg.EnumKey(oc, i)
                if name not in existing:
                    src = winreg.OpenKey(oc, name)
                    # Получить отображаемое имя
                    try:
                        label, _ = winreg.QueryValueEx(src, '')
                    except Exception:
                        label = name
                    dst = winreg.CreateKey(sapi_key, name)
                    copy_key_tree(src, dst)
                    print(f"  Добавлен: {label}")
                    added += 1
                i += 1
            except OSError:
                break

    if added:
        print(f"\nГотово! Добавлено {added} голосов.")
        print("Перезапусти app.py — новые голоса появятся в списке.")
    else:
        print("Все голоса уже добавлены.")

    input("\nНажми Enter для выхода...")

if __name__ == "__main__":
    main()
