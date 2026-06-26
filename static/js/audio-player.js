import { ICONS } from './icons.js';
import { audioManager } from './audio-manager.js';

// Kick off CDN fetch immediately but don't block module init
let _wsPromise = null;
function _loadWS() {
    if (!_wsPromise) {
        _wsPromise = import('https://cdn.jsdelivr.net/npm/wavesurfer.js@7.10.1/dist/wavesurfer.esm.js')
            .then(m => m.default);
    }
    return _wsPromise;
}
_loadWS(); // start fetching in background right away

const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export class AudioPlayer {
    constructor(host) {
        this.host = host;
        this.url = null;
        this.filename = null;
        this.ws = null;
        this._cbs = {};
        this._renderEmpty();
        this._unsubscribe = audioManager.subscribe(active => {
            if (active !== this && this.ws && this.ws.isPlaying()) {
                this.pause();
            }
        });
    }

    // External event bus: player.on('play', cb), player.on('pause', cb), player.on('ended', cb)
    on(event, cb) {
        if (!this._cbs[event]) this._cbs[event] = [];
        this._cbs[event].push(cb);
        return this;
    }

    _emit(event) {
        (this._cbs[event] || []).forEach(cb => { try { cb(); } catch (_) {} });
    }

    setSource(url, filename = null) {
        this.url = url;
        this.filename = filename;
        if (this.ws) { this.ws.destroy(); this.ws = null; }
        if (!url) { this._renderEmpty(); return; }
        this._renderShell(url);
        _loadWS().then(WaveSurfer => {
            if (this.url !== url) return; // source changed while WS was loading
            this._attachWaveSurfer(WaveSurfer, url);
        });
    }

    setLoading(on) {
        this.host.classList.toggle('loading', !!on);
    }

    play() {
        if (!this.ws) return;
        audioManager.play(this);
        this.ws.play();
    }

    pause() {
        if (this.ws) this.ws.pause();
    }

    stop() {
        if (this.ws) {
            this.ws.pause();
            this.ws.setTime(0);
        }
        audioManager.stop(this);
    }

    destroy() {
        this.stop();
        if (this.ws) { this.ws.destroy(); this.ws = null; }
        if (this._unsubscribe) this._unsubscribe();
    }

    _renderEmpty() {
        this.host.classList.add('empty');
        this.host.innerHTML = '<span>Здесь появится аудио</span>';
    }

    _renderShell(url) {
        this.host.classList.remove('empty');
        this.host.innerHTML = `
            <button class="ap-play" aria-label="Воспроизвести">${ICONS.play}</button>
            <div class="ap-wave ap-wave-loading"></div>
            <div class="ap-time">0:00 / 0:00</div>
            <button class="ap-download" aria-label="Скачать">${ICONS.download}</button>
        `;

        this.host.querySelector('.ap-play').addEventListener('click', () => {
            if (this.ws) {
                if (this.ws.isPlaying()) this.pause();
                else this.play();
            }
        });

        this.host.querySelector('.ap-download').addEventListener('click', () => {
            if (!this.url) return;
            const a = document.createElement('a');
            a.href = this.url;
            a.download = this.filename || 'audio.wav';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }

    _attachWaveSurfer(WaveSurfer, url) {
        const waveEl  = this.host.querySelector('.ap-wave');
        const timeEl  = this.host.querySelector('.ap-time');
        const playBtn = this.host.querySelector('.ap-play');
        if (!waveEl) return;
        waveEl.classList.remove('ap-wave-loading');

        this.ws = WaveSurfer.create({
            container: waveEl,
            waveColor: '#d1d5db',
            progressColor: '#f97316',
            cursorColor: '#f97316',
            cursorWidth: 2,
            height: 40,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            normalize: true,
            interact: true,
            url,
        });

        this.ws.on('play', () => {
            playBtn.innerHTML = ICONS.pause;
            playBtn.setAttribute('aria-label', 'Пауза');
            this._emit('play');
        });

        this.ws.on('pause', () => {
            playBtn.innerHTML = ICONS.play;
            playBtn.setAttribute('aria-label', 'Воспроизвести');
            this._emit('pause');
        });

        this.ws.on('finish', () => {
            playBtn.innerHTML = ICONS.play;
            playBtn.setAttribute('aria-label', 'Воспроизвести');
            audioManager.stop(this);
            this._emit('ended');
        });

        this.ws.on('timeupdate', (currentTime) => {
            if (!timeEl) return;
            timeEl.textContent = `${fmt(currentTime)} / ${fmt(this.ws.getDuration() || 0)}`;
        });

        this.ws.on('ready', () => {
            if (timeEl) timeEl.textContent = `0:00 / ${fmt(this.ws.getDuration() || 0)}`;
        });
    }
}
