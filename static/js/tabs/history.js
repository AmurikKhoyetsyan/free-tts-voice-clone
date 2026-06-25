import { getJSON, putJSON, del } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { ICONS } from '../icons.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { openConfirm, openPrompt } from '../modal.js';

export async function init() {
    const listEl = document.getElementById('hist-list');
    const refreshBtn = document.getElementById('hist-refresh');
    const player = new AudioPlayer(document.querySelector('[data-player="hist"]'));

    let activeName = null;

    const render = (files) => {
        if (!files.length) {
            listEl.innerHTML = '<div class="hist-empty">Нет аудиозаписей</div>';
            return;
        }
        listEl.innerHTML = files.map(name => `
            <div class="hist-row${name === activeName ? ' active' : ''}" data-file="${escapeAttr(name)}">
                <span class="hist-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="play" title="Воспроизвести">${ICONS.play}</button>
                    <button class="hist-btn"        data-action="rename" title="Переименовать">${ICONS.edit}</button>
                    <button class="hist-btn"        data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="hist-btn danger" data-action="delete" title="Удалить">${ICONS.trash}</button>
                </div>
            </div>
        `).join('');
    };

    async function refresh() {
        try {
            const data = await getJSON('/api/history');
            render(data.files);
        } catch (e) {
            toast(e.message, 'err');
        }
    }

    listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.hist-btn[data-action]');
        if (!btn) return;
        const row = btn.closest('.hist-row');
        const name = row.dataset.file;
        const action = btn.dataset.action;
        const url = `/api/history/${encodeURIComponent(name)}/audio`;

        if (action === 'play') {
            activeName = name;
            player.setSource(url, name);
            player.play();
            listEl.querySelectorAll('.hist-row').forEach(r =>
                r.classList.toggle('active', r.dataset.file === name)
            );
            return;
        }
        if (action === 'download') {
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            return;
        }
        if (action === 'rename') {
            const stem = name.endsWith('.wav') ? name.slice(0, -4) : name;
            const newName = await openPrompt({ title: 'Переименовать аудио', initial: stem });
            if (!newName) return;
            try {
                const r = await putJSON(`/api/history/${encodeURIComponent(name)}`, { new_name: newName });
                toast(r.status, 'ok');
                if (activeName === name) {
                    activeName = r.new_name;
                    player.setSource(`/api/history/${encodeURIComponent(r.new_name)}/audio`, r.new_name);
                }
                await refresh();
            } catch (e) {
                toast(e.message, 'err');
            }
            return;
        }
        if (action === 'delete') {
            const ok = await openConfirm({
                title: 'Удалить аудио',
                message: `Удалить «${name}»?`,
                confirmLabel: 'Удалить',
            });
            if (!ok) return;
            try {
                const r = await del(`/api/history/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                if (activeName === name) {
                    activeName = null;
                    player.setSource(null);
                }
                await refresh();
            } catch (e) {
                toast(e.message, 'err');
            }
            return;
        }
    });

    refreshBtn.addEventListener('click', refresh);

    events.addEventListener('history-changed', refresh);

    await refresh();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}
