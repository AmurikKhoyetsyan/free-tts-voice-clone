import os, json, threading, queue, tempfile, subprocess, shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from core.log import write_log

router = APIRouter(prefix="/api/transcribe", tags=["transcribe"])
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO_IN  = os.path.join(BASE_DIR, ".output", "video", "src")
TEMP_DIR  = os.path.join(BASE_DIR, ".output", "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

FFMPEG = shutil.which("ffmpeg") or os.path.join(BASE_DIR, "ffmpeg", "ffmpeg.exe")

_whisper_model = None
_whisper_lock  = threading.Lock()

def _get_model(model_name="base"):
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            import whisper
            _whisper_model = whisper.load_model(model_name)
    return _whisper_model

def _segments_to_srt(segments):
    lines = []
    for i, seg in enumerate(segments, 1):
        def fmt(t):
            h = int(t // 3600); m = int((t % 3600) // 60)
            s = int(t % 60); ms = int(round((t % 1) * 1000))
            return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
        lines += [str(i), f"{fmt(seg['start'])} --> {fmt(seg['end'])}", seg['text'].strip(), ""]
    return "\n".join(lines)

def _stream_transcribe(audio_path, language, cleanup=True):
    q = queue.Queue()
    def worker():
        try:
            q.put(("progress", 0.15, "Загрузка модели Whisper…"))
            model = _get_model()
            q.put(("progress", 0.35, "Распознавание речи…"))
            result = model.transcribe(audio_path, language=language or None)
            q.put(("progress", 0.95, "Формирование субтитров…"))
            srt = _segments_to_srt(result["segments"])
            if cleanup and os.path.exists(audio_path): os.remove(audio_path)
            q.put(("done", srt))
        except ImportError:
            q.put(("error", "Whisper не установлен. Выполните: pip install openai-whisper"))
        except Exception as e:
            q.put(("error", str(e)))
    threading.Thread(target=worker, daemon=True).start()
    def stream():
        yield f"event: progress\ndata: {json.dumps({'value': 0.05, 'desc': 'Подготовка…'})}\n\n"
        while True:
            item = q.get()
            if item[0] == "progress":
                yield f"event: progress\ndata: {json.dumps({'value': item[1], 'desc': item[2]})}\n\n"
            elif item[0] == "done":
                yield f"event: done\ndata: {json.dumps({'srt': item[1]})}\n\n"; break
            else:
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + item[1]})}\n\n"; break
    return StreamingResponse(stream(), media_type="text/event-stream")

@router.post("/audio")
async def transcribe_audio(file: UploadFile = File(...), language: str = Form("ru")):
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    tmp = os.path.join(TEMP_DIR, f"tr_audio{suffix}")
    with open(tmp, "wb") as f: f.write(await file.read())
    return _stream_transcribe(tmp, language)

@router.post("/video")
async def transcribe_video(video_name: str = Form(...), language: str = Form("ru")):
    src = os.path.join(VIDEO_IN, os.path.basename(video_name))
    if not os.path.exists(src): raise HTTPException(400, "Видео не найдено")
    tmp_wav = os.path.join(TEMP_DIR, "tr_video.wav")
    _CN = 0x08000000 if os.name == "nt" else 0
    q2 = queue.Queue()
    def prep():
        try:
            cmd = [FFMPEG, "-y", "-i", src, "-vn", "-acodec", "pcm_s16le",
                   "-ar", "16000", "-ac", "1", tmp_wav]
            r = subprocess.run(cmd, capture_output=True,
                               creationflags=_CN if os.name == "nt" else 0, timeout=300)
            q2.put(None if r.returncode == 0 else r.stderr.decode("utf-8","replace")[:200])
        except Exception as e: q2.put(str(e))
    threading.Thread(target=prep, daemon=True).start()
    err = q2.get(timeout=320)
    if err: raise HTTPException(500, f"Ошибка извлечения аудио: {err}")
    return _stream_transcribe(tmp_wav, language)
