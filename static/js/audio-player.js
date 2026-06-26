import { ICONS } from './icons.js';
import { audioManager } from './audio-manager.js';

const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// Canvas waveform renderer — visually identical to WaveSurfer bar mode:
// waveColor:#d1d5db, progressColor:#f97316, barWidth:2, barGap:1, barRadius:2, height:40
class WaveRenderer {
    constructor(container) {
        this.container = container;
        this.peaks = null;
        this._progress = 0;

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'width:100%;height:40px;display:block;cursor:pointer;border-radius:4px;';
        container.appendChild(this.canvas);
        this._resize();
    }

    _dpr()   { return window.devicePixelRatio || 1; }
    _cw()    { return this.canvas.width; }
    _ch()    { return this.canvas.height; }

    _resize() {
        const dpr = this._dpr();
        const w   = this.container.offsetWidth || 300;
        this.canvas.width  = Math.round(w * dpr);
        this.canvas.height = Math.round(40 * dpr);
        if (this.peaks) this._draw(this._progress);
    }

    async load(url) {
        this._resize(); // ensure canvas has correct size before decoding
        try {
            const res = await fetch(url);
            const buf = await res.arrayBuffer();
            const ac  = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await ac.decodeAudioData(buf);
            ac.close();
            this._buildPeaks(decoded);
        } catch (_) {
            // silent audio on error — just draw flat bars
            const n = Math.floor(this._cw() / (2 + 1));
            this.peaks = new Float32Array(n).fill(0.15);
        }
        this._draw(this._progress);
    }

    _buildPeaks(audioBuffer) {
        const data  = audioBuffer.getChannelData(0);
        const dpr   = this._dpr();
        const step  = Math.round((2 + 1) * dpr); // (barWidth + barGap) * dpr
        const n     = Math.floor(this._cw() / step);
        const smpPB = Math.max(1, Math.floor(data.length / n));

        this.peaks = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            let peak = 0;
            for (let j = 0; j < smpPB; j++) {
                const v = Math.abs(data[i * smpPB + j] || 0);
                if (v > peak) peak = v;
            }
            this.peaks[i] = peak;
        }
        const maxV = Math.max(...this.peaks, 0.001);
        for (let i = 0; i < n; i++) this.peaks[i] /= maxV;
    }

    setProgress(ratio) {
        this._progress = ratio;
        if (this.peaks) this._draw(ratio);
    }

    _draw(progress) {
        if (!this.peaks) return;
        const ctx     = this.canvas.getContext('2d');
        const dpr     = this._dpr();
        const width   = this._cw();
        const height  = this._ch();
        const barW    = Math.round(2 * dpr);
        const barR    = Math.round(2 * dpr);
        const step    = Math.round((2 + 1) * dpr);
        const progX   = Math.round(progress * width);

        ctx.clearRect(0, 0, width, height);

        let x = 0;
        for (let i = 0; i < this.peaks.length && x + barW <= width; i++, x += step) {
            const barH = Math.max(2, this.peaks[i] * height);
            const y    = (height - barH) / 2;
            ctx.fillStyle = x < progX ? '#f97316' : '#d1d5db';
            this._roundRect(ctx, x, y, barW, barH, barR);
            ctx.fill();
        }

        // cursor line (cursorWidth:2, cursorColor:#f97316)
        if (progX > 0 && progX < width) {
            ctx.fillStyle = '#f97316';
            ctx.fillRect(progX - Math.round(dpr), 0, Math.round(2 * dpr), height);
        }
    }

    _roundRect(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.arcTo(x + w, y,     x + w, y + rr,     rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        ctx.lineTo(x + rr, y + h);
        ctx.arcTo(x,     y + h, x,     y + h - rr, rr);
        ctx.lineTo(x,     y + rr);
        ctx.arcTo(x,     y,     x + rr, y,          rr);
        ctx.closePath();
    }

    onClick(handler) {
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            handler(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
        });
    }

    destroy() {
        this.canvas.remove();
        this.peaks = null;
    }
}

