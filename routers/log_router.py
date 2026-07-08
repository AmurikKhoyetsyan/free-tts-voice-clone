import datetime
import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.log import write_log, LOGS_DIR, app_log

router = APIRouter(prefix="/api", tags=["log"])


class LogBody(BaseModel):
    msg:   str = ""
    level: str = ""


class LogUpdateBody(BaseModel):
    content: str = ""


class LogRenameBody(BaseModel):
    new_name: str = ""


def _safe_filename(name: str) -> bool:
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}\.log$', name))


def _log_file_path(name: str) -> str:
    return os.path.join(LOGS_DIR, name)


# ── Receive log from frontend ─────────────────────────────────────────────────

@router.post("/log")
async def receive_log(body: LogBody):
    ts  = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lvl = (body.level or "info").upper()
    app_log(body.msg, lvl, "UI")
    return {"ok": True}


# ── List log files ────────────────────────────────────────────────────────────

@router.get("/logs")
async def list_logs():
    try:
        files = []
        for f in sorted(os.listdir(LOGS_DIR), reverse=True):
            if not f.endswith(".log"):
                continue
            path = _log_file_path(f)
            stat = os.stat(path)
            files.append({
                "name":     f,
                "size":     stat.st_size,
                "modified": datetime.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
            })
    except Exception:
        files = []
    return {"files": files}


# ── Get log file content ──────────────────────────────────────────────────────

@router.get("/logs/{filename}")
async def get_log_file(filename: str):
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = _log_file_path(filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    with open(path, encoding="utf-8") as f:
        content = f.read()
    return {"filename": filename, "content": content}


# ── Update (edit & save) log file content ────────────────────────────────────

@router.put("/logs/{filename}")
async def update_log_file(filename: str, body: LogUpdateBody):
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = _log_file_path(filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    with open(path, "w", encoding="utf-8") as f:
        f.write(body.content)
    app_log(f"Log file edited: {filename}", "INFO", "LogManager")
    return {"status": f"Сохранено: {filename}"}


# ── Rename log file ───────────────────────────────────────────────────────────

@router.patch("/logs/{filename}")
async def rename_log_file(filename: str, body: LogRenameBody):
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    new_name = body.new_name.strip()
    if not new_name.endswith(".log"):
        new_name += ".log"
    if not _safe_filename(new_name):
        raise HTTPException(status_code=400, detail="Invalid new filename (must be YYYY-MM-DD.log)")
    old_path = _log_file_path(filename)
    new_path = _log_file_path(new_name)
    if not os.path.exists(old_path):
        raise HTTPException(status_code=404, detail="Not found")
    if os.path.exists(new_path) and old_path != new_path:
        raise HTTPException(status_code=400, detail=f"Имя занято: {new_name}")
    os.rename(old_path, new_path)
    app_log(f"Log file renamed: {filename} → {new_name}", "INFO", "LogManager")
    return {"status": f"Переименовано: {filename} → {new_name}", "new_name": new_name}


# ── Delete log file ───────────────────────────────────────────────────────────

@router.delete("/logs/{filename}")
async def delete_log_file(filename: str):
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = _log_file_path(filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    os.remove(path)
    app_log(f"Log file deleted: {filename}", "INFO", "LogManager")
    return {"status": f"Удалено: {filename}"}
