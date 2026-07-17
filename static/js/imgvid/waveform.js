// Waveform rendering — extracted from image-video.js

const _waveCache = new Map();
const _WAVE_RES  = 4000;

export async function probeAudioDuration(url) {
    try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ac  = new (window.AudioContext || window.webkitAudioContext)();
        const dec = await ac.decodeAudioData(buf);
        ac.close();
        return dec.duration;
    } catch { return 0; }
}

export async function drawWaveform(canvas, url, trimIn = 0, visibleDuration = null) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    let cached = _waveCache.get(url);
    if (!cached) {
        try {
            const buf = await (await fetch(url)).arrayBuffer();
            const ac  = new (window.AudioContext || window.webkitAudioContext)();
            const dec = await ac.decodeAudioData(buf);
            ac.close();
            const data  = dec.getChannelData(0);
            const totalDuration = dec.duration;
            const block = Math.max(1, Math.floor(data.length / _WAVE_RES));
            const hiPeaks = new Float32Array(_WAVE_RES);
            for (let i = 0; i < _WAVE_RES; i++) {
                let mx = 0;
                for (let j = 0; j < block; j++) mx = Math.max(mx, Math.abs(data[i * block + j] || 0));
                hiPeaks[i] = mx;
            }
            cached = { hiPeaks, totalDuration };
            _waveCache.set(url, cached);
        } catch { return; }
    }

    const { hiPeaks, totalDuration } = cached;
    const safeTotal  = totalDuration || 1;
    const safeTrim   = Math.min(trimIn || 0, safeTotal);
    const safeVisDur = (visibleDuration !== null && visibleDuration > 0)
        ? Math.min(visibleDuration, safeTotal - safeTrim)
        : (safeTotal - safeTrim);

    const startFrac = safeTrim / safeTotal;
    const endFrac   = (safeTrim + safeVisDur) / safeTotal;

    ctx.fillStyle = 'rgba(74,158,255,0.08)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(74,158,255,0.75)';
    ctx.lineWidth = 1;
    const mid = h / 2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
        const frac = startFrac + (x / (w - 1 || 1)) * (endFrac - startFrac);
        const fi  = frac * (_WAVE_RES - 1);
        const lo  = Math.floor(fi), hi2 = Math.min(lo + 1, _WAVE_RES - 1);
        const t   = fi - lo;
        const amp = ((hiPeaks[lo] || 0) * (1 - t) + (hiPeaks[hi2] || 0) * t) * mid * 0.88;
        ctx.moveTo(x + 0.5, mid - amp);
        ctx.lineTo(x + 0.5, mid + amp);
    }
    ctx.stroke();
}
