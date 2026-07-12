import { ICONS }        from './icons.js';
import { audioManager } from './audio-manager.js';
import { WaveRenderer } from './wave-renderer.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
            <div class="ap-wave-bg">
                <div class="ap-wave"></div>
                <span class="ap-hover-time" aria-hidden="true"></span>
            </div>
            <div class="ap-seekbar-wrap">
                <input type="range" class="ap-seek-bar" min="0" max="1" step="0.0001" value="0">
            </div>
            <div class="ap-timestamps">
                <span class="ap-time-cur">0:00</span>
                <span class="ap-time-dur">0:00</span>
            </div>
            <div class="ap-controls">
                <button class="ap-vol" aria-label="Громкость">${ICONS.volume}</button>
                <button class="ap-speed" aria-label="Скорость воспроизведения">1x</button>
                <div class="ap-flex-gap"></div>
                <button class="ap-skip-back" aria-label="Назад 5 сек">${ICONS.skipBack}</button>
                <button class="ap-play" aria-label="Воспроизвести">${ICONS.play}</button>
                <button class="ap-skip-fwd" aria-label="Вперёд 5 сек">${ICONS.skipFwd}</button>
                <div class="ap-flex-gap"></div>
                <button class="ap-download" aria-label="Скачать">${ICONS.download}</button>
            </div>
        `;

        const waveEl    = this.host.querySelector('.ap-wave');
        const waveBgEl  = this.host.querySelector('.ap-wave-bg');
        const hoverTime = this.host.querySelector('.ap-hover-time');
        const seekBar   = this.host.querySelector('.ap-seek-bar');
        const curEl     = this.host.querySelector('.ap-time-cur');
        const durEl     = this.host.querySelector('.ap-time-dur');
        const playBtn   = this.host.querySelector('.ap-play');
        const speedBtn  = this.host.querySelector('.ap-speed');
        const skipB     = this.host.querySelector('.ap-skip-back');
        const skipF     = this.host.querySelector('.ap-skip-fwd');

        const audio = new Audio(url);
        this._audio = audio;

        const wave = new WaveRenderer(waveEl);
        this._wave = wave;
        wave.load(url);

        // ── Seek bar fill ────────────────────────────────────────────────────
        // Uses a CSS custom property so the gradient reaches the
        // ::-webkit-slider-runnable-track pseudo-element (inline style can't).
        const _setSeekFill = (ratio) => {
            seekBar.style.setProperty('--seek-fill', (ratio * 100).toFixed(3) + '%');
        };
        _setSeekFill(0);

        // ── Unified UI sync ──────────────────────────────────────────────────
        // Called with actual currentTime + duration; updates all visual elements.
        const _syncUI = (cur, dur) => {
            const r = dur > 0 ? cur / dur : 0;
            wave.setProgress(r);
            seekBar.value = r;
            _setSeekFill(r);
            curEl.textContent = fmt(cur);
        };

        // ── RAF: smooth progress during playback ─────────────────────────────
        // Simple direct read each frame — no extrapolation, no drift.
        const _startRaf = () => {
            const tick = () => {
                const dur = audio.duration;
                const cur = audio.currentTime;
                if (isFinite(dur) && dur > 0) _syncUI(cur, dur);
                this._raf = requestAnimationFrame(tick);
            };
            this._raf = requestAnimationFrame(tick);
        };

        // ── Seek bar (range input) ───────────────────────────────────────────
        // `input` fires on every drag pixel — set currentTime immediately so
        // the RAF reads the same position and doesn't snap back.
        seekBar.addEventListener('input', () => {
            const dur = audio.duration;
            if (!isFinite(dur) || dur <= 0) return;
            const ratio = parseFloat(seekBar.value);
            audio.currentTime = ratio * dur;   // ← keep audio in sync with slider
            wave.setProgress(ratio);
            _setSeekFill(ratio);
            curEl.textContent = fmt(ratio * dur);
        });

        // ── Waveform hover ───────────────────────────────────────────────────
        wave.onHover((ratio) => {
            if (!isFinite(audio.duration) || audio.duration <= 0) return;
            hoverTime.textContent = fmt(ratio * audio.duration);
            const waveRect = waveEl.getBoundingClientRect();
            const bgRect   = waveBgEl.getBoundingClientRect();
            const xInBg    = (waveRect.left - bgRect.left) + ratio * waveRect.width;
            hoverTime.style.left = `${xInBg}px`;
            hoverTime.classList.add('visible');
        });
        wave.onLeave(() => hoverTime.classList.remove('visible'));

        // ── Waveform seek (click + drag) ─────────────────────────────────────
        wave.onSeek((ratio) => {
            const dur = audio.duration;
            if (!isFinite(dur) || dur <= 0) return;
            const t = ratio * dur;
            audio.currentTime = t;
            _syncUI(t, dur);
        });

        // ── Audio events ─────────────────────────────────────────────────────
        audio.addEventListener('loadedmetadata', () => {
            durEl.textContent = fmt(audio.duration);
        });

        audio.addEventListener('play', () => {
            playBtn.innerHTML = ICONS.pause;
            playBtn.setAttribute('aria-label', 'Пауза');
            _startRaf();
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
            seekBar.value = 0;
            _setSeekFill(0);
            curEl.textContent = '0:00';
            audioManager.stop(this);
            this._emit('ended');
        });

        // Keeps UI in sync after skip-back/forward when audio is paused
        // (RAF is stopped when paused, so timeupdate is the only update path).
        audio.addEventListener('timeupdate', () => {
            const dur = audio.duration;
            const cur = audio.currentTime;
            if (isFinite(dur) && dur > 0 && audio.paused) {
                _syncUI(cur, dur);
            }
        });

        // ── Controls ─────────────────────────────────────────────────────────
        playBtn.addEventListener('click', () => {
            if (audio.paused) this.play();
            else this.pause();
        });

        let speedIdx = 2; // default 1x
        speedBtn.addEventListener('click', () => {
            speedIdx = (speedIdx + 1) % SPEEDS.length;
            const s = SPEEDS[speedIdx];
            audio.playbackRate = s;
            speedBtn.textContent = `${s}x`;
        });

        skipB.addEventListener('click', () => {
            if (isFinite(audio.duration))
                audio.currentTime = Math.max(0, audio.currentTime - 5);
        });
        skipF.addEventListener('click', () => {
            if (isFinite(audio.duration))
                audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
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
