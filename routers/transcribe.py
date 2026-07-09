import os, json, threading, queue, tempfile, subprocess, shutil, warnings
warnings.filterwarnings("ignore", message=".*flash attention.*", category=UserWarning)
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from core.log import app_log

router = APIRouter(prefix="/api/transcribe", tags=["transcribe"])
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO_IN  = os.path.join(BASE_DIR, ".outputs", "video", "src")
TEMP_DIR  = os.path.join(BASE_DIR, ".outputs", "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

FFMPEG = shutil.which("ffmpeg") or os.path.join(BASE_DIR, "ffmpeg", "ffmpeg.exe")

try:
    import whisper as _whisper_module
    _WHISPER_AVAILABLE = True
    _WHISPER_ERR = ""
except ImportError as _e:
    _whisper_module = None
    _WHISPER_AVAILABLE = False
    _WHISPER_ERR = str(_e)

_whisper_model = None
_whisper_lock  = threading.Lock()


def _get_model(model_name="base"):
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            app_log(f"Loading Whisper model: {model_name}", "INFO", "Whisper")
            _whisper_model = _whisper_module.load_model(model_name)
            app_log(f"Whisper model loaded: {model_name}", "INFO", "Whisper")
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
            if not _WHISPER_AVAILABLE:
                app_log(f"Whisper unavailable: {_WHISPER_ERR}", "ERROR", "Whisper")
                q.put(("error", f"Whisper недоступен: {_WHISPER_ERR}"))
                return
            app_log(f"Whisper transcription started. Language: {language}", "INFO", "Whisper")
            q.put(("progress", 0.15, "Загрузка модели Whisper…"))
            model = _get_model()
            q.put(("progress", 0.35, "Распознавание речи…"))
            result = model.transcribe(audio_path, language=language or None)
            q.put(("progress", 0.95, "Формирование субтитров…"))
            srt = _segments_to_srt(result["segments"])
            if cleanup and os.path.exists(audio_path):
                os.remove(audio_path)
            app_log(f"Whisper transcription completed. Segments: {len(result['segments'])}", "INFO", "Whisper")
            q.put(("done", srt))
        except Exception as e:
            app_log(f"Whisper transcription error: {e}", "ERROR", "Whisper")
            q.put(("error", str(e)))

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        yield f"event: progress\ndata: {json.dumps({'value': 0.05, 'desc': 'Подготовка…'})}\n\n"
        while True:
            item = q.get()
            if item[0] == "progress":
                yield f"event: progress\ndata: {json.dumps({'value': item[1], 'desc': item[2]})}\n\n"
            elif item[0] == "done":
                yield f"event: done\ndata: {json.dumps({'srt': item[1]})}\n\n"
                break
            else:
                yield f"event: error\ndata: {json.dumps({'status': '❌ ' + item[1]})}\n\n"
                break

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/audio")
async def transcribe_audio(file: UploadFile = File(...), language: str = Form("ru")):
    app_log(f"Transcribe audio request. File: {file.filename}, language: {language}", "INFO", "Whisper")
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    tmp = os.path.join(TEMP_DIR, f"tr_audio{suffix}")
    with open(tmp, "wb") as f:
        f.write(await file.read())
    return _stream_transcribe(tmp, language)


@router.post("/video")
async def transcribe_video(video_name: str = Form(...), language: str = Form("ru")):
    app_log(f"Transcribe video request. Video: {video_name}, language: {language}", "INFO", "Whisper")
    src = os.path.join(VIDEO_IN, os.path.basename(video_name))
    if not os.path.exists(src):
        raise HTTPException(400, "Видео не найдено")
    tmp_wav = os.path.join(TEMP_DIR, "tr_video.wav")
    _CN = 0x08000000 if os.name == "nt" else 0
    q2 = queue.Queue()

    def prep():
        try:
            cmd = [FFMPEG, "-y", "-i", src, "-vn", "-acodec", "pcm_s16le",
                   "-ar", "16000", "-ac", "1", tmp_wav]
            r = subprocess.run(cmd, capture_output=True,
                               creationflags=_CN if os.name == "nt" else 0, timeout=300)
            q2.put(None if r.returncode == 0 else r.stderr.decode("utf-8", "replace")[:200])
        except Exception as e:
            q2.put(str(e))

    threading.Thread(target=prep, daemon=True).start()
    err = q2.get(timeout=320)
    if err:
        app_log(f"FFmpeg audio extraction failed: {err}", "ERROR", "FFmpeg")
        raise HTTPException(500, f"Ошибка извлечения аудио: {err}")
    return _stream_transcribe(tmp_wav, language)
