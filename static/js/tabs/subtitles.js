import { postJSON } from '../api.js';
import { ICONS } from '../icons.js';
import { toast } from '../toast.js';
import { log } from '../logger.js';
import { events } from '../events.js';

// ── SRT helpers ──────────────────────────────────────────────────────────────

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
        segs = (trimmed.match(/[^.!?…\n]+[.!?…]*/g) || [trimmed])
            .map(s => s.trim()).filter(Boolean);
    } else {
        const sentences = (trimmed.match(/[^.!?…\n]+[.!?…]*/g) || [trimmed]);
        for (const sent of sentences) {
            const s = sent.trim();
            if (!s) continue;
            if (s.length <= maxChars) { segs.push(s); continue; }
            const words = s.split(/\s+/);
            let cur = '';
            for (const w of words) {
                if (cur && (cur + ' ' + w).length > maxChars) {
                    if (cur) segs.push(cur);
                    cur = w;
                } else {
                    cur = cur ? cur + ' ' + w : w;
                }
            }
            if (cur) segs.push(cur);
        }
    }

    let t = 0;
    return segs.map((text, i) => {
        const dur   = Math.max(1.0, (text.split(/\s+/).length / wpm) * 60);
        const start = t;
        t += dur + 0.1;
        return { index: i + 1, start, end: start + dur, text };
    });
}

function subsToSRT(subs) {
    return subs.map(s =>
        `${s.index}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}`
    ).join('\n\n') + '\n';
}

function escHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── Tab init ─────────────────────────────────────────────────────────────────

export async function init() {
    const textEl     = document.getElementById('sub-text');
    const wpmEl      = document.getElementById('sub-wpm');
    const wpmVal     = document.getElementById('sub-wpm-val');
    const charsEl    = document.getElementById('sub-chars');
    const charsVal   = document.getElementById('sub-chars-val');
    const genBtn     = document.getElementById('sub-generate');
    const editorEl   = document.getElementById('sub-editor');
    const saveRow    = document.getElementById('sub-save-row');
    const saveNameEl = document.getElementById('sub-save-name');
    const saveBtn    = document.getElementById('sub-save-btn');
    const statusEl   = document.getElementById('sub-status');

    wpmEl.addEventListener('input',   () => { wpmVal.textContent  = wpmEl.value; });
    charsEl.addEventListener('input', () => { charsVal.textContent = charsEl.value; });

    genBtn.addEventListener('click', () => {
        const text = textEl.value.trim();
        if (!text) { toast('Введите текст', 'warn'); return; }
        const subs = generateSubs(
            text,
            parseInt(wpmEl.value, 10),
            parseInt(charsEl.value, 10),
            document.querySelector('input[name="sub-split"]:checked').value
        );
        renderEditor(subs, editorEl, saveRow);
    });

    saveBtn.addEventListener('click', async () => {
        const subs = collectSubs(editorEl);
        if (!subs.length) { toast('Нет субтитров для сохранения', 'warn'); return; }
        let name = saveNameEl.value.trim();
        if (!name) {
            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            name = `subtitle-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
            saveNameEl.value = name;
        }
        const content = subsToSRT(subs);
        statusEl.textContent = '';
        try {
            const r = await postJSON('/api/subtitles', { name, content });
            toast(r.status, 'ok');
            statusEl.textContent = r.status;
            statusEl.className = 'status ok';
            log(r.status, 'done');
            events.dispatchEvent(new CustomEvent('subtitles-changed'));
            // Скачать сразу после сохранения
            const blob = new Blob([content], { type: 'text/plain' });
            const dlUrl = URL.createObjectURL(blob);
            const dlA = Object.assign(document.createElement('a'), { href: dlUrl, download: r.name });
            document.body.appendChild(dlA); dlA.click(); dlA.remove();
            URL.revokeObjectURL(dlUrl);
        } catch (e) {
            toast(e.message, 'err');
            statusEl.textContent = '❌ ' + e.message;
            statusEl.className = 'status err';
        }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderEditor(subs, editorEl, saveRow) {
    if (!subs.length) {
        editorEl.innerHTML = '<div class="sub-empty">Нет субтитров</div>';
        saveRow.style.display = 'none';
        return;
    }
    editorEl.innerHTML = subs.map((s, i) => `
        <div class="sub-row" data-index="${i}">
            <div class="sub-row-num">${s.index}</div>
            <div class="sub-row-times">
                <input class="sub-time-in" value="${escHtml(srtTime(s.start))}">
                <span class="sub-arrow">→</span>
                <input class="sub-time-out" value="${escHtml(srtTime(s.end))}">
            </div>
            <button class="sub-del-btn" data-action="del" title="Удалить строку">${ICONS.trash}</button>
            <textarea class="sub-row-text" rows="2">${escHtml(s.text)}</textarea>
        </div>
    `).join('');
    saveRow.style.display = 'flex';

    editorEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.sub-del-btn');
        if (!btn) return;
        btn.closest('.sub-row').remove();
        reIndex(editorEl);
        if (!editorEl.querySelector('.sub-row')) {
            editorEl.innerHTML = '<div class="sub-empty">Нет субтитров</div>';
            saveRow.style.display = 'none';
        }
    }, { once: false });
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

function parseSRTContent(content) {
    const blocks = content.trim().split(/\n\s*\n/);
    return blocks.map(block => {
        const lines = block.trim().split('\n');
        if (lines.length < 3) return null;
        const index = parseInt(lines[0], 10);
        const [startStr, endStr] = lines[1].split('-->').map(s => s.trim());
        const text = lines.slice(2).join('\n');
        return { index, start: parseSrtTime(startStr), end: parseSrtTime(endStr), text };
    }).filter(Boolean);
}

