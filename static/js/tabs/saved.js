import { getJSON, putJSON, del, postJSON, synthesizeStream } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { openConfirm, openPrompt } from '../modal.js';

let voicesCache = [];

export async function init() {
    const voice = document.getElementById('saved-voice');
    const renameInput = document.getElementById('saved-rename');
    const renameBtn = document.getElementById('saved-rename-btn');
    const deleteBtn = document.getElementById('saved-delete-btn');
    const text = document.getElementById('saved-text');
    const lang = document.getElementById('saved-lang');
    const btn = document.getElementById('saved-go');
    const status = document.getElementById('saved-status');
    const player = new AudioPlayer(document.querySelector('[data-player="saved"]'));

    // populate languages — reuse xtts languages
    try {
        const data = await getJSON('/api/xtts/status');
        lang.innerHTML = Object.keys(data.languages).map(k =>
            `<option value="${k}"${k === 'Русский' ? ' selected' : ''}>${k}</option>`
        ).join('');
    } catch (_) {}

    async function refresh(selectedName) {
        const data = await getJSON('/api/voices/saved');
        voicesCache = data.voices;
        if (voicesCache.length === 0) {
            voice.innerHTML = '<option value="" disabled selected>Нет сохранённых голосов</option>';
            renameInput.value = '';
            player.setSource(null);
            return;
        }
        voice.innerHTML = voicesCache.map(v =>
            `<option value="${escapeAttr(v)}"${v === selectedName ? ' selected' : ''}>${escapeHtml(v)}</option>`
        ).join('');
        const selected = selectedName && voicesCache.includes(selectedName) ? selectedName : voicesCache[0];
        if (selected) {
            voice.value = selected;
            renameInput.value = selected;
            player.setSource(`/api/voices/saved/${encodeURIComponent(selected)}/audio`, selected + '.wav');
        }
    }

    voice.addEventListener('change', () => {
        const name = voice.value;
        renameInput.value = name;
        player.setSource(name ? `/api/voices/saved/${encodeURIComponent(name)}/audio` : null, name + '.wav');
    });

    renameBtn.addEventListener('click', async () => {
        const old = voice.value;
        if (!old) { toast('Выберите голос', 'warn'); return; }
        const newName = renameInput.value.trim();
        if (!newName || newName === old) return;
        try {
            const r = await putJSON(`/api/voices/saved/${encodeURIComponent(old)}`, { new_name: newName });
            toast(`Переименован: ${old} → ${r.new_name}`, 'ok');
            await refresh(r.new_name);
            events.dispatchEvent(new CustomEvent('voices-changed'));
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    deleteBtn.addEventListener('click', async () => {
        const name = voice.value;
        if (!name) { toast('Выберите голос', 'warn'); return; }
        const ok = await openConfirm({
            title: 'Удалить голос',
            message: `Удалить голос «${name}»?`,
            confirmLabel: 'Удалить',
        });
        if (!ok) return;
        try {
            const r = await del(`/api/voices/saved/${encodeURIComponent(name)}`);
            toast(r.status, 'ok');
            await refresh();
            events.dispatchEvent(new CustomEvent('voices-changed'));
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    btn.addEventListener('click', async () => {
        if (!voice.value)       { toast('Выберите голос', 'warn'); return; }
        if (!text.value.trim()) { toast('Введите текст для синтеза', 'warn'); return; }

        btn.disabled = true;
        player.setLoading(true);
        status.className = 'status busy';
        status.textContent = '[0%] Запуск синтеза…';
        progress.start('Запуск синтеза…');

        try {
            await synthesizeStream(
                '/api/synthesize/saved',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text.value, voice: voice.value, language: lang.value,
                    }),
                },
                {
                    progress: (val, desc) => {
                        const pct = Math.round(val * 100);
                        status.textContent = `[${pct}%] ${desc}`;
                        progress.update(val, desc);
                        log(`⚙ ${desc} (${pct}%)`, 'gen');
                    },
                    done: (data) => {
                        status.className = 'status ok';
                        status.textContent = data.status;
                        player.setSource(data.audio_url, data.filename);
                        progress.finish(true);
                        toast(data.status, 'ok');
                        events.dispatchEvent(new CustomEvent('history-changed'));
                    },
                    error: (msg) => {
                        status.className = 'status err';
                        status.textContent = msg;
                        progress.finish(false);
                        toast(msg, 'err');
                    },
                }
            );
        } finally {
            btn.disabled = false;
            player.setLoading(false);
        }
    });

    events.addEventListener('voices-changed', () => refresh(voice.value));
    await refresh();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}
