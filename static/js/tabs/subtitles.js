import { postJSON } from '../api.js';
import { ICONS } from '../icons.js';
import { toast } from '../toast.js';
import { log } from '../logger.js';
import { events } from '../events.js';

// ── SRT helpers ───────────────────────────────────────────────────────────────

function srtTime(sec) {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

function parseSrtTime(str) {
    const [hms, ms = '0'] = str.trim().split(',');
    const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms, 10) / 1000;
}

function generateSubs(text, wpm, maxChars, splitMode) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    let segs = [];
    if (splitMode === 'line') {
        segs = trimmed.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (splitMode === 'sentence') {
        segs = (trimmed.match(/[^.!?…\n]+[.!?…]*/g) || [trimmed]).map(s => s.trim()).filter(Boolean);
    } else {
        const sentences = (trimmed.match(/[^.!?…\n]+[.!?…]*/g) || [trimmed]);
        for (const sent of sentences) {
            const s = sent.trim();
            if (!s) continue;
            if (s.length <= maxChars) { segs.push(s); continue; }
            const words = s.split(/\s+/);
            let cur = '';
            for (const w of words) {
                if (cur && (cur + ' ' + w).length > maxChars) { if (cur) segs.push(cur); cur = w; }
                else { cur = cur ? cur + ' ' + w : w; }
            }
            if (cur) segs.push(cur);
        }
    }
    let t = 0;
    return segs.map((text, i) => {
        const dur = Math.max(1.0, (text.split(/\s+/).length / wpm) * 60);
        const start = t;
        t += dur + 0.1;
        return { index: i + 1, start, end: start + dur, text };
    });
}

function subsToSRT(subs) {
    return subs.map(s => `${s.index}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}`).join('\n\n') + '\n';
}

function escHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── Timeline component ────────────────────────────────────────────────────────

class SubTimeline {
    constructor(container, onUpdate) {
        this.el       = container;
        this.onUpdate = onUpdate; // (idx, newStart, newEnd)
        this.subs     = [];
        this.dur      = 0;
        this._drag    = null;
        this._build();
    }

    _build() {
        this.ruler = document.createElement('div');
        this.ruler.className = 'sub-tl-ruler';
        this.track = document.createElement('div');
        this.track.className = 'sub-tl-track';
        this.el.append(this.ruler, this.track);

        this.track.addEventListener('mousedown', e => this._startDrag(e));
        document.addEventListener('mousemove',  e => this._doDrag(e));
        document.addEventListener('mouseup',    () => this._endDrag());
    }

    render(subs) {
        this.subs = subs.map(s => ({ ...s }));
        this.dur  = Math.max(...subs.map(s => s.end), 5);
        this._redraw();
        this.el.hidden = false;
    }

    updateBlock(idx, start, end) {
        if (!this.subs[idx]) return;
        this.subs[idx].start = start;
        this.subs[idx].end   = end;
        this._redraw();
    }

    removeBlock(idx) {
        this.subs.splice(idx, 1);
        this.subs.forEach((s, i) => s.index = i + 1);
        if (!this.subs.length) { this.el.hidden = true; return; }
        this.dur = Math.max(...this.subs.map(s => s.end), 5);
        this._redraw();
    }

