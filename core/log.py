import os
import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(BASE_DIR, ".logs")
os.makedirs(LOGS_DIR, exist_ok=True)


def _log_path() -> str:
    return os.path.join(LOGS_DIR, datetime.datetime.now().strftime("%Y-%m-%d") + ".log")


def write_log(line: str):
    try:
        with open(_log_path(), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def server_log(msg: str, level: str = "INFO"):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    print(line, flush=True)
    write_log(line)
