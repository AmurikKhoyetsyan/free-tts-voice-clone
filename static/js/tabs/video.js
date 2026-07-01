import { getJSON, postJSON, putJSON, del, synthesizeStream } from '../api.js';
import { FileUpload } from '../file-upload.js';
import { CustomSelect } from '../custom-select.js';
import { ICONS } from '../icons.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';
import { skeletonRows } from '../loader.js';

function escHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export async function init() {
    const ffwarnEl   = document.getElementById('vid-ffmpeg-warn');
    const vidPreview = document.getElementById('vid-preview');
    const vidEmpty   = document.getElementById('vid-empty');
    const statusEl   = document.getElementById('vid-status');
    const goBtn      = document.getElementById('vid-go');
    const fontSizeEl = document.getElementById('vid-font-size');
    const fontSizeVal= document.getElementById('vid-size-val');
    const colorEl    = document.getElementById('vid-font-color');
    const posEl      = document.getElementById('vid-position');
    const outlineEl  = document.getElementById('vid-outline');
    const exportBlock= document.getElementById('vid-export-block');
    const formatEl   = document.getElementById('vid-format');
    const dlBtn      = document.getElementById('vid-download-btn');
    const historyEl  = document.getElementById('vid-history-list');

    let uploadedVideoName = null;
    let outputVideoUrl    = null;
    let outputFileName    = null;

    // Check FFmpeg availability
    try {
        const s = await getJSON('/api/video/ffmpeg-status');
        if (!s.available) {
            ffwarnEl.style.display = 'block';
            goBtn.disabled = true;
            goBtn.title = 'FFmpeg не установлен — скачайте с ffmpeg.org и добавьте в PATH';
        }
    } catch (_) {}

    // Font size label
    fontSizeEl.addEventListener('input', () => {
        fontSizeVal.textContent = fontSizeEl.value;
    });

    // Video upload
    const upload = new FileUpload(document.getElementById('vid-upload-mount'), {
        accept: 'video/*',
        label: 'Перетащи видео или нажми',
        hint: 'MP4, MKV, AVI, WebM, MOV…',
        onChange: async (file) => {
            if (!file) {
                uploadedVideoName = null;
                vidPreview.style.display = 'none';
                vidEmpty.style.display = 'block';
                return;
            }
            const fd = new FormData();
            fd.append('file', file);
            try {
                const r = await fetch('/api/video/upload', { method: 'POST', body: fd });
                const data = await r.json();
                uploadedVideoName = data.name;
                showPreview(data.url, null);
            } catch (e) {
                toast('Ошибка загрузки видео: ' + e.message, 'err');
            }
        },
    });

    // SRT selector
    const srtSel = new CustomSelect(document.getElementById('vid-srt-mount'), {
        placeholder: 'Выберите SRT файл…',
        onChange(val) {
            if (uploadedVideoName) {
                showPreview(
                    `/api/video/file/${encodeURIComponent(uploadedVideoName)}`,
                    val || null
                );
            }
        },
    });

    // Load SRT list
    async function refreshSRTList() {
        try {
            const data = await getJSON('/api/subtitles');
            srtSel.setOptions(data.files.map(f => ({ value: f, label: f })));
        } catch (_) {}
    }
    await refreshSRTList();

    // SRT file upload — альтернатива выбору из списка
    new FileUpload(document.getElementById('vid-srt-upload-mount'), {
        accept: '.srt',
        label: 'или перетащи / загрузи SRT файл',
        hint: '.srt',
        async onChange(file) {
            if (!file) return;
            const text = await file.text();
            const name = file.name.endsWith('.srt') ? file.name.slice(0, -4) : file.name;
            try {
                const r = await postJSON('/api/subtitles', { name, content: text });
                await refreshSRTList();
                srtSel.setValue(r.name, true);
                toast('SRT загружен: ' + r.name, 'ok');
            } catch (e) {
                toast('Ошибка загрузки SRT: ' + e.message, 'err');
            }
        },
    });

    // Burn subtitles
    goBtn.addEventListener('click', async () => {
        const srtName = srtSel.getValue();
        if (!uploadedVideoName) { toast('Загрузите видео', 'warn'); return; }
        if (!srtName)           { toast('Выберите SRT файл', 'warn'); return; }

        goBtn.disabled = true;
        exportBlock.hidden = true;
        statusEl.className = 'status busy';
        statusEl.textContent = 'Обработка…';

        const fd = new FormData();
        fd.append('video_name',    uploadedVideoName);
        fd.append('srt_name',      srtName);
        fd.append('font_size',     fontSizeEl.value);
        fd.append('font_color',    colorEl.value.replace('#', ''));
        fd.append('position',      posEl.value);
        fd.append('outline',       String(outlineEl.checked));
        fd.append('output_format', formatEl.value);

        await synthesizeStream(
            '/api/video/burn',
            { method: 'POST', body: fd },
            {
                progress(val, desc) {
                    progress(val, desc || 'FFmpeg…');
                    statusEl.textContent = desc || 'Обработка…';
                },
                done(payload) {
                    goBtn.disabled = false;
                    outputVideoUrl  = payload.video_url;
                    outputFileName  = payload.filename;
                    statusEl.textContent = '✓ Готово';
                    statusEl.className = 'status ok';
                    showPreview(payload.video_url, null);
                    dlBtn.href = payload.video_url;
                    dlBtn.download = payload.filename;
                    const selFmt = formatEl.value;
                    if (selFmt) {
                        const base = payload.filename.replace(/\.[^.]+$/, '');
                        dlBtn.download = base + '.' + selFmt;
                    }
                    exportBlock.hidden = false;
                    log('Видео готово: ' + payload.filename, 'done');
                    toast('Видео обработано!', 'ok');
                    refreshHistory(historyEl);
                },
                error(msg) {
                    goBtn.disabled = false;
                    statusEl.textContent = msg;
                    statusEl.className = 'status err';
                    toast(msg, 'err');
                    log(msg, 'err');
                },
            }
        );
    });

    // History list actions
    historyEl.addEventListener('click', async (e) => {
        const btn  = e.target.closest('.sub-file-btn[data-action]');
        if (!btn) return;
        const row  = btn.closest('.sub-file-row');
        const name = row.dataset.file;
        const act  = btn.dataset.action;

        if (act === 'play') {
            showPreview(`/api/video/output/${encodeURIComponent(name)}`, null);
            return;
        }
        if (act === 'download') {
            const a = document.createElement('a');
            a.href = `/api/video/output/${encodeURIComponent(name)}`;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            return;
        }
        if (act === 'rename') {
            const newName = prompt(`Переименовать «${name}» в:`, name.replace(/\.[^.]+$/, ''));
            if (!newName || newName.trim() === '') return;
            try {
                const r = await putJSON(`/api/video/history/${encodeURIComponent(name)}`, { new_name: newName.trim() });
                toast(r.status, 'ok');
                log(r.status, 'done');
                await refreshHistory(historyEl);
            } catch (e) { toast(e.message, 'err'); }
            return;
        }
        if (act === 'delete') {
            if (!confirm(`Удалить «${name}»?`)) return;
            try {
                const r = await del(`/api/video/history/${encodeURIComponent(name)}`);
                toast(r.status, 'ok');
                await refreshHistory(historyEl);
            } catch (e) { toast(e.message, 'err'); }
            return;
        }
    });

    await refreshHistory(historyEl);

    function showPreview(videoUrl, srtName) {
        vidPreview.src = videoUrl;
        while (vidPreview.querySelector('track')) {
            vidPreview.querySelector('track').remove();
        }
        if (srtName) {
            const track = document.createElement('track');
            track.kind    = 'subtitles';
            track.label   = 'Субтитры';
            track.srclang = 'ru';
            track.src     = `/api/subtitles/${encodeURIComponent(srtName)}/vtt`;
            track.default = true;
            vidPreview.appendChild(track);
            track.addEventListener('load', () => {
                for (const t of vidPreview.textTracks) {
                    if (t.kind === 'subtitles' || t.kind === 'captions') t.mode = 'showing';
                }
            });
        }
        vidPreview.style.display = 'block';
        vidEmpty.style.display   = 'none';
    }
}

async function refreshHistory(historyEl) {
    skeletonRows(historyEl, 3);
    try {
        const data = await getJSON('/api/video/history');
        if (!data.files.length) {
            historyEl.innerHTML = '<div class="sub-empty">Нет обработанных видео</div>';
            return;
        }
        historyEl.innerHTML = data.files.map(name => `
            <div class="sub-file-row" data-file="${escHtml(name)}">
                <span class="sub-file-name" title="${escHtml(name)}">${escHtml(name)}</span>
                <div class="sub-file-btns">
                    <button class="sub-file-btn" data-action="play"     title="Предпросмотр">${ICONS.play}</button>
                    <button class="sub-file-btn" data-action="rename"   title="Переименовать">${ICONS.edit}</button>
                    <button class="sub-file-btn" data-action="download" title="Скачать">${ICONS.download}</button>
                    <button class="sub-file-btn danger" data-action="delete" title="Удалить">${ICONS.trash}</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        historyEl.innerHTML = '<div class="sub-empty">Ошибка загрузки</div>';
    }
}