    _redraw() {
        // ─ ruler ─
        this.ruler.innerHTML = '';
        const step = this.dur <= 30 ? 5 : this.dur <= 120 ? 15 : this.dur <= 600 ? 60 : 120;
        for (let t = 0; t <= this.dur + 0.001; t += step) {
            const pct = Math.min(t / this.dur * 100, 100);
            const m   = document.createElement('div');
            m.className = 'sub-tl-mark';
            m.style.left = pct + '%';
            const l = document.createElement('span');
            l.className  = 'sub-tl-label';
            l.style.left = pct + '%';
            l.textContent = t >= 60
                ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`
                : `${Math.round(t)}s`;
            this.ruler.append(m, l);
        }

        // ─ blocks ─
        this.track.innerHTML = '';
        this.subs.forEach((s, i) => {
            const lp  = s.start / this.dur * 100;
            const wp  = Math.max((s.end - s.start) / this.dur * 100, 0.4);
            const blk = document.createElement('div');
            blk.className  = 'sub-tl-block';
            blk.dataset.i  = i;
            blk.style.left  = lp + '%';
            blk.style.width = wp + '%';
            blk.title       = `${srtTime(s.start)} → ${srtTime(s.end)}\n${s.text}`;

            const hL = document.createElement('div');
            hL.className = 'sub-tl-hdl sub-tl-hdl-l';
            hL.dataset.i = i; hL.dataset.side = 'l';

            const hR = document.createElement('div');
            hR.className = 'sub-tl-hdl sub-tl-hdl-r';
            hR.dataset.i = i; hR.dataset.side = 'r';

            const lbl = document.createElement('span');
            lbl.className   = 'sub-tl-block-lbl';
            lbl.textContent = `${i + 1}`;

            blk.append(hL, lbl, hR);
            this.track.appendChild(blk);
        });
    }

    _startDrag(e) {
        const hdl = e.target.closest('.sub-tl-hdl');
        const blk = e.target.closest('.sub-tl-block');
        if (!hdl && !blk) return;
        e.preventDefault();
        const idx  = parseInt((hdl || blk).dataset.i);
        const rect = this.track.getBoundingClientRect();
        this._drag = {
            idx,
            side: hdl ? hdl.dataset.side : 'move',
            x0:   e.clientX,
            tw:   rect.width,
            s0:   this.subs[idx].start,
            e0:   this.subs[idx].end,
        };
        document.body.style.userSelect = 'none';
    }

    _doDrag(e) {
        if (!this._drag) return;
        const { idx, side, x0, tw, s0, e0 } = this._drag;
        const dt  = (e.clientX - x0) / tw * this.dur;
        const MIN = 0.1;
        let ns = s0, ne = e0;

        if (side === 'l') {
            ns = Math.max(0, Math.min(s0 + dt, e0 - MIN));
        } else if (side === 'r') {
            ne = Math.max(s0 + MIN, e0 + dt);
        } else {
            const d    = e0 - s0;
            const prev = idx > 0 ? this.subs[idx - 1].end + 0.01 : 0;
            const next = idx < this.subs.length - 1 ? this.subs[idx + 1].start - d - 0.01 : Infinity;
            ns = Math.max(prev, Math.min(s0 + dt, next));
            ne = ns + d;
        }

        ns = Math.round(ns * 100) / 100;
        ne = Math.round(ne * 100) / 100;
        this.subs[idx].start = ns;
        this.subs[idx].end   = ne;
        this._redraw();
        this.onUpdate(idx, ns, ne);
    }

    _endDrag() {
        this._drag = null;
        document.body.style.userSelect = '';
    }
}

// ── Tab init ──────────────────────────────────────────────────────────────────

export async function init() {
    const textEl     = document.getElementById('sub-text');
    const wpmEl      = document.getElementById('sub-wpm');
    const wpmVal     = document.getElementById('sub-wpm-val');
    const charsEl    = document.getElementById('sub-chars');
    const charsVal   = document.getElementById('sub-chars-val');
    const genBtn     = document.getElementById('sub-generate');
    const editorEl   = document.getElementById('sub-editor');
    const timelineEl = document.getElementById('sub-timeline');
    const saveRow    = document.getElementById('sub-save-row');
    const saveNameEl = document.getElementById('sub-save-name');
    const saveBtn    = document.getElementById('sub-save-btn');
    const statusEl   = document.getElementById('sub-status');

    wpmEl.addEventListener('input',   () => { wpmVal.textContent  = wpmEl.value; });
    charsEl.addEventListener('input', () => { charsVal.textContent = charsEl.value; });

    // Timeline instance — created once, reused
    const timeline = new SubTimeline(timelineEl, (idx, ns, ne) => {
        // Push new values back into the editor inputs
        const rows = editorEl.querySelectorAll('.sub-row');
        if (rows[idx]) {
            rows[idx].querySelector('.sub-time-in').value  = srtTime(ns);
            rows[idx].querySelector('.sub-time-out').value = srtTime(ne);
        }
    });

    genBtn.addEventListener('click', () => {
        const text = textEl.value.trim();
        if (!text) { toast('Введите текст', 'warn'); return; }
        const subs = generateSubs(
            text,
            parseInt(wpmEl.value, 10),
            parseInt(charsEl.value, 10),
            document.querySelector('input[name="sub-split"]:checked').value
        );
        renderEditor(subs, editorEl, saveRow, timeline);
    });

    saveBtn.addEventListener('click', async () => {
        const subs = collectSubs(editorEl);
        if (!subs.length) { toast('Нет субтитров для сохранения', 'warn'); return; }
        let name = saveNameEl.value.trim();
        if (!name) {
            const now = new Date();
            const p   = n => String(n).padStart(2, '0');
            name = `subtitle-${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
            saveNameEl.value = name;
        }
        const content = subsToSRT(subs);
        statusEl.textContent = '';
        try {
            const r = await postJSON('/api/subtitles', { name, content });
            toast(r.status, 'ok');
            statusEl.textContent = r.status;
            statusEl.className   = 'status ok';
            log(r.status, 'done');
            events.dispatchEvent(new CustomEvent('subtitles-changed'));
            const blob  = new Blob([content], { type: 'text/plain' });
            const dlUrl = URL.createObjectURL(blob);
            const dlA   = Object.assign(document.createElement('a'), { href: dlUrl, download: r.name });
            document.body.appendChild(dlA); dlA.click(); dlA.remove();
            URL.revokeObjectURL(dlUrl);
        } catch (e) {
            toast(e.message, 'err');
            statusEl.textContent = '❌ ' + e.message;
            statusEl.className   = 'status err';
        }
    });
}

