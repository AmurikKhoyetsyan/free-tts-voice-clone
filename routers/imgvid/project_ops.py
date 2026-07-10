import io, json, os, uuid, zipfile, datetime
from fastapi import HTTPException

# Set by image_video.py after import
IMAGES_DIR = ""
CLIPS_DIR  = ""
AUDIO_DIR  = ""
THUMBS_DIR = ""
PROJECTS_DIR = ""


def _make_project_buf(project: dict) -> io.BytesIO:
    files_to_pack = []
    for slide in project.get("slides", []):
        fn = slide.get("file") or slide.get("image", "")
        if fn:
            for d in (IMAGES_DIR, CLIPS_DIR):
                fp = os.path.join(d, fn)
                if os.path.exists(fp):
                    sub = "clips" if d == CLIPS_DIR else "images"
                    files_to_pack.append((f"media/{sub}/{fn}", fp))
                    break
        thumb_url = slide.get("thumbUrl", "")
        if thumb_url:
            tname = thumb_url.split("/")[-1]
            tp = os.path.join(THUMBS_DIR, tname)
            if os.path.exists(tp):
                files_to_pack.append((f"media/thumbs/{tname}", tp))
    for track in project.get("audio", []):
        fn = track.get("file", "")
        if fn:
            fp = os.path.join(AUDIO_DIR, fn)
            if os.path.exists(fp):
                files_to_pack.append((f"media/audio/{fn}", fp))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("project.json", json.dumps(project, ensure_ascii=False, indent=2))
        for arc_name, file_path in files_to_pack:
            zf.write(file_path, arc_name)
    buf.seek(0)
    return buf


def _extract_project_zip(zf: zipfile.ZipFile) -> dict:
    names = zf.namelist()
    if "project.json" not in names:
        raise HTTPException(400, "Неверный .project: project.json не найден")
    project = json.loads(zf.read("project.json").decode("utf-8"))
    for arc_name in names:
        if arc_name == "project.json":
            continue
        fname = os.path.basename(arc_name)
        if not fname:
            continue
        data = zf.read(arc_name)
        if arc_name.startswith("media/images/"):
            file_dest = os.path.join(IMAGES_DIR, fname)
        elif arc_name.startswith("media/clips/"):
            file_dest = os.path.join(CLIPS_DIR, fname)
        elif arc_name.startswith("media/audio/"):
            file_dest = os.path.join(AUDIO_DIR, fname)
        elif arc_name.startswith("media/thumbs/"):
            file_dest = os.path.join(THUMBS_DIR, fname)
        else:
            continue
        with open(file_dest, 'wb') as fh:
            fh.write(data)
    return project


def _finalize_project(project: dict) -> dict:
    pid = project.get("id") or uuid.uuid4().hex
    project["id"] = pid
    project["updated_at"] = datetime.datetime.now().isoformat()
    ppath = os.path.join(PROJECTS_DIR, f"{pid}.json")
    with open(ppath, "w", encoding="utf-8") as fh:
        json.dump(project, fh, ensure_ascii=False, indent=2)
    return project