export class AudioPlayer {
    constructor(host) {
        this.host = host;
        this.url = null;
        this.filename = null;
        this._audio = null;
        this._wave  = null;
        this._raf   = null;
        this._cbs   = {};
        this._renderEmpty();
        this._unsubscribe = audioManager.subscribe(active => {
            if (active !== this && this._audio && !this._audio.paused) {
                this.pause();
            }
        });
    }

    on(event, cb) {
        if (!this._cbs[event]) this._cbs[event] = [];
        this._cbs[event].push(cb);
        return this;
    }

    _emit(event) {
        (this._cbs[event] || []).forEach(cb => { try { cb(); } catch (_) {} });
    }

    setSource(url, filename = null) {
        this._stopRaf();
        this.url      = url;
        this.filename = filename;
        if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
        if (this._wave)  { this._wave.destroy(); this._wave = null; }
        if (!url) { this._renderEmpty(); return; }
        this._renderShell(url);
    }

    setLoading(on) {
        this.host.classList.toggle('loading', !!on);
    }

    play() {
        if (!this._audio) return;
        audioManager.play(this);
        this._audio.play().catch(() => {});
    }

    pause() {
        if (this._audio) this._audio.pause();
    }

    stop() {
        if (this._audio) { this._audio.pause(); this._audio.currentTime = 0; }
        audioManager.stop(this);
    }

    destroy() {
        this._stopRaf();
        this.stop();
        if (this._audio) { this._audio.src = ''; this._audio = null; }
        if (this._wave)  { this._wave.destroy(); this._wave = null; }
        if (this._unsubscribe) this._unsubscribe();
    }

    _startRaf(audio, wave, timeEl) {
        const tick = () => {
            const dur = audio.duration;
            const cur = audio.currentTime;
            if (isFinite(dur) && dur > 0) wave.setProgress(cur / dur);
            timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
            this._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
    }

    _stopRaf() {
        if (this._raf !== null) { cancelAnimationFrame(this._raf); this._raf = null; }
    }

    _renderEmpty() {
        this.host.classList.add('empty');
        this.host.innerHTML = '<span>Здесь появится аудио</span>';
    }

    _renderShell(url) {
        this.host.classList.remove('empty');
        this.host.innerHTML = `
            <button class="ap-play" aria-label="Воспроизвести">${ICONS.play}</button>
            <div class="ap-wave"></div>
            <div class="ap-time">0:00 / 0:00</div>
            <button class="ap-download" aria-label="Скачать">${ICONS.download}</button>
        `;

        const waveEl  = this.host.querySelector('.ap-wave');
        const timeEl  = this.host.querySelector('.ap-time');
        const playBtn = this.host.querySelector('.ap-play');

        const audio = new Audio(url);
        this._audio = audio;

        const wave = new WaveRenderer(waveEl);
        this._wave = wave;
        wave.load(url); // async decode + draw

        audio.addEventListener('play', () => {
            playBtn.innerHTML = ICONS.pause;
            playBtn.setAttribute('aria-label', 'Пауза');
            this._startRaf(audio, wave, timeEl);
            this._emit('play');
        });
        audio.addEventListener('pause', () => {
            this._stopRaf();
            playBtn.innerHTML = ICONS.play;
            playBtn.setAttribute('aria-label', 'Воспроизвести');
            this._emit('pause');
        });
        audio.addEventListener('ended', () => {
            this._stopRaf();
            playBtn.innerHTML = ICONS.play;
            playBtn.setAttribute('aria-label', 'Воспроизвести');
            wave.setProgress(0);
            timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
            audioManager.stop(this);
            this._emit('ended');
        });
        audio.addEventListener('loadedmetadata', () => {
            timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
        });

        playBtn.addEventListener('click', () => {
            if (audio.paused) this.play();
            else this.pause();
        });

        wave.onClick((ratio) => {
            if (isFinite(audio.duration) && audio.duration > 0) {
                audio.currentTime = ratio * audio.duration;
                wave.setProgress(ratio);
                timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
            }
        });

        this.host.querySelector('.ap-download').addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = this.url;
            a.download = this.filename || 'audio.wav';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }
}
