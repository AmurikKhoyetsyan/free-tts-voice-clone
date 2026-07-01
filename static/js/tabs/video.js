import { getJSON, postJSON, synthesizeStream } from '../api.js';
import { FileUpload } from '../file-upload.js';
import { CustomSelect } from '../custom-select.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';

export async function init() {
    const ffwarnEl      = document.getElementById('vid-ffmpeg-warn');
    const vidPreview    = document.getElementById('vid-preview');
    const vidEmpty      = document.getElementById('vid-empty');
    const overlay       = document.getElementById('vid-sub-overlay');
    const statusEl      = document.getElementById('vid-status');
    const goBtn         = document.getElementById('vid-go');
    const exportBlock   = document.getElementById('vid-export-block');
    const formatEl      = document.getElementById('vid-format');
    const dlBtn         = document.getElementById('vid-download-btn');

    // Style controls
    const fontFamilyEl  = document.getElementById('vid-font-family');
    const fontSizeEl    = document.getElementById('vid-font-size');
    const fontSizeVal   = document.getElementById('vid-size-val');
    const colorEl       = document.getElementById('vid-font-color');
    const boldEl        = document.getElementById('vid-bold');
    const posEl         = document.getElementById('vid-position');
    const bgOpacityEl   = document.getElementById('vid-bg-opacity');
    const bgOpacityVal  = document.getElementById('vid-bg-opacity-val');
    const bgColorEl     = document.getElementById('vid-bg-color');
    const outlineSizeEl = document.getElementById('vid-outline-size');
    const outlineVal    = document.getElementById('vid-outline-val');
    const outlineColorEl= document.getElementById('vid-outline-color');
    const shadowSizeEl  = document.getElementById('vid-shadow-size');
    const shadowVal     = document.getElementById('vid-shadow-val');
    const shadowColorEl = document.getElementById('vid-shadow-color');

    let uploadedVideoName = null;
    let currentSubs       = null;

    // ── FFmpeg check ──────────────────────────────────────────────────────────
    try {
        const s = await getJSON('/api/video/ffmpeg-status');
        if (!s.available) {
            ffwarnEl.style.display = 'block';
            goBtn.disabled = true;
            goBtn.title = 'FFmpeg не установлен — скачайте с ffmpeg.org и добавьте в PATH';
        }
    } catch (_) {}

    // ── Range labels ──────────────────────────────────────────────────────────
    fontSizeEl.addEventListener('input', () => { fontSizeVal.textContent  = fontSizeEl.value;    applySubStyle(); });
    bgOpacityEl.addEventListener('input',() => { bgOpacityVal.textContent = bgOpacityEl.value;   applySubStyle(); });
    outlineSizeEl.addEventListener('input',()=>{ outlineVal.textContent   = outlineSizeEl.value; applySubStyle(); });
    shadowSizeEl.addEventListener('input', ()=>{ shadowVal.textContent    = shadowSizeEl.value;  applySubStyle(); });

    // All other style controls → live preview
    [fontFamilyEl, colorEl, boldEl, posEl, bgColorEl, outlineColorEl, shadowColorEl]
        .forEach(el => el.addEventListener('change', applySubStyle));

    // ── Video upload ──────────────────────────────────────────────────────────
    new FileUpload(document.getElementById('vid-upload-mount'), {
        accept: 'video/*',
        label: 'Перетащи видео или нажми',
        hint: 'MP4, MKV, AVI, WebM, MOV…',
        async onChange(file) {
            if (!file) {
                uploadedVideoName = null;
                vidPreview.style.display = 'none';
                vidEmpty.style.display = 'block';
                overlay.textContent = '';
                return;
            }
            const fd = new FormData();
            fd.append('file', file);
            try {
                const r = await fetch('/api/video/upload', { method: 'POST', body: fd });
                const data = await r.json();
                uploadedVideoName = data.name;
                showPreview(data.url);
            } catch (e) {
                toast('Ошибка загрузки видео: ' + e.message, 'err');
            }
        },
    });

    // ── SRT selector ──────────────────────────────────────────────────────────
    const srtSel = new CustomSelect(document.getElementById('vid-srt-mount'), {
        placeholder: 'Выберите SRT файл…',
        async onChange(val) {
            if (uploadedVideoName) {
                showPreview(`/api/video/file/${encodeURIComponent(uploadedVideoName)}`);
            }
            await loadSRTForOverlay(val || null);
        },
    });

    async function refreshSRTList() {
        try {
            const data = await getJSON('/api/subtitles');
            srtSel.setOptions(data.files.map(f => ({ value: f, label: f })));
        } catch (_) {}
    }
    await refreshSRTList();

    // SRT file upload
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

    // ── Burn subtitles ────────────────────────────────────────────────────────
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
        fd.append('font_family',   fontFamilyEl.value);
        fd.append('font_size',     fontSizeEl.value);
        fd.append('font_color',    colorEl.value.replace('#', ''));
        fd.append('bold',          String(boldEl.checked));
        fd.append('position',      posEl.value);
        fd.append('bg_opacity',    bgOpacityEl.value);
        fd.append('bg_color',      bgColorEl.value.replace('#', ''));
        fd.append('outline_size',  outlineSizeEl.value);
        fd.append('outline_color', outlineColorEl.value.replace('#', ''));
        fd.append('shadow_size',   shadowSizeEl.value);
        fd.append('shadow_color',  shadowColorEl.value.replace('#', ''));
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
                    statusEl.textContent = '✓ Готово';
                    statusEl.className = 'status ok';
                    showPreview(payload.video_url);
                    dlBtn.href = payload.video_url;
                    dlBtn.download = payload.filename;
                    const selFmt = formatEl.value;
                    if (selFmt) dlBtn.download = payload.filename.replace(/\.[^.]+$/, '') + '.' + selFmt;
                    exportBlock.hidden = false;
                    log('Видео готово: ' + payload.filename, 'done');
                    toast('Видео обработано!', 'ok');
                    events.dispatchEvent(new CustomEvent('video-changed'));
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

    // ── Subtitle overlay logic ────────────────────────────────────────────────

    async function loadSRTForOverlay(srtName) {
        if (!srtName) { currentSubs = null; overlay.textContent = ''; return; }
        try {
            const r = await getJSON(`/api/subtitles/${encodeURIComponent(srtName)}`);
            currentSubs = parseSRTContent(r.content);
        } catch (_) { currentSubs = null; }
        updateOverlay();
    }

    function updateOverlay() {
        if (!currentSubs) { overlay.textContent = ''; return; }
        const t = vidPreview.currentTime;
        const sub = currentSubs.find(s => t >= s.start && t <= s.end);
        overlay.textContent = sub ? sub.text : '';
        applySubStyle();
    }

    vidPreview.addEventListener('timeupdate', updateOverlay);

    // Apply styles immediately on load
    applySubStyle();

    // ── Preview ───────────────────────────────────────────────────────────────

    function showPreview(videoUrl) {
        vidPreview.src = videoUrl;
        vidPreview.style.display = 'block';
        vidEmpty.style.display   = 'none';
    }

    // ── Style functions ───────────────────────────────────────────────────────

    function applySubStyle() {
        const fontSize     = parseInt(fontSizeEl.value);
        const fontFamily   = fontFamilyEl.value;
        const textColor    = colorEl.value;
        const bold         = boldEl.checked;
        const bgOpacity    = parseInt(bgOpacityEl.value);
        const bgColor      = bgColorEl.value;
        const outlineSize  = parseFloat(outlineSizeEl.value);
        const outlineColor = outlineColorEl.value;
        const shadowSize   = parseFloat(shadowSizeEl.value);
        const shadowColor  = shadowColorEl.value;
        const pos          = posEl.value;

        overlay.style.fontSize        = fontSize + 'px';
        overlay.style.fontFamily      = `"${fontFamily}", sans-serif`;
        overlay.style.color           = textColor;
        overlay.style.fontWeight      = bold ? '700' : '400';
        overlay.style.backgroundColor = bgOpacity > 0 ? hexToRgba(bgColor, bgOpacity) : 'transparent';
        overlay.style.padding         = bgOpacity > 0 ? '3px 12px' : '0';
        overlay.style.borderRadius    = bgOpacity > 0 ? '4px' : '0';
        overlay.style.textShadow      = makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor);

        overlay.style.bottom = '';
        overlay.style.top    = '';
        if (pos === 'bottom') {
            overlay.style.bottom    = '8%';
            overlay.style.transform = 'translateX(-50%)';
        } else if (pos === 'top') {
            overlay.style.top       = '8%';
            overlay.style.transform = 'translateX(-50%)';
        } else {
            overlay.style.top       = '50%';
            overlay.style.transform = 'translate(-50%, -50%)';
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity / 100})`;
}

function makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor) {
    const parts = [];
    if (outlineSize > 0) {
        const s = outlineSize;
        const c = outlineColor;
        parts.push(
            `${-s}px ${-s}px 0 ${c}`, `${s}px ${-s}px 0 ${c}`,
            `${-s}px  ${s}px 0 ${c}`, `${s}px  ${s}px 0 ${c}`,
            `     0   ${-s}px 0 ${c}`, `    0    ${s}px 0 ${c}`,
            `${-s}px      0   0 ${c}`, `${s}px       0   0 ${c}`,
        );
    }
    if (shadowSize > 0) {
        const blur = Math.ceil(shadowSize / 2);
        parts.push(`${shadowSize}px ${shadowSize}px ${blur}px ${shadowColor}`);
    }
    return parts.join(', ');
}

function parseSrtTime(str) {
    const [hms, ms = '0'] = str.trim().split(',');
    const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms, 10) / 1000;
}

function parseSRTContent(content) {
    return content.trim().split(/\n\s*\n/).map(block => {
        const lines = block.trim().split('\n');
        if (lines.length < 3) return null;
        const [startStr, endStr] = lines[1].split('-->').map(s => s.trim());
        const text = lines.slice(2).join('\n');
        return { start: parseSrtTime(startStr), end: parseSrtTime(endStr), text };
    }).filter(Boolean);
}
