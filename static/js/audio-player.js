import { ICONS } from './icons.js';
import { audioManager } from './audio-manager.js';

// Custom audio player rendered into a host element with `data-player` attr.

const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export class AudioPlayer {
    constructor(host) {
        this.host = host;
        this.audio = new Audio();
        this.audio.preload = 'metadata';
        this.url = null;
        this.filename = null;
        this._renderEmpty();
        this._wireAudio();
        this._unsubscribe = audioManager.subscribe(active => {
            if (active !== this && !this.audio.paused) {
                this.pause();
            }
        });
    }

    setSource(url, filename = null) {
        this.url = url;
        this.filename = filename;
        if (!url) {
            this._renderEmpty();
            return;
        }
        this.audio.src = url;
        this._render();
    }

    setLoading(on) {
        this.host.classList.toggle('loading', !!on);
    }

    play() {
        if (!this.url) return;
        audioManager.play(this);
        this.audio.play().catch(() => {});
    }

    pause() {
        try { this.audio.pause(); } catch (_) {}
    }

    stop() {
        try {
            this.audio.pause();
            this.audio.currentTime = 0;
        } catch (_) {}
        audioManager.stop(this);
    }

    destroy() {
        this.stop();
        if (this._unsubscribe) this._unsubscribe();
    }

    _renderEmpty() {
        this.host.classList.add('empty');
        this.host.innerHTML = '<span>Здесь появится аудио</span>';
    }

    _render() {
        this.host.classList.remove('empty');
        this.host.innerHTML = `
            <button class="ap-play" aria-label="Воспроизвести">${ICONS.play}</button>
            <div class="ap-progress"><div class="ap-fill"></div></div>
            <div class="ap-time">0:00 / 0:00</div>
            <button class="ap-download" aria-label="Скачать">${ICONS.download}</button>
        `;
        this._wirePlayButton();
        this._wireProgress();
        this._wireDownload();
    }

    _wirePlayButton() {
        const btn = this.host.querySelector('.ap-play');
        btn.addEventListener('click', () => {
            if (this.audio.paused) this.play();
            else this.pause();
        });
    }

    _wireProgress() {
        const bar = this.host.querySelector('.ap-progress');
        bar.addEventListener('click', (e) => {
            const rect = bar.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            if (isFinite(this.audio.duration)) {
                this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.duration * frac));
            }
        });
    }

    _wireDownload() {
        const btn = this.host.querySelector('.ap-download');
        btn.addEventListener('click', () => {
            if (!this.url) return;
            const a = document.createElement('a');
            a.href = this.url;
            a.download = this.filename || 'audio.wav';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }

    _wireAudio() {
        this.audio.addEventListener('play', () => this._setPlayingUI(true));
        this.audio.addEventListener('pause', () => this._setPlayingUI(false));
        this.audio.addEventListener('ended', () => {
            this._setPlayingUI(false);
            audioManager.stop(this);
        });
        this.audio.addEventListener('timeupdate', () => this._updateTime());
        this.audio.addEventListener('loadedmetadata', () => this._updateTime());
    }

    _setPlayingUI(playing) {
        const btn = this.host.querySelector('.ap-play');
        if (!btn) return;
        btn.innerHTML = playing ? ICONS.pause : ICONS.play;
        btn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    }

    _updateTime() {
        const fill = this.host.querySelector('.ap-fill');
        const time = this.host.querySelector('.ap-time');
        if (!fill || !time) return;
        const cur = this.audio.currentTime || 0;
        const dur = this.audio.duration || 0;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        fill.style.width = pct + '%';
        time.textContent = `${fmt(cur)} / ${fmt(dur)}`;
    }
}
