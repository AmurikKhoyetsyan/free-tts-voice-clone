import { getJSON, putJSON, del } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { ICONS } from '../icons.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { openConfirm, openPrompt } from '../modal.js';
import { skeletonRows } from '../loader.js';
import { log } from '../logger.js';

export async function init() {

    // ── Section switching ─────────────────────────────────────────────────────
    const typeBtns = document.querySelectorAll('.hist-type-btn');
    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeBtns.forEach(b => b.classList.toggle('active', b === btn));
            const type = btn.dataset.htype;
            document.querySelectorAll('.hist-section').forEach(s => {
                s.hidden = (s.id !== `hist-section-${type}`);
            });
        });
    });

    // ── Audio ─────────────────────────────────────────────────────────────────
    const listEl = document.getElementById('hist-list');
    const refreshBtn = document.getElementById('hist-refresh');
    const player = new AudioPlayer(document.querySelector('[data-player="hist"]'));

    let activeName = null;
    let isPlaying = false;

    player.on('play',  () => { isPlaying = true;  _syncPlayIcons(); });
    player.on('pause', () => { isPlaying = false; _syncPlayIcons(); });
    player.on('ended', () => { isPlaying = false; _syncPlayIcons(); });

    function _syncPlayIcons() {
        listEl.querySelectorAll('.hist-row').forEach(row => {
            const btn = row.querySelector('[data-action="play"]');
            if (!btn) return;
            const active = row.dataset.file === activeName && isPlaying;
            btn.innerHTML = active ? ICONS.pause : ICONS.play;
            btn.title     = active ? 'Пауза' : 'Воспроизвести';
        });
    }

    function renderAudio(files) {
        if (!files.length) {
            listEl.innerHTML = '<div class="hist-empty">Нет аудиозаписей</div>';
            return;
        }
        listEl.innerHTML = files.map(name => {
            const isActive = name === activeName;
            const icon  = isActive && isPlaying ? ICONS.pause : ICONS.play;
            const title = isActive && isPlaying ? 'Пауза' : 'Воспроизвести';
            return `
            <div class="hist-row${isActive ? ' active' : ''}" data-file="${ea(name)}">
                <span class="hist-name" title="${ea(name)}">${eh(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="play"     title="${title}">${icon}</button>
                    <button class="hist-btn"        data-action="rename"   title="Переименовать">${ICONS.edit}</button>
                    <button class="hist-btn"        data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="hist-btn danger" data-action="delete"   title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`;
        }).join('');
    }

    async function refreshAudio() {
        skeletonRows(listEl, 4);
        try {
            const data = await getJSON('/api/history');
            renderAudio(data.files);
        } catch (e) {
            listEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
            toast(e.message, 'err');
        }
    }

    listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.hist-btn[data-action]');
        if (!btn) return;
        const row    = btn.closest('.hist-row');
        const name   = row.dataset.file;
        const action = btn.dataset.action;
        const url    = `/api/history/${encodeURIComponent(name)}/audio`;

        if (action === 'play') {
            if (activeName === name) {
                isPlaying ? player.pause() : player.play();
            } else {
                activeName = name;
                listEl.querySelectorAll('.hist-row').forEach(r =>
                    r.classList.toggle('active', r.dataset.file === name));
                player.setSource(url, name);
                player.play();
            }
            return;
        }
        if (action === 'download') {
            const a = Object.assign(document.createElement('a'), { href: url, download: name });
            document.body.appendChild(a); a.click(); a.remove();
            return;
        }
        if (action === 'rename') {
            const stem = name.endsWith('.wav') ? name.slice(0, -4) : name;
            const newName = await openPrompt({ title: 'Переименовать аудио', initial: stem });
            if (!newName) return;
            try {
                const r = await putJSON(`/api/history/${encodeURIComponent(name)}`, { new_name: newName });
                toast(r.status, 'ok');
                log('Аудио переименовано: ' + name + ' → ' + r.new_name, 'done');
                if (activeName === name) {
                    activeName = r.new_name;
                    player.setSource(`/api/history/${encodeURIComponent(r.new_name)}/audio`, r.new_name);
                }
                await refreshAudio();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'delete') {
            const ok = await openConfirm({ title: 'Удалить аудио', message: `Удалить «${name}»?`, confirmLabel: 'Удалить' });
            if (!ok) return;
            try {
                const r = await del(`/api/history/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                log('Аудио удалено: ' + name, 'done');
                if (activeName === name) { activeName = null; isPlaying = false; player.setSource(null); }
                await refreshAudio();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
    });

    // ── Subtitles ─────────────────────────────────────────────────────────────
    const srtListEl       = document.getElementById('hist-srt-list');
    const srtPreviewBlock = document.getElementById('hist-srt-preview-block');
    const srtPreviewLabel = document.getElementById('hist-srt-preview-label');
    const srtPreviewPre   = document.getElementById('hist-srt-preview-content');
    const srtPreviewDl    = document.getElementById('hist-srt-preview-dl');
    const srtRestoreBtn   = document.getElementById('hist-srt-restore-btn');
    let   srtPreviewName  = null;
    let   srtPreviewText  = null;

    function renderSRT(files) {
        if (!files.length) {
            srtListEl.innerHTML = '<div class="hist-empty">Нет сохранённых субтитров</div>';
            return;
        }
        srtListEl.innerHTML = files.map(name => `
            <div class="hist-row" data-file="${ea(name)}">
                <span class="hist-name" title="${ea(name)}">${eh(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="open"     title="Предпросмотр">${ICONS.eye}</button>
                    <button class="hist-btn"        data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="hist-btn"        data-action="rename"   title="Переименовать">${ICONS.edit}</button>
                    <button class="hist-btn danger" data-action="delete"   title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`).join('');
    }

    async function refreshSRT() {
        skeletonRows(srtListEl, 3);
        try {
            const data = await getJSON('/api/subtitles');
            renderSRT(data.files);
        } catch (_) {
            srtListEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
        }
    }

    srtListEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.hist-btn[data-action]');
        if (!btn) return;
        const row    = btn.closest('.hist-row');
        const name   = row.dataset.file;
        const action = btn.dataset.action;

        if (action === 'open') {
            try {
                const r = await getJSON(`/api/subtitles/${encodeURIComponent(name)}`);
                srtPreviewName = name;
                srtPreviewText = r.content;
                if (srtPreviewLabel) srtPreviewLabel.textContent = name;
                if (srtPreviewPre)   srtPreviewPre.textContent  = r.content;
                if (srtPreviewDl) {
                    const blob = new Blob([r.content], { type: 'text/plain' });
                    if (srtPreviewDl._blobUrl) URL.revokeObjectURL(srtPreviewDl._blobUrl);
                    srtPreviewDl._blobUrl = URL.createObjectURL(blob);
                    srtPreviewDl.href     = srtPreviewDl._blobUrl;
                    srtPreviewDl.download = name;
                }
                if (srtPreviewBlock) srtPreviewBlock.hidden = false;
                srtListEl.querySelectorAll('.hist-row').forEach(r2 =>
                    r2.classList.toggle('active', r2.dataset.file === name));
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'download') {
            try {
                const r = await getJSON(`/api/subtitles/${encodeURIComponent(name)}`);
                const blob = new Blob([r.content], { type: 'text/plain' });
                const url  = URL.createObjectURL(blob);
                const a = Object.assign(document.createElement('a'), { href: url, download: name });
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'rename') {
            const stem = name.endsWith('.srt') ? name.slice(0, -4) : name;
            const newName = await openPrompt({ title: 'Переименовать субтитр', initial: stem });
            if (!newName) return;
            try {
                const r = await putJSON(`/api/subtitles/${encodeURIComponent(name)}`, { new_name: newName });
                toast(r.status, 'ok');
                log('Субтитр переименован: ' + name + ' → ' + r.new_name, 'done');
                await refreshSRT();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'delete') {
            const ok = await openConfirm({ title: 'Удалить субтитр', message: `Удалить «${name}»?`, confirmLabel: 'Удалить' });
            if (!ok) return;
            try {
                const r = await del(`/api/subtitles/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                log('Субтитр удалён: ' + name, 'done');
                await refreshSRT();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
    });

    srtRestoreBtn && srtRestoreBtn.addEventListener('click', () => {
        if (!srtPreviewText) return;
        events.dispatchEvent(new CustomEvent('srt-restore', {
            detail: { content: srtPreviewText, filename: srtPreviewName },
        }));
        toast('Субтитры восстановлены в редактор', 'ok');
    });

    // ── Video ─────────────────────────────────────────────────────────────────
    const vidListEl   = document.getElementById('hist-vid-list');
    const vidPreview  = document.getElementById('hist-vid-preview');
    const vidEmpty    = document.getElementById('hist-vid-empty');

    function renderVid(files) {
        if (!files.length) {
            vidListEl.innerHTML = '<div class="hist-empty">Нет обработанных видео</div>';
            return;
        }
        vidListEl.innerHTML = files.map(name => `
            <div class="hist-row" data-file="${ea(name)}">
                <span class="hist-name" title="${ea(name)}">${eh(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="play"     title="Предпросмотр">${ICONS.play}</button>
                    <button class="hist-btn"        data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="hist-btn"        data-action="rename"   title="Переименовать">${ICONS.edit}</button>
                    <button class="hist-btn danger" data-action="delete"   title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`).join('');
    }

    async function refreshVid() {
        skeletonRows(vidListEl, 3);
        try {
            const data = await getJSON('/api/video/history');
            renderVid(data.files);
        } catch (_) {
            vidListEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
        }
    }

    vidListEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.hist-btn[data-action]');
        if (!btn) return;
        const row    = btn.closest('.hist-row');
        const name   = row.dataset.file;
        const action = btn.dataset.action;
        const url    = `/api/video/output/${encodeURIComponent(name)}`;

        if (action === 'play') {
            vidListEl.querySelectorAll('.hist-row').forEach(r =>
                r.classList.toggle('active', r.dataset.file === name));
            vidPreview.src = url;
            vidPreview.style.display = 'block';
            vidEmpty.style.display   = 'none';
            vidPreview.play().catch(() => {});
            return;
        }
        if (action === 'download') {
            const a = Object.assign(document.createElement('a'), { href: url, download: name });
            document.body.appendChild(a); a.click(); a.remove();
            return;
        }
        if (action === 'rename') {
            const stem = name.replace(/\.[^.]+$/, '');
            const newName = await openPrompt({ title: 'Переименовать видео', initial: stem });
            if (!newName) return;
            try {
                const r = await putJSON(`/api/video/history/${encodeURIComponent(name)}`, { new_name: newName });
                toast(r.status, 'ok');
                log('Видео переименовано: ' + name + ' → ' + r.new_name, 'done');
                await refreshVid();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'delete') {
            const ok = await openConfirm({ title: 'Удалить видео', message: `Удалить «${name}»?`, confirmLabel: 'Удалить' });
            if (!ok) return;
            try {
                const r = await del(`/api/video/history/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                log('Видео удалено: ' + name, 'done');
                if (vidPreview.src.includes(encodeURIComponent(name))) {
                    vidPreview.src = '';
                    vidPreview.style.display = 'none';
                    vidEmpty.style.display   = 'block';
                }
                await refreshVid();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
    });

    // ── Templates ─────────────────────────────────────────────────────────────
    const tmplListEl          = document.getElementById('hist-tmpl-list');
    const tmplPreviewBlock    = document.getElementById('hist-tmpl-preview-block');
    const tmplPreviewLabel    = document.getElementById('hist-tmpl-preview-label');
    const tmplPreviewPre      = document.getElementById('hist-tmpl-preview-content');
    const tmplPreviewVisual   = document.getElementById('hist-tmpl-preview-visual');

    function renderTemplates(names) {
        if (!names.length) {
            tmplListEl.innerHTML = '<div class="hist-empty">Нет шаблонов</div>';
            return;
        }
        tmplListEl.innerHTML = names.map(name => `
            <div class="hist-row" data-file="${ea(name)}">
                <span class="hist-name" title="${ea(name)}">${eh(name)}</span>
                <div class="hist-btns">
                    <button class="hist-btn accent" data-action="open"   title="Просмотр JSON">${ICONS.eye}</button>
                    <button class="hist-btn danger" data-action="delete" title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`).join('');
    }

    async function refreshTemplates() {
        skeletonRows(tmplListEl, 3);
        try {
            const data = await getJSON('/api/templates');
            renderTemplates(data.templates || []);
        } catch (_) {
            tmplListEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
        }
    }

    tmplListEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.hist-btn[data-action]');
        if (!btn) return;
        const row    = btn.closest('.hist-row');
        const name   = row.dataset.file;
        const action = btn.dataset.action;

        if (action === 'open') {
            try {
                const data = await getJSON(`/api/templates/${encodeURIComponent(name)}`);
                const s = data.settings || {};
                if (tmplPreviewLabel) tmplPreviewLabel.textContent = name + '.json';
                if (tmplPreviewPre)   tmplPreviewPre.textContent  = JSON.stringify(s, null, 2);
                if (tmplPreviewVisual) _applyVisualPreview(tmplPreviewVisual, s);
                if (tmplPreviewBlock) tmplPreviewBlock.hidden = false;
                tmplListEl.querySelectorAll('.hist-row').forEach(r =>
                    r.classList.toggle('active', r.dataset.file === name));
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
        if (action === 'delete') {
            const ok = await openConfirm({ title: 'Удалить шаблон', message: `Удалить «${name}»?`, confirmLabel: 'Удалить' });
            if (!ok) return;
            try {
                const r = await del(`/api/templates/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                log('Шаблон удалён: ' + name, 'done');
                events.dispatchEvent(new CustomEvent('template-changed'));
                if (tmplPreviewBlock && tmplPreviewLabel && tmplPreviewLabel.textContent.startsWith(name))
                    tmplPreviewBlock.hidden = true;
                await refreshTemplates();
            } catch (e2) { toast(e2.message, 'err'); }
            return;
        }
    });

    // ── Refresh button (обновляет активную секцию) ────────────────────────────
    refreshBtn.addEventListener('click', () => {
        const active = document.querySelector('.hist-type-btn.active');
        const type = active ? active.dataset.htype : 'audio';
        if (type === 'audio')         refreshAudio();
        else if (type === 'subtitles') refreshSRT();
        else if (type === 'video')     refreshVid();
        else if (type === 'templates') refreshTemplates();
    });

    events.addEventListener('history-changed',   refreshAudio);
    events.addEventListener('subtitles-changed', refreshSRT);
    events.addEventListener('video-changed',     refreshVid);
    events.addEventListener('template-changed',  refreshTemplates);

    await Promise.all([refreshAudio(), refreshSRT(), refreshVid(), refreshTemplates()]);
}

function _applyVisualPreview(el, s) {
    el.textContent = 'Образец текста / Sample text';
    el.style.fontFamily      = `"${s.fontFamily || 'Arial'}", sans-serif`;
    el.style.fontSize        = (parseFloat(s.fontSize) || 24) + 'px';
    el.style.color           = s.fontColor || '#ffffff';
    el.style.fontWeight      = s.bold      ? '700'       : '400';
    el.style.fontStyle       = s.italic    ? 'italic'    : 'normal';
    el.style.textDecoration  = s.underline ? 'underline' : 'none';

    const bgOpacity = parseFloat(s.bgOpacity) || 0;
    if (bgOpacity > 0) {
        const hex = (s.bgColor || '#000000').replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16) || 0;
        const g = parseInt(hex.slice(2, 4), 16) || 0;
        const b = parseInt(hex.slice(4, 6), 16) || 0;
        el.style.backgroundColor = `rgba(${r},${g},${b},${bgOpacity / 100})`;
        el.style.padding         = `${s.bgPadY || 6}px ${s.bgPadX || 12}px`;
        el.style.borderRadius    = (s.bgRadius || 4) + 'px';
    } else {
        el.style.backgroundColor = 'transparent';
        el.style.padding         = '12px';
        el.style.borderRadius    = '0';
    }

    const oSize = parseFloat(s.outlineSize) || 0;
    const sSize = parseFloat(s.shadowSize)  || 0;
    const parts = [];
    if (oSize > 0) {
        const c = s.outlineColor || '#000000';
        parts.push(
            `-${oSize}px -${oSize}px 0 ${c}`, `${oSize}px -${oSize}px 0 ${c}`,
            `-${oSize}px ${oSize}px 0 ${c}`,  `${oSize}px ${oSize}px 0 ${c}`,
        );
    }
    if (sSize > 0) {
        parts.push(`${sSize}px ${sSize}px ${Math.ceil(sSize / 2)}px ${s.shadowColor || '#000000'}`);
    }
    el.style.textShadow = parts.join(', ');
}

function eh(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function ea(s) {
    return eh(s).replace(/"/g, '&quot;');
}
