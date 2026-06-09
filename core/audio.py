import os
import time
import tempfile
import soundfile as sf


def wav_to_numpy(path):
    data, sr = sf.read(path, dtype='int16')
    if data.ndim > 1:
        data = data[:, 0]
    return sr, data


def save_named_audio(sr, data):
    date_str = time.strftime('%Y-%m-%d')
    path = os.path.join(tempfile.gettempdir(), f"audio-{date_str}.wav")
    sf.write(path, data, sr)
    return path
