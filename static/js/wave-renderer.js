const BAR_W  = 2;
const BAR_G  = 1;
const BAR_R  = 2;
const HEIGHT = 56;
const COLOR_TRACK    = '#d4d6de';
const COLOR_PROGRESS = '#f97316';
const COLOR_HOVER    = '#fdba74'; // lighter orange for hover preview

export class WaveRenderer {
    constructor(container) {
        this.container = container;
        this.peaks     = null;
        this._progress = 0;
        this._hover    = null;
        this._seekMoveHandler = null;
        this._seekUpHandler   = null;

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

    // Fires handler(ratio) on mousedown AND during drag — covers click and scrub.
    // Replaces the old onClick; also used by audio-player for seek.
    onSeek(handler) {
        let active = false;
        const getR = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        };
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            active = true;
            handler(getR(e));
            e.preventDefault(); // prevent text selection during drag
        });
        // Document-level so drag continues outside the canvas
        this._seekMoveHandler = (e) => { if (active) handler(getR(e)); };
        this._seekUpHandler   = () => { active = false; };
        document.addEventListener('mousemove', this._seekMoveHandler);
        document.addEventListener('mouseup',   this._seekUpHandler);
    }

    // Keep onClick for any existing external callers
    onClick(handler) {
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            handler(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
        });
    }

    onHover(handler) {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect  = this.canvas.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this._hover = ratio;
            this._draw(this._progress);
            handler(ratio);
        });
    }

    onLeave(handler) {
        this.canvas.addEventListener('mouseleave', () => {
            this._hover = null;
            this._draw(this._progress);
            handler();
        });
    }

    destroy() {
        if (this._seekMoveHandler) document.removeEventListener('mousemove', this._seekMoveHandler);
        if (this._seekUpHandler)   document.removeEventListener('mouseup',   this._seekUpHandler);
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
        const hoverX = this._hover !== null ? this._hover * w : null;

        ctx.clearRect(0, 0, w, h);

        const drawBars = () => {
            let x = 0;
            for (let i = 0; i < this.peaks.length && x + barW <= w; i++, x += step) {
                const barH = Math.max(h * 0.06, this.peaks[i] * h);
                this._roundRect(ctx, x, (h - barH) / 2, barW, barH, barR);
                ctx.fill();
            }
        };

        // Pass 1: all bars in track color (gray)
        ctx.fillStyle = COLOR_TRACK;
        drawBars();

        // Pass 2: hover region (left to cursor) in light orange
        if (hoverX !== null && hoverX > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, hoverX, h);
            ctx.clip();
            ctx.fillStyle = COLOR_HOVER;
            drawBars();
            ctx.restore();
        }

        // Pass 3: played region in full orange — always on top
        if (progX > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, progX, h);
            ctx.clip();
            ctx.fillStyle = COLOR_PROGRESS;
            drawBars();
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
