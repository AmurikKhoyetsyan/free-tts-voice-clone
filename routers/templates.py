import os, json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/templates", tags=["templates"])
BASE_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMPL_DIR  = os.path.join(BASE_DIR, ".output", "templates")
os.makedirs(TMPL_DIR, exist_ok=True)

class SaveTemplateBody(BaseModel):
    name: str
    settings: dict

class RenameTemplateBody(BaseModel):
    new_name: str

def _path(name): return os.path.join(TMPL_DIR, os.path.basename(name) + ".json")

@router.get("")
def list_templates():
    names = sorted(f[:-5] for f in os.listdir(TMPL_DIR) if f.endswith(".json"))
    return {"templates": names}

@router.post("")
def save_template(body: SaveTemplateBody):
    name = body.name.strip()
    if not name: raise HTTPException(400, "Пустое имя")
    with open(_path(name), "w", encoding="utf-8") as f:
        json.dump(body.settings, f, ensure_ascii=False, indent=2)
    return {"status": f"Шаблон сохранён: {name}", "name": name}

@router.get("/{name}")
def get_template(name: str):
    p = _path(name)
    if not os.path.exists(p): raise HTTPException(404, "Шаблон не найден")
    with open(p, encoding="utf-8") as f: return {"name": name, "settings": json.load(f)}

@router.delete("/{name}")
def delete_template(name: str):
    p = _path(name)
    if not os.path.exists(p): raise HTTPException(404, "Шаблон не найден")
    os.remove(p); return {"status": f"Удалён: {name}"}

@router.put("/{name}")
def rename_template(name: str, body: RenameTemplateBody):
    old = _path(name)
    if not os.path.exists(old): raise HTTPException(404, "Шаблон не найден")
    new_name = body.new_name.strip()
    if not new_name: raise HTTPException(400, "Пустое имя")
    new = _path(new_name)
    if os.path.exists(new) and old != new: raise HTTPException(400, f"Занято: {new_name}")
    os.rename(old, new); return {"status": f"Переименован: {name} → {new_name}", "name": new_name}
