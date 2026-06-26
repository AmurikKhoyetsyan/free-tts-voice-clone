from fastapi import APIRouter
from services import tts_xtts

router = APIRouter(prefix="/api/xtts", tags=["xtts"])


@router.get("/status")
async def xtts_status():
    return {"status": tts_xtts.check_status(), "languages": tts_xtts.LANGUAGES}
