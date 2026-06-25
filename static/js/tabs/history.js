import { getJSON, putJSON, del } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { ICONS } from '../icons.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { openConfirm, openPrompt } from '../modal.js';
import { skeletonRows } from '../loader.js';

export async function init() {
    const listEl = document.getElementById('hist-list');
    const refreshBtn = document.getElementById('hist-refresh');
    const player = new AudioPlayer(document.querySelector('[data-player="hist"]'));

    let activeName = null;
    let isPlaying = false;

    // Track play/pause state from the underlying audio element so row icons stay in sync
    player.audio.addEventListener('play', () => {
        isPlaying = true;
        _syncPlayIcons();
    });
    player.audio.addEventListener('pause', () => {
        isPlaying = false;
        _syncPlayIcons();
    });
    player.audio.addEventListener('ended', () => {
        isPlaying = false;
        _syncPlayIcons();
    });

    function _syncPlayIcons() {
        listEl.querySelectorAll('.hist-row').forEach(row => {
            const btn = row.querySelector('[data-action="play"]');
            if (!btn) return;
            const isThisRow = row.dataset.file === activeName && isPlaying;
            btn.innerHTML = isThisRow ? ICONS.pause : ICONS.play;
            btn.title = isThisRow ? 'Пауза' : 'Воспроизвести';
        });
    }

    const render = (files) => {
        if (!files.length) {
            listEl.innerHTML = '<div class="hist-empty">Нет аудиозаписей</div>';
            return;
        }
        listEl.innerHTML = files.map(name => {
            const thisActive = name === activeName;
            const playIcon = thisActive && isPlaying ? ICONS.pause : ICONS.play;
            const playTitle = thisActive && isPlaying ? 'Пауза' : 'Воспроизвести';
            return `
            <div class="hist-row${thisActive ? ' active' : ''}" data-file="${escapeAttr(name)}">
                <span class="hist-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="play" title="${playTitle}">${playIcon}</button>
                    <button class="hist-btn"        data-action="rename" title="Переименовать">${ICONS.edit}</button>
                    <button class="hist-btn"        data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="hist-btn danger" data-action="delete" title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`;
        }).join('');
    };

    async function refresh() {
        skeletonRows(listEl, 4);
        try {
            const data = await getJSON('/api/history');
            render(data.files);
        } catch (e) {
            listEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
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
            if (activeName === name) {
                // same row — toggle play/pause
                if (isPlaying) player.pause();
                else player.play();
            } else {
                // different row — load and play
                activeName = name;
                listEl.querySelectorAll('.hist-row').forEach(r =>
                    r.classList.toggle('active', r.dataset.file === name)
                );
                player.setSource(url, name);
                player.play();
            }
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
                    isPlaying = false;
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
