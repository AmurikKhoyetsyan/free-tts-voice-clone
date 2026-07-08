// Floating activity logger + progress bar.

const toggle = document.getElementById('log-toggle');
const panel = document.getElementById('log-panel');
const body = document.getElementById('log-body');
const closeBtn = document.getElementById('log-close');
const clearBtn = document.getElementById('log-clear');
const hdr = panel.querySelector('.log-hdr');
const resizeHandle = document.getElementById('log-resize');
const progressEl = document.getElementById('log-progress');
const lpText = progressEl.querySelector('.lp-text');
const lpPct = progressEl.querySelector('.lp-pct');
const lpFill = progressEl.querySelector('.lp-fill');
const lpStage = progressEl.querySelector('.lp-stage');
const lpEta = progressEl.querySelector('.lp-eta');

const POS_KEY = '__log_pos_v1';
const SIZE_KEY = '__log_size_v1';

function show() { panel.hidden = false; toggle.classList.add('open'); }
function hide() { panel.hidden = true; toggle.classList.remove('open'); }
function isOpen() { return !panel.hidden; }

// restore persisted position/size
try {
    const pos = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null');
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = Math.min(pos.left, window.innerWidth - 80) + 'px';
        panel.style.top = Math.min(pos.top, window.innerHeight - 60) + 'px';
    }
    const size = JSON.parse(sessionStorage.getItem(SIZE_KEY) || 'null');
    if (size && Number.isFinite(size.height)) {
        panel.style.height = Math.max(140, Math.min(window.innerHeight * 0.9, size.height)) + 'px';
    }
} catch (_) {}

show();

toggle.addEventListener('click', () => (isOpen() ? hide() : show()));
closeBtn.addEventListener('click', (e) => { e.stopPropagation(); hide(); });
clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    body.innerHTML = '';
    log('очищено');
});

// drag
let drag = null;
hdr.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = r.left + 'px';
    panel.style.top = r.top + 'px';
    panel.classList.add('dragging');
    e.preventDefault();
});

// resize
let resize = null;
resizeHandle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    resize = { startY: e.clientY, startH: panel.offsetHeight };
    panel.classList.add('resizing');
    e.preventDefault();
    e.stopPropagation();
});

document.addEventListener('mousemove', (e) => {
    if (drag) {
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        const x = Math.max(0, Math.min(window.innerWidth - w, e.clientX - drag.dx));
        const y = Math.max(0, Math.min(window.innerHeight - h, e.clientY - drag.dy));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
    } else if (resize) {
        const dh = e.clientY - resize.startY;
        const h = Math.max(140, Math.min(window.innerHeight * 0.9, resize.startH + dh));
        panel.style.height = h + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (drag) {
        drag = null;
        panel.classList.remove('dragging');
        try {
            sessionStorage.setItem(POS_KEY, JSON.stringify({
                left: parseInt(panel.style.left, 10) || 0,
                top: parseInt(panel.style.top, 10) || 0,
            }));
        } catch (_) {}
    }
    if (resize) {
        resize = null;
        panel.classList.remove('resizing');
        try {
            sessionStorage.setItem(SIZE_KEY, JSON.stringify({ height: panel.offsetHeight }));
        } catch (_) {}
    }
});

window.addEventListener('resize', () => {
    if (panel.style.left === '' && panel.style.top === '') return;
    const r = panel.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    panel.style.left = Math.max(0, Math.min(window.innerWidth - w, r.left)) + 'px';
    panel.style.top = Math.max(0, Math.min(window.innerHeight - h, r.top)) + 'px';
});

// public log API
function _logUI(msg, level) {
    if (msg == null) return;
    const t = new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.className = 'log-row' + (level ? ' ' + level : '');
    row.textContent = `[${t}] ${msg}`;
    body.insertBefore(row, body.firstChild);
    while (body.children.length > 300) body.removeChild(body.lastChild);
    body.scrollTop = 0;
}

// log() → UI panel + terminal + log file via /api/log
export function log(msg, level = '') {
    _logUI(msg, level);
    try {
        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg: String(msg), level: level || '' }),
        }).catch(() => {});
    } catch (_) {}
}

// logLocal() → UI panel only (no remote POST; use for high-frequency FFmpeg lines)
export function logLocal(msg, level = '') {
    _logUI(msg, level);
}

// progress API
const prog = { active: false, started: 0, hideTimer: null };

const fmtEta = (sec) => {
    if (!isFinite(sec) || sec <= 0) return '';
    if (sec < 1) return '~<1с';
    if (sec < 60) return '~' + Math.round(sec) + 'с';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `~${m}м ${s < 10 ? '0' : ''}${s}с`;
};

const setBarColor = (cls) => {
    lpFill.classList.remove('err', 'done');
    if (cls) lpFill.classList.add(cls);
};

export const progress = {
    start(label) {
        if (prog.hideTimer) { clearTimeout(prog.hideTimer); prog.hideTimer = null; }
        prog.active = true;
        prog.started = performance.now();
        progressEl.classList.remove('hidden');
        setBarColor(null);
        lpText.textContent = label || 'Генерация…';
        lpPct.textContent = '0%';
        lpFill.style.width = '0%';
        lpStage.textContent = 'старт';
        lpEta.textContent = '';
        show();
    },
    update(frac, desc) {
        if (!prog.active) this.start(desc);
        const f = Math.max(0, Math.min(1, frac));
        const pct = Math.round(f * 100);
        lpPct.textContent = pct + '%';
        lpFill.style.width = pct + '%';
        if (desc) {
            lpText.textContent = desc.slice(0, 60);
            lpStage.textContent = desc.length > 60 ? desc.slice(0, 60) + '…' : desc;
        }
        const elapsed = (performance.now() - prog.started) / 1000;
        if (f >= 0.02 && f < 0.99) {
            lpEta.textContent = 'осталось ' + fmtEta(elapsed / f - elapsed);
        } else {
            lpEta.textContent = elapsed.toFixed(1) + 'с';
        }
    },
    finish(ok) {
        if (!prog.active && ok == null) return;
        const elapsed = ((performance.now() - prog.started) / 1000).toFixed(1);
        prog.active = false;
        setBarColor(ok ? 'done' : 'err');
        lpFill.style.width = '100%';
        lpPct.textContent = ok ? '100%' : '—';
        lpText.textContent = ok ? '✓ Готово' : '✗ Ошибка';
        lpStage.textContent = 'всего ' + elapsed + 'с';
        lpEta.textContent = '';
        if (prog.hideTimer) clearTimeout(prog.hideTimer);
        prog.hideTimer = setTimeout(() => {
            if (!prog.active) {
                progressEl.classList.add('hidden');
                setBarColor(null);
                lpFill.style.width = '0%';
            }
        }, 5000);
    },
};


log('логгер запущен');