// ── Editor helpers ────────────────────────────────────────────────────────────

function renderEditor(subs, editorEl, saveRow, timeline) {
    if (!subs.length) {
        editorEl.innerHTML = '<div class="sub-empty">Нет субтитров</div>';
        saveRow.style.display = 'none';
        timeline.el.hidden = true;
        return;
    }

    editorEl.innerHTML = subs.map((s, i) => `
        <div class="sub-row" data-index="${i}">
            <div>
                <div class="sub-row-num">${s.index}</div>
                <div class="sub-row-times">
                    <input class="sub-time-in"  value="${escHtml(srtTime(s.start))}" title="Начало">
                    <span class="sub-arrow">→</span>
                    <input class="sub-time-out" value="${escHtml(srtTime(s.end))}" title="Конец">
                    <span class="sub-arrow" style="opacity:.5;font-size:10px">⏱</span>
                    <input class="sub-dur-in" type="number" value="${(s.end - s.start).toFixed(2)}" min="0.1" step="0.1" title="Длительность (с)">
                    <span style="font-size:10px;color:var(--text-dim)">с</span>
                </div>
                <button class="sub-del-btn" data-action="del" title="Удалить строку">${ICONS.trash}</button>
            </div>
            <textarea class="sub-row-text" rows="2">${escHtml(s.text)}</textarea>
        </div>
    `).join('');

    saveRow.style.display = 'flex';

    // Attach time-input / duration sync → timeline
    editorEl.querySelectorAll('.sub-row').forEach((row, i) => {
        const tIn  = row.querySelector('.sub-time-in');
        const tOut = row.querySelector('.sub-time-out');
        const tDur = row.querySelector('.sub-dur-in');

        const syncFromTimes = () => {
            const ns = parseSrtTime(tIn.value);
            const ne = parseSrtTime(tOut.value);
            if (isFinite(ns) && isFinite(ne) && ne > ns) {
                tDur.value = (ne - ns).toFixed(2);
                timeline.updateBlock(i, ns, ne);
            }
        };
        const syncFromDur = () => {
            const ns  = parseSrtTime(tIn.value);
            const dur = parseFloat(tDur.value);
            if (isFinite(ns) && isFinite(dur) && dur > 0) {
                const ne = ns + dur;
                tOut.value = srtTime(ne);
                timeline.updateBlock(i, ns, ne);
            }
        };

        tIn.addEventListener('change',  syncFromTimes);
        tOut.addEventListener('change', syncFromTimes);
        tDur.addEventListener('change', syncFromDur);
    });

    // Delete handler
    editorEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.sub-del-btn');
        if (!btn) return;
        const row = btn.closest('.sub-row');
        const idx = parseInt(row.dataset.index);
        row.remove();
        reIndex(editorEl);
        timeline.removeBlock(idx);
        if (!editorEl.querySelector('.sub-row')) {
            editorEl.innerHTML = '<div class="sub-empty">Нет субтитров</div>';
            saveRow.style.display = 'none';
        }
    });

    // Render timeline
    timeline.render(subs);
}

function reIndex(editorEl) {
    editorEl.querySelectorAll('.sub-row').forEach((row, i) => {
        row.querySelector('.sub-row-num').textContent = i + 1;
        row.dataset.index = i;
    });
}

function collectSubs(editorEl) {
    return Array.from(editorEl.querySelectorAll('.sub-row')).map((row, i) => ({
        index: i + 1,
        start: parseSrtTime(row.querySelector('.sub-time-in').value),
        end:   parseSrtTime(row.querySelector('.sub-time-out').value),
        text:  row.querySelector('.sub-row-text').value.trim(),
    })).filter(s => s.text);
}
