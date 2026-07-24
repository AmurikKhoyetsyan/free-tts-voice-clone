"""Template CRUD routes for the image-video editor.

Templates are stored in ``TEMPLATES_DIR``; older templates that were saved
directly in ``PROJECTS_DIR`` with ``is_template=True`` are also supported for
backward compatibility.  The ``/api/imgvid`` prefix is set on the parent router.
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


# ── Shared request body (mirrors projects.ProjectBody) ───────────────────────

class ProjectBody(BaseModel):
    """Request body shared with the project endpoints."""
    id:              Optional[str] = None
    name:            str = "Без названия"
    slides:          list = []
    audio:           list = []
    subtitles:       list = []
    pip:             list = []
    trackOrder:      list = []
    export_settings: dict = {}
    is_template:     bool = False
    canvasCrop:      Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tmpl_path(tid: str) -> str:
    """Return the filesystem path for a template, checking TEMPLATES_DIR first.

    Falls back to PROJECTS_DIR for templates saved before the dedicated
    templates directory was introduced.
    """
    p = os.path.join(TEMPLATES_DIR, f"{tid}.json")
    if os.path.exists(p):
        return p
    p2 = os.path.join(PROJECTS_DIR, f"{tid}.json")
    if os.path.exists(p2):
        return p2
    return p  # non-existent path in new dir


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates():
    """Return a summary list of all templates from both storage locations."""
    items = []
    seen: set[str] = set()
    # New directory first so it takes precedence over legacy PROJECTS_DIR entries
    for folder in [TEMPLATES_DIR, PROJECTS_DIR]:
        for fn in sorted(os.listdir(folder), reverse=True):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(folder, fn), encoding="utf-8") as f:
                    d = json.load(f)
                if folder == PROJECTS_DIR and not d.get("is_template"):
                    continue
                tid = d.get("id", fn[:-5])
                if tid in seen:
                    continue
                seen.add(tid)
                items.append({
                    "id":             tid,
                    "name":           d.get("name", "Шаблон"),
                    "created_at":     d.get("created_at", ""),
                    "updated_at":     d.get("updated_at", ""),
                    "slide_count":    len(d.get("slides", [])),
                    "total_duration": round(sum(s.get("duration", 3) for s in d.get("slides", [])), 1),
                })
            except Exception:
                pass
    return {"templates": items}


@router.get("/templates/{tid}")
async def get_template(tid: str):
    """Return the full template JSON for the given template id."""
    path = _tmpl_path(tid)
    if not os.path.exists(path):
        raise HTTPException(404, "Шаблон не найден")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.put("/templates/{tid}")
async def update_template(tid: str, body: ProjectBody):
    """Full replacement update of a template.

    Always writes to TEMPLATES_DIR.  If an old copy exists in PROJECTS_DIR
    it is removed after the new file is written.
    """
    path = _tmpl_path(tid)
    now = datetime.datetime.now().isoformat()
    existing_created = now
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                existing_created = json.load(f).get("created_at", now)
        except Exception:
            pass
    dest = os.path.join(TEMPLATES_DIR, f"{tid}.json")
    data = {
        "id": tid, "name": body.name,
        "created_at": existing_created, "updated_at": now,
        "slides": body.slides, "audio": body.audio,
        "subtitles": body.subtitles,
        "pip": body.pip,
        "trackOrder": body.trackOrder or ["video", "audio", "subtitle", "pip"],
        "export_settings": body.export_settings,
        "is_template": True,
        "canvasCrop": body.canvasCrop,
    }
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # Remove from old PROJECTS_DIR if it was there
    old = os.path.join(PROJECTS_DIR, f"{tid}.json")
    if os.path.exists(old):
        os.remove(old)
    app_log(f"Template saved: {body.name}", "INFO", "ImgVid")
    return {"id": tid, "status": f"Шаблон сохранён: {body.name}"}


@router.delete("/templates/{tid}")
async def delete_template(tid: str):
    """Delete a template from both TEMPLATES_DIR and (legacy) PROJECTS_DIR."""
    for folder in [TEMPLATES_DIR, PROJECTS_DIR]:
        p = os.path.join(folder, f"{tid}.json")
        if os.path.exists(p):
            os.remove(p)
    app_log(f"Template deleted: {tid}", "INFO", "ImgVid")
    return {"ok": True}


@router.patch("/templates/{tid}/rename")
async def rename_template(tid: str, body: dict):
    """Rename a template.  Migrates legacy PROJECTS_DIR copies to TEMPLATES_DIR."""
    path = _tmpl_path(tid)
    if not os.path.exists(path):
        raise HTTPException(404, "Шаблон не найден")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data["name"] = body.get("name", data["name"])
    data["updated_at"] = datetime.datetime.now().isoformat()
    dest = os.path.join(TEMPLATES_DIR, f"{tid}.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # Clean up old location if different
    if path != dest and os.path.exists(path):
        os.remove(path)
    app_log(f"Template renamed: {data['name']}", "INFO", "ImgVid")
    return {"id": tid, "name": data["name"]}


@router.post("/templates/{tid}/duplicate")
async def duplicate_template(tid: str):
    """Create a copy of a template with a new UUID and ' (копия)' appended to the name."""
    path = _tmpl_path(tid)
    if not os.path.exists(path):
        raise HTTPException(404, "Шаблон не найден")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    new_id = uuid.uuid4().hex
    now = datetime.datetime.now().isoformat()
    copy = {
        **data,
        "id": new_id,
        "name": data.get("name", "Шаблон") + " (копия)",
        "created_at": now,
        "updated_at": now,
        "is_template": True,
    }
    dest = os.path.join(TEMPLATES_DIR, f"{new_id}.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(copy, f, ensure_ascii=False, indent=2)
    app_log(f"Template duplicated: {copy['name']}", "INFO", "ImgVid")
    return {"id": new_id, "name": copy["name"]}
