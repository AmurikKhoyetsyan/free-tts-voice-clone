import { getJSON, postJSON, synthesizeStream } from '../api.js';
import { FileUpload } from '../file-upload.js';
import { CustomSelect } from '../custom-select.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';

export async function init() {
    const ffwarnEl       = document.getElementById('vid-ffmpeg-warn');
    const vidPreview     = document.getElementById('vid-preview');
    const vidInner       = document.getElementById('vid-inner');
    const vidEmpty       = document.getElementById('vid-empty');
    const overlay        = document.getElementById('vid-sub-overlay');
    const statusEl       = document.getElementById('vid-status');
    const goBtn          = document.getElementById('vid-go');
    const exportBlock    = document.getElementById('vid-export-block');
    const formatEl       = document.getElementById('vid-format');
    const dlBtn          = document.getElementById('vid-download-btn');

    // Style controls
    const fontFamilyEl   = document.getElementById('vid-font-family');
    const fontSizeEl     = document.getElementById('vid-font-size');
    const fontSizeVal    = document.getElementById('vid-size-val');
    const colorEl        = document.getElementById('vid-font-color');
    const boldEl         = document.getElementById('vid-bold');
    const posEl          = document.getElementById('vid-position');
    const bgOpacityEl    = document.getElementById('vid-bg-opacity');
    const bgOpacityVal   = document.getElementById('vid-bg-opacity-val');
    const bgColorEl      = document.getElementById('vid-bg-color');
    const outlineSizeEl  = document.getElementById('vid-outline-size');
    const outlineVal     = document.getElementById('vid-outline-val');
    const outlineColorEl = document.getElementById('vid-outline-color');
    const shadowSizeEl   = document.getElementById('vid-shadow-size');
    const shadowVal      = document.getElementById('vid-shadow-val');
    const shadowColorEl  = document.getElementById('vid-shadow-color');
    const karaokeColorEl = document.getElementById('vid-karaoke-color');
    const karaokeEnEl    = document.getElementById('vid-karaoke-enable');
    const resetPosBtn    = document.getElementById('vid-reset-pos');

    let uploadedVideoName = null;
    let currentSubs       = null;
    let outputW           = 0;
    let outputH           = 0;

    // Drag position state (null = use preset; otherwise % of vid-inner)
    let dragX = null;
    let dragY = null;

    // ── FFmpeg check ──────────────────────────────────────────────────────────
    try {
        const s = await getJSON('/api/video/ffmpeg-status');
        if (!s.available) {
            ffwarnEl.style.display = 'block';
            goBtn.disabled = true;
            goBtn.title = 'FFmpeg не установлен — скачайте с ffmpeg.org и добавьте в PATH';
        }
    } catch (_) {}

    // ── Preset size buttons ───────────────────────────────────────────────────
    document.querySelectorAll('.vid-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.vid-preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            outputW = parseInt(btn.dataset.w);
            outputH = parseInt(btn.dataset.h);
            document.getElementById('vid-resize-row').hidden = (outputW === 0);
        });
    });

    // ── Range labels ──────────────────────────────────────────────────────────
    fontSizeEl.addEventListener('input',   () => { fontSizeVal.textContent  = fontSizeEl.value;    applySubStyle(); });
    bgOpacityEl.addEventListener('input',  () => { bgOpacityVal.textContent = bgOpacityEl.value;   applySubStyle(); });
    outlineSizeEl.addEventListener('input',() => { outlineVal.textContent   = outlineSizeEl.value; applySubStyle(); });
    shadowSizeEl.addEventListener('input', () => { shadowVal.textContent    = shadowSizeEl.value;  applySubStyle(); });

    [fontFamilyEl, colorEl, boldEl, posEl, bgColorEl, outlineColorEl, shadowColorEl, karaokeColorEl, karaokeEnEl]
        .forEach(el => el && el.addEventListener('change', applySubStyle));

    // Reset drag position → back to dropdown preset
    resetPosBtn && resetPosBtn.addEventListener('click', () => {
        dragX = null; dragY = null;
        applySubStyle();
        resetPosBtn.hidden = true;
    });

    // ── Overlay drag ──────────────────────────────────────────────────────────
    let _dragging = false, _dx0 = 0, _dy0 = 0, _ox0 = 0, _oy0 = 0;

    overlay.addEventListener('mousedown', e => {
        if (!vidInner.offsetWidth) return;
        _dragging = true;
        const rect = vidInner.getBoundingClientRect();
        _dx0 = e.clientX;
        _dy0 = e.clientY;
        // Resolve current position as percentages
        if (dragX !== null) {
            _ox0 = dragX;
            _oy0 = dragY;
        } else {
            const or = overlay.getBoundingClientRect();
            _ox0 = (or.left + or.width  / 2 - rect.left) / rect.width  * 100;
            _oy0 = (or.top  + or.height / 2 - rect.top)  / rect.height * 100;
        }
        overlay.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!_dragging) return;
        const rect = vidInner.getBoundingClientRect();
        dragX = Math.max(2, Math.min(98, _ox0 + (e.clientX - _dx0) / rect.width  * 100));
        dragY = Math.max(2, Math.min(98, _oy0 + (e.clientY - _dy0) / rect.height * 100));
        applySubStyle();
        if (resetPosBtn) resetPosBtn.hidden = false;
    });

    document.addEventListener('mouseup', () => {
        if (_dragging) { _dragging = false; overlay.style.cursor = 'move'; }
    });

    // ── Video upload ──────────────────────────────────────────────────────────
    new FileUpload(document.getElementById('vid-upload-mount'), {
        accept: 'video/*',
        label: 'Перетащи видео или нажми',
        hint: 'MP4, MKV, AVI, WebM, MOV…',
        async onChange(file) {
            if (!file) {
                uploadedVideoName = null;
                vidInner.style.display = 'none';
                vidEmpty.style.display = 'block';
                overlay.innerHTML = '';
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
        const srtName = srtSel.value;   // FIX: was srtSel.getValue() which doesn't exist
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
        fd.append('output_width',  String(outputW));
        fd.append('output_height', String(outputH));
        fd.append('resize_mode',   document.getElementById('vid-resize-mode').value);
        fd.append('pos_x_pct',     dragX !== null ? String(Math.round(dragX * 10) / 10) : '');
        fd.append('pos_y_pct',     dragY !== null ? String(Math.round(dragY * 10) / 10) : '');

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

                    let finalName = payload.filename;
                    const selFmt = formatEl.value;
                    if (selFmt) finalName = finalName.replace(/\.[^.]+$/, '') + '.' + selFmt;

                    // Blob-based download (works even when browser would play inline)
                    dlBtn.onclick = async (e) => {
                        e.preventDefault();
                        try {
                            const resp = await fetch(payload.video_url);
                            const blob = await resp.blob();
                            const url  = URL.createObjectURL(blob);
                            const a    = Object.assign(document.createElement('a'), { href: url, download: finalName });
                            document.body.appendChild(a); a.click(); a.remove();
                            setTimeout(() => URL.revokeObjectURL(url), 2000);
                        } catch (err) {
                            toast('Ошибка скачивания: ' + err.message, 'err');
                        }
                    };
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
        if (!srtName) { currentSubs = null; overlay.innerHTML = ''; return; }
        try {
            const r = await getJSON(`/api/subtitles/${encodeURIComponent(srtName)}`);
            currentSubs = parseSRTContent(r.content);
        } catch (_) { currentSubs = null; }
        updateOverlay();
    }

    function updateOverlay() {
        if (!currentSubs) { overlay.innerHTML = ''; return; }
        const t   = vidPreview.currentTime;
        const sub = currentSubs.find(s => t >= s.start && t <= s.end);

        if (!sub) { overlay.innerHTML = ''; applySubStyle(); return; }

        const karaokeOn    = karaokeEnEl && karaokeEnEl.checked;
        const karaokeColor = karaokeColorEl ? karaokeColorEl.value : '#ffdd00';

        if (karaokeOn && sub.end > sub.start) {
            const words    = sub.text.split(/(\s+)/);   // keep whitespace tokens
            const elapsed  = t - sub.start;
            const dur      = sub.end - sub.start;
            const wordArr  = sub.text.split(/\s+/);
            const spoken   = Math.min(wordArr.length, Math.floor(wordArr.length * elapsed / dur + 0.5));

            let wordIdx = 0;
            const html = words.map(token => {
                if (/^\s+$/.test(token)) return token;
                const i = wordIdx++;
                const esc = escHtml(token);
                return i < spoken
                    ? `<span style="color:${karaokeColor}">${esc}</span>`
                    : esc;
            }).join('');
            overlay.innerHTML = html;
        } else {
            overlay.textContent = sub.text;
        }

        applySubStyle();
    }

    vidPreview.addEventListener('timeupdate', updateOverlay);
    applySubStyle();

    // ── Aspect-ratio sizing ───────────────────────────────────────────────────

    vidPreview.addEventListener('loadedmetadata', () => {
        const { videoWidth: vw, videoHeight: vh } = vidPreview;
        if (!vw || !vh) return;
        vidInner.style.aspectRatio = `${vw} / ${vh}`;
        vidInner.style.display     = 'block';
    });

    // ── Preview ───────────────────────────────────────────────────────────────

    function showPreview(videoUrl) {
        vidPreview.src         = videoUrl;
        vidEmpty.style.display = 'none';
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

        overlay.style.cursor = overlay.innerHTML ? 'move' : 'default';

        if (dragX !== null && dragY !== null) {
            overlay.style.left      = dragX + '%';
            overlay.style.top       = dragY + '%';
            overlay.style.bottom    = '';
            overlay.style.transform = 'translate(-50%, -50%)';
        } else {
            overlay.style.left   = '50%';
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
        const s = outlineSize, c = outlineColor;
        parts.push(
            `${-s}px ${-s}px 0 ${c}`, `${s}px ${-s}px 0 ${c}`,
            `${-s}px  ${s}px 0 ${c}`, `${s}px  ${s}px 0 ${c}`,
            `0 ${-s}px 0 ${c}`, `0 ${s}px 0 ${c}`,
            `${-s}px 0 0 ${c}`, `${s}px 0 0 ${c}`,
        );
    }
    if (shadowSize > 0) {
        const blur = Math.ceil(shadowSize / 2);
        parts.push(`${shadowSize}px ${shadowSize}px ${blur}px ${shadowColor}`);
    }
    return parts.join(', ');
}

function escHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
