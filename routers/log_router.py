import datetime
from fastapi import APIRouter
from pydantic import BaseModel
from core.log import write_log

router = APIRouter(prefix="/api", tags=["log"])


class LogBody(BaseModel):
    msg:   str = ""
    level: str = ""


@router.post("/log")
async def receive_log(body: LogBody):
    ts  = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    tag = f"UI:{body.level}" if body.level else "UI"
    line = f"[{ts}] [{tag}] {body.msg}"
    print(line, flush=True)
    write_log(line)
    return {"ok": True}
