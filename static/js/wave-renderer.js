// Canvas waveform renderer.
// Visual parameters match the original WaveSurfer bar-mode config:
//   waveColor: #d1d5db  progressColor: #f97316  cursorColor: #f97316
//   barWidth: 2  barGap: 1  barRadius: 2  height: 40  normalize: true

const BAR_W  = 2;   // px (logical)
const BAR_G  = 1;   // px gap between bars
const BAR_R  = 2;   // px corner radius
const HEIGHT = 56;  // px
const COLOR_TRACK    = '#d4d6de';
const COLOR_PROGRESS = '#f97316';

export class WaveRenderer {
    constructor(container) {
        this.container = container;
        this.peaks     = null;
        this._progress = 0;

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText =
            `width:100%;height:${HEIGHT}px;display:block;cursor:pointer;`;
        container.appendChild(this.canvas);
        this._resize();
    }

    // ── public API ───────────────────────────────────────────────────────────

    async load(url) {
        this._resize();
        try {
            const res     = await fetch(url);
            const buf     = await res.arrayBuffer();
            const ac      = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await ac.decodeAudioData(buf);
            ac.close();
            this._buildPeaks(decoded);
        } catch (_) {
            const n = Math.floor(this._cw() / (BAR_W + BAR_G));
            this.peaks = new Float32Array(n).fill(0.15);
        }
        this._draw(this._progress);
    }

    setProgress(ratio) {
        this._progress = ratio;
        if (this.peaks) this._draw(ratio);
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

    // ── internals ────────────────────────────────────────────────────────────

    _dpr() { return window.devicePixelRatio || 1; }
    _cw()  { return this.canvas.width; }
    _ch()  { return this.canvas.height; }

    _resize() {
        const dpr = this._dpr();
        this.canvas.width  = Math.round((this.container.offsetWidth || 300) * dpr);
        this.canvas.height = Math.round(HEIGHT * dpr);
        if (this.peaks) this._draw(this._progress);
    }

    _buildPeaks(audioBuffer) {
        const data  = audioBuffer.getChannelData(0);
        const dpr   = this._dpr();
        const step  = Math.round((BAR_W + BAR_G) * dpr);
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

        // Two-pass weighted smoothing for a natural, flowing waveform
        for (let pass = 0; pass < 2; pass++) {
            const s = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const l = this.peaks[Math.max(0, i - 1)];
                const c = this.peaks[i];
                const r = this.peaks[Math.min(n - 1, i + 1)];
                s[i] = l * 0.25 + c * 0.5 + r * 0.25;
            }
            this.peaks = s;
        }
    }

    _draw(progress) {
        if (!this.peaks) return;
        const ctx   = this.canvas.getContext('2d');
        const dpr   = this._dpr();
        const w     = this._cw();
        const h     = this._ch();
        const barW  = Math.round(BAR_W * dpr);
        const barR  = Math.round(BAR_R * dpr);
        const step  = Math.round((BAR_W + BAR_G) * dpr);
        const progX = progress * w;

        ctx.clearRect(0, 0, w, h);

        // Draw all bars in track color, then overdraw played region in progress color
        for (let pass = 0; pass < 2; pass++) {
            if (pass === 1 && progX <= 0) break;
            ctx.save();
            if (pass === 0) {
                ctx.fillStyle = COLOR_TRACK;
            } else {
                ctx.beginPath();
                ctx.rect(0, 0, progX, h);
                ctx.clip();
                ctx.fillStyle = COLOR_PROGRESS;
            }
            let x = 0;
            for (let i = 0; i < this.peaks.length && x + barW <= w; i++, x += step) {
                const barH = Math.max(h * 0.06, this.peaks[i] * h);
                this._roundRect(ctx, x, (h - barH) / 2, barW, barH, barR);
                ctx.fill();
            }
            ctx.restore();
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
}
