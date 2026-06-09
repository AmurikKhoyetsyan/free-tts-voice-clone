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
    dt = time.strftime('%Y-%m-%d_%H-%M-%S')
    path = os.path.join(tempfile.gettempdir(), f"audio-{dt}.wav")
    sf.write(path, data, sr)
    return path
