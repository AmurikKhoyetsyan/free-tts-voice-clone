import os
import datetime
import threading

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(BASE_DIR, ".logs")
os.makedirs(LOGS_DIR, exist_ok=True)

_lock = threading.Lock()


def _log_path() -> str:
    return os.path.join(LOGS_DIR, datetime.datetime.now().strftime("%Y-%m-%d") + ".log")


def app_log(msg: str, level: str = "INFO", source: str = "App") -> None:
    ts   = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lvl  = level.upper()
    line = f"[{ts}] [{lvl}] [{source}]\n{msg}\n"
    print(line, flush=True)
    with _lock:
        try:
            with open(_log_path(), "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass


def print_progress(pct: int, prefix: str = "") -> None:
    """Print an ASCII progress bar to terminal (overwrites current line)."""
    pct   = max(0, min(100, pct))
    filled = int(40 * pct / 100)
    bar   = "█" * filled + "░" * (40 - filled)
    label = f"{prefix} " if prefix else ""
    print(f"\r{label}[{bar}] {pct}%", end="", flush=True)
    if pct >= 100:
        print(flush=True)


# ── Backward-compat aliases ───────────────────────────────────────────────────

def write_log(line: str, level: str = "") -> None:
    lvl = level.upper() if level else "INFO"
    if lvl not in ("INFO", "WARNING", "WARN", "ERROR", "ERR"):
        lvl = "INFO"
    app_log(line, lvl, "App")


def server_log(msg: str, level: str = "INFO") -> None:
    app_log(msg, level, "Server")
