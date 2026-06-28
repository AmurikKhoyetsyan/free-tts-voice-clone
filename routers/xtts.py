from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from services import tts_xtts

router = APIRouter(prefix="/api/xtts", tags=["xtts"])


@router.get("/status")
async def xtts_status():
    status = await run_in_threadpool(tts_xtts.check_status)
    return {"status": status, "languages": tts_xtts.LANGUAGES}
