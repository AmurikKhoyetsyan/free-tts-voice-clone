import { ICONS }        from './icons.js';
import { audioManager } from './audio-manager.js';
import { WaveRenderer } from './wave-renderer.js';

const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export class AudioPlayer {
    constructor(host) {
        this.host     = host;
        this.url      = null;
        this.filename = null;
        this._audio   = null;
        this._wave    = null;
        this._raf     = null;
        this._cbs     = {};
        this._renderEmpty();
        this._unsubscribe = audioManager.subscribe(active => {
            if (active !== this && this._audio && !this._audio.paused) this.pause();
        });
    }

    // ── public API ───────────────────────────────────────────────────────────

    on(event, cb) {
        if (!this._cbs[event]) this._cbs[event] = [];
        this._cbs[event].push(cb);
        return this;
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

    // ── internals ────────────────────────────────────────────────────────────

    _emit(event) {
        (this._cbs[event] || []).forEach(cb => { try { cb(); } catch (_) {} });
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
        wave.load(url);

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
