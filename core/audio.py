import os
import time
import soundfile as sf

OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ".output_audio",
)
os.makedirs(OUTPUT_DIR, exist_ok=True)


def wav_to_numpy(path):
    data, sr = sf.read(path, dtype='int16')
    if data.ndim > 1:
        data = data[:, 0]
    return sr, data


def save_named_audio(sr, data):
    dt = time.strftime('%Y-%m-%d_%H-%M-%S')
    path = os.path.join(OUTPUT_DIR, f"audio-{dt}.wav")
    sf.write(path, data, sr)
    return path
