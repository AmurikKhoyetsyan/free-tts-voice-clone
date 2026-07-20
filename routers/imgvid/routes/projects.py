"""Project CRUD routes for the image-video editor.

Covers listing, creating, reading, updating, patching (rename), deleting
projects, and saving a project as a template.  The ``/api/imgvid`` prefix is
set on the parent router.
"""

import os
import json
import uuid
import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from core.log import app_log

router = APIRouter()

# ── Directory constants ───────────────────────────────────────────────────────
_BASE_DIR     = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_IMGVID_DIR   = os.path.join(_BASE_DIR, ".outputs", "imgvid")
PROJECTS_DIR  = os.path.join(_IMGVID_DIR, "projects")
TEMPLATES_DIR = os.path.join(_IMGVID_DIR, "templates")

for _d in [PROJECTS_DIR, TEMPLATES_DIR]:
    os.makedirs(_d, exist_ok=True)


# ── Shared request body ───────────────────────────────────────────────────────

class ProjectBody(BaseModel):
    """Request body for project create/update endpoints."""
    id:              Optional[str] = None
    name:            str = "Без названия"
    slides:          list = []
    audio:           list = []
    subtitles:       list = []
    pip:             list = []
    trackOrder:      list = []
    export_settings: dict = {}
    is_template:     bool = False


class TemplateSaveBody(BaseModel):
    """Optional name override when saving a project as a template."""
    name: str = ""


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects():
    """Return a summary list of all non-template projects."""
    items = []
    for fn in sorted(os.listdir(PROJECTS_DIR), reverse=True):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(PROJECTS_DIR, fn), encoding="utf-8") as f:
                d = json.load(f)
            if d.get("is_template"):
                continue
            items.append({
                "id":             d.get("id", fn[:-5]),
                "name":           d.get("name", "Без названия"),
                "created_at":     d.get("created_at", ""),
                "updated_at":     d.get("updated_at", ""),
                "slide_count":    len(d.get("slides", [])),
                "total_duration": round(sum(s.get("duration", 3) for s in d.get("slides", [])), 1),
                "is_template":    False,
            })
        except Exception:
            pass
    return {"projects": items}


@router.post("/projects")
async def save_project(body: ProjectBody):
    """Create or overwrite a project JSON file.  Preserves the original ``created_at``."""
    pid = body.id or uuid.uuid4().hex
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    now = datetime.datetime.now().isoformat()
    existing_created = now
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                existing_created = json.load(f).get("created_at", now)
        except Exception:
            pass
    data = {
        "id": pid, "name": body.name,
        "created_at": existing_created, "updated_at": now,
        "slides": body.slides, "audio": body.audio,
        "subtitles": body.subtitles,
        "pip": body.pip,
        "trackOrder": body.trackOrder or ["video", "audio", "subtitle", "pip"],
        "export_settings": body.export_settings,
        "is_template": body.is_template,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    app_log(f"Project saved: {body.name}", "INFO", "ImgVid")
    return {"id": pid, "status": f"Сохранено: {body.name}"}


@router.get("/projects/{pid}")
async def get_project(pid: str):
    """Return the full project JSON for the given project id."""
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Проект не найден")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.put("/projects/{pid}")
async def update_project(pid: str, body: ProjectBody):
    """Full replacement update of a project (same logic as POST)."""
    body.id = pid
    return await save_project(body)


@router.patch("/projects/{pid}")
async def rename_project(pid: str, body: dict):
    """Rename a project without touching any other fields."""
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        raise HTTPException(404)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data["name"] = body.get("name", data["name"])
    data["updated_at"] = datetime.datetime.now().isoformat()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    app_log(f"Project renamed: {data['name']}", "INFO", "ImgVid")
    return {"id": pid, "name": data["name"]}


@router.delete("/projects/{pid}")
async def delete_project(pid: str):
    """Delete a project JSON file."""
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if os.path.exists(path):
        os.remove(path)
    app_log(f"Project deleted: {pid}", "INFO", "ImgVid")
    return {"ok": True}


@router.post("/projects/{pid}/save-as-template")
async def save_project_as_template(pid: str, body: TemplateSaveBody = TemplateSaveBody()):
    """Copy an existing project into the templates directory with ``is_template=True``."""
    src = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(src):
        raise HTTPException(404, "Проект не найден")
    with open(src, encoding="utf-8") as f:
        data = json.load(f)
    new_id = uuid.uuid4().hex
    now = datetime.datetime.now().isoformat()
    given_name = (body.name or "").strip() or (data.get("name", "Шаблон") + " (шаблон)")
    template = {
        **data,
        "id": new_id,
        "is_template": True,
        "created_at": now,
        "updated_at": now,
        "name": given_name,
    }
    tpath = os.path.join(TEMPLATES_DIR, f"{new_id}.json")
    with open(tpath, "w", encoding="utf-8") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    app_log(f"Project saved as template: {template['name']}", "INFO", "ImgVid")
    return {"id": new_id, "name": template["name"]}
