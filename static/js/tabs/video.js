import { getJSON, postJSON, synthesizeStream } from '../api.js';
import { FileUpload } from '../file-upload.js';
import { CustomSelect } from '../custom-select.js';
import { log, logLocal } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';

export async function init() {
    // ── Core elements ─────────────────────────────────────────────────────────
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

    // ── Style controls ────────────────────────────────────────────────────────
    const fontFamilyEl   = document.getElementById('vid-font-family');
    const fontSizeR      = document.getElementById('vid-font-size');
    const fontSizeN      = document.getElementById('vid-font-size-n');
    const colorEl        = document.getElementById('vid-font-color');
    const boldEl         = document.getElementById('vid-bold');

    const posXEl         = document.getElementById('vid-pos-x');
    const posYEl         = document.getElementById('vid-pos-y');
    const posPresetEl    = document.getElementById('vid-position');
    const applyPresetBtn = document.getElementById('vid-apply-preset');
    const resetPosBtn    = document.getElementById('vid-reset-pos');
    const frameSizeEl    = document.getElementById('vid-frame-size');

    const bgOpacityR     = document.getElementById('vid-bg-opacity');
    const bgOpacityN     = document.getElementById('vid-bg-opacity-n');
    const bgColorEl      = document.getElementById('vid-bg-color');
    const bgPadXEl       = document.getElementById('vid-bg-pad-x');
    const bgPadYEl       = document.getElementById('vid-bg-pad-y');
    const bgRadiusEl     = document.getElementById('vid-bg-radius');

    const outlineSizeR   = document.getElementById('vid-outline-size');
    const outlineSizeN   = document.getElementById('vid-outline-size-n');
    const outlineColorEl = document.getElementById('vid-outline-color');

    const shadowSizeR    = document.getElementById('vid-shadow-size');
    const shadowSizeN    = document.getElementById('vid-shadow-size-n');
    const shadowColorEl  = document.getElementById('vid-shadow-color');

    const karaokeColorEl = document.getElementById('vid-karaoke-color');
    const karaokeEnEl    = document.getElementById('vid-karaoke-enable');
    const lineHeightEl   = document.getElementById('vid-line-height');
    const maxWidthEl     = document.getElementById('vid-max-width');
    const marginVEl      = document.getElementById('vid-margin-v');
    const subWidthEl     = document.getElementById('vid-sub-width');
    const subHeightEl    = document.getElementById('vid-sub-height');

    const progressWrap   = document.getElementById('vid-progress-wrap');
    const progressFill   = document.getElementById('vid-progress-fill');
    const progressPct    = document.getElementById('vid-progress-pct');
    const ffmpegLog      = document.getElementById('vid-ffmpeg-log');

    const subEditorBlock   = document.getElementById('vid-sub-editor-block');
    const subEditorEl      = document.getElementById('vid-sub-editor');
    const subEditorSaveRow = document.getElementById('vid-sub-editor-save-row');
    const subEditorStatus  = document.getElementById('vid-sub-editor-status');
    const subSaveBtn       = document.getElementById('vid-sub-save-btn');

    // ── State ─────────────────────────────────────────────────────────────────
    let uploadedVideoName = null;
    let currentSubs       = null;
    let videoNatW         = 0;
    let videoNatH         = 0;
    let posXpx            = null;   // null = no explicit position
    let posYpx            = null;
    let outputW           = 0;
    let outputH           = 0;

    // ── FFmpeg check ──────────────────────────────────────────────────────────
    try {
        const s = await getJSON('/api/video/ffmpeg-status');
        if (!s.available) {
            ffwarnEl.style.display = 'block';
            goBtn.disabled = true;
            goBtn.title = 'FFmpeg не установлен';
        }
    } catch (_) {}

    // ── Range ↔ Number sync helper ────────────────────────────────────────────
    function bindRN(rangeEl, numEl, cb) {
        if (!rangeEl || !numEl) return;
        rangeEl.addEventListener('input', () => {
            numEl.value = rangeEl.value;
            cb(parseFloat(rangeEl.value));
        });
        numEl.addEventListener('input', () => {
            const v = parseFloat(numEl.value);
            if (isFinite(v)) { rangeEl.value = v; cb(v); }
        });
    }

    bindRN(fontSizeR, fontSizeN, () => applySubStyle());
    bindRN(bgOpacityR, bgOpacityN, () => applySubStyle());
    bindRN(outlineSizeR, outlineSizeN, () => applySubStyle());
    bindRN(shadowSizeR, shadowSizeN, () => applySubStyle());

    // Other controls → live preview
    [fontFamilyEl, colorEl, boldEl, bgColorEl, bgPadXEl, bgPadYEl, bgRadiusEl,
     outlineColorEl, shadowColorEl, karaokeColorEl, karaokeEnEl,
     lineHeightEl, maxWidthEl, marginVEl, subWidthEl, subHeightEl]
        .forEach(el => el && el.addEventListener('change', applySubStyle));

    // ── Position inputs ───────────────────────────────────────────────────────
    posXEl.addEventListener('input', () => {
        const v = parseInt(posXEl.value);
        if (isFinite(v)) { posXpx = v; showResetBtn(true); applySubStyle(); }
    });
    posYEl.addEventListener('input', () => {
        const v = parseInt(posYEl.value);
        if (isFinite(v)) { posYpx = v; showResetBtn(true); applySubStyle(); }
    });

    applyPresetBtn && applyPresetBtn.addEventListener('click', () => {
        applyPositionPreset(posPresetEl.value);
    });

    resetPosBtn && resetPosBtn.addEventListener('click', () => {
        posXpx = null; posYpx = null;
        posXEl.value = '';
        posYEl.value = '';
        showResetBtn(false);
        applySubStyle();
    });

    function showResetBtn(show) {
        if (resetPosBtn) resetPosBtn.hidden = !show;
    }

    function applyPositionPreset(preset) {
        if (!videoNatW || !videoNatH) {
            toast('Сначала загрузите видео', 'warn'); return;
        }
        const mid = { x: Math.round(videoNatW / 2) };
        const pos = {
            bottom: { ...mid, y: Math.round(videoNatH * 0.92) },
            top:    { ...mid, y: Math.round(videoNatH * 0.08) },
            middle: { ...mid, y: Math.round(videoNatH / 2) },
        }[preset] || { ...mid, y: Math.round(videoNatH * 0.92) };
        posXpx = pos.x;
        posYpx = pos.y;
        updatePosInputs();
        showResetBtn(true);
        applySubStyle();
    }

    function updatePosInputs() {
        if (posXEl && posXpx !== null) posXEl.value = posXpx;
        if (posYEl && posYpx !== null) posYEl.value = posYpx;
    }

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

    // ── Overlay drag ──────────────────────────────────────────────────────────
    let _dragging = false, _ox0 = 0, _oy0 = 0, _dx0 = 0, _dy0 = 0;

    overlay.addEventListener('mousedown', e => {
        if (!vidInner.offsetWidth || !videoNatW) return;
        _dragging = true;
        _dx0 = e.clientX;
        _dy0 = e.clientY;
        const rect = vidInner.getBoundingClientRect();
        // Resolve current position as pixels in video frame
        if (posXpx !== null) {
            _ox0 = posXpx;
            _oy0 = posYpx;
        } else {
            const or = overlay.getBoundingClientRect();
            _ox0 = Math.round((or.left + or.width  / 2 - rect.left) / rect.width  * videoNatW);
            _oy0 = Math.round((or.top  + or.height / 2 - rect.top)  / rect.height * videoNatH);
        }
        overlay.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!_dragging) return;
        const rect = vidInner.getBoundingClientRect();
        const dxPx = Math.round((e.clientX - _dx0) / rect.width  * videoNatW);
        const dyPx = Math.round((e.clientY - _dy0) / rect.height * videoNatH);
        posXpx = Math.max(0, Math.min(videoNatW, _ox0 + dxPx));
        posYpx = Math.max(0, Math.min(videoNatH, _oy0 + dyPx));
        updatePosInputs();
        showResetBtn(true);
        applySubStyle();
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
                videoNatW = videoNatH = 0;
                if (frameSizeEl) frameSizeEl.textContent = '';
                return;
            }
            const fd = new FormData();
            fd.append('file', file);
            try {
                const r    = await fetch('/api/video/upload', { method: 'POST', body: fd });
                const data = await r.json();
                uploadedVideoName = data.name;
                showPreview(data.url);
            } catch (e) {
                toast('Ошибка загрузки видео: ' + e.message, 'err');
            }
        },
    });

    // ── Aspect-ratio sizing ───────────────────────────────────────────────────
    vidPreview.addEventListener('loadedmetadata', () => {
        const { videoWidth: vw, videoHeight: vh } = vidPreview;
        if (!vw || !vh) return;
        videoNatW = vw;
        videoNatH = vh;
        vidInner.style.aspectRatio = `${vw} / ${vh}`;
        vidInner.style.display     = 'block';
        if (frameSizeEl) frameSizeEl.textContent = `(${vw}×${vh})`;
        // Auto-set bottom-center if no position yet
        if (posXpx === null) applyPositionPreset('bottom');
    });

    // ── SRT selector ──────────────────────────────────────────────────────────
    const srtSel = new CustomSelect(document.getElementById('vid-srt-mount'), {
        placeholder: 'Выберите SRT файл…',
        async onChange(val) {
            if (uploadedVideoName) showPreview(`/api/video/file/${encodeURIComponent(uploadedVideoName)}`);
            await loadSRTForOverlay(val || null);
        },
    });

    async function refreshSRTList() {
        try {
            const data = await getJSON('/api/subtitles');
            const opts = data.files.map(f => ({ value: f, label: f }));
            srtSel.setOptions(opts);
            if (opts.length > 0 && !srtSel.value) {
                srtSel.setValue(opts[0].value, true);
            }
        } catch (_) {}
    }
    await refreshSRTList();
    events.addEventListener('subtitles-changed', refreshSRTList);

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
        const srtName = srtSel.value;   // srtSel has no getValue() — use .value directly
        if (!uploadedVideoName) { toast('Загрузите видео', 'warn'); return; }
        if (!srtName)           { toast('Выберите SRT файл', 'warn'); return; }

        goBtn.disabled       = true;
        exportBlock.hidden   = true;
        statusEl.className   = 'status busy';
        statusEl.textContent = 'Обработка…';
        progressWrap.hidden  = false;
        progressFill.style.width = '3%';
        progressPct.textContent  = '0%';
        ffmpegLog.textContent    = '';

        const fd = new FormData();
        fd.append('video_name',    uploadedVideoName);
        fd.append('srt_name',      srtName);
        fd.append('font_family',   fontFamilyEl.value);
        fd.append('font_size',     fontSizeN.value);
        fd.append('font_color',    colorEl.value.replace('#', ''));
        fd.append('bold',          String(boldEl.checked));
        fd.append('position',      posPresetEl.value);
        fd.append('bg_opacity',    bgOpacityN.value);
        fd.append('bg_color',      bgColorEl.value.replace('#', ''));
        fd.append('bg_pad_x',      bgPadXEl ? bgPadXEl.value : '12');
        fd.append('bg_pad_y',      bgPadYEl ? bgPadYEl.value : '6');
        fd.append('outline_size',  outlineSizeN.value);
        fd.append('outline_color', outlineColorEl.value.replace('#', ''));
        fd.append('shadow_size',   shadowSizeN.value);
        fd.append('shadow_color',  shadowColorEl.value.replace('#', ''));
        fd.append('output_format', formatEl.value);
        fd.append('output_width',  String(outputW));
        fd.append('output_height', String(outputH));
        fd.append('resize_mode',   document.getElementById('vid-resize-mode').value);
        fd.append('max_width_pct', maxWidthEl.value);
        fd.append('margin_v',     marginVEl  ? marginVEl.value  : '10');
        fd.append('sub_width_px', subWidthEl  ? subWidthEl.value  : '0');
        fd.append('sub_height_px', subHeightEl ? subHeightEl.value : '0');
        // Pixel position (empty string = use alignment preset)
        fd.append('pos_x_px', posXpx !== null ? String(posXpx) : '');
        fd.append('pos_y_px', posYpx !== null ? String(posYpx) : '');
        fd.append('preview_width', String(Math.round(vidInner.offsetWidth)));

        await synthesizeStream(
            '/api/video/burn',
            { method: 'POST', body: fd },
            {
                progress(val, desc) {
                    if (val !== null && isFinite(val)) {
                        const pct = Math.round(val * 100);
                        progressFill.style.width = pct + '%';
                        progressPct.textContent  = pct + '%';
                    }
                    if (desc) {
                        statusEl.textContent = parseFfmpegDesc(desc) || 'Обработка…';
                        appendLog(desc);
                        logLocal('[FFmpeg] ' + desc, 'info');
                    }
                },
                done(payload) {
                    goBtn.disabled = false;
                    progressFill.style.width = '100%';
                    progressPct.textContent  = '100%';
                    statusEl.textContent     = '✓ Готово';
                    statusEl.className       = 'status ok';
                    showPreview(payload.video_url);

                    let finalName = payload.filename;
                    const selFmt  = formatEl.value;
                    if (selFmt) finalName = finalName.replace(/\.[^.]+$/, '') + '.' + selFmt;

                    dlBtn.href = payload.video_url;
                    dlBtn.setAttribute('download', finalName);
                    dlBtn.onclick = null;
                    exportBlock.hidden = false;
                    log('Видео готово: ' + payload.filename, 'done');
                    toast('Видео обработано!', 'ok');
                    events.dispatchEvent(new CustomEvent('video-changed'));
                },
                error(msg) {
                    goBtn.disabled       = false;
                    statusEl.textContent = msg;
                    statusEl.className   = 'status err';
                    toast(msg, 'err');
                    log(msg, 'err');
                    appendLog('ERROR: ' + msg);
                    progressFill.style.width = '0%';
                    progressPct.textContent  = '0%';
                },
            }
        );
    });

    function appendLog(line) {
        const d = document.createElement('div');
        d.textContent = line;
        ffmpegLog.appendChild(d);
        ffmpegLog.scrollTop = ffmpegLog.scrollHeight;
    }

    function parseFfmpegDesc(raw) {
        if (!raw) return '';
        const frame = raw.match(/frame=\s*(\d+)/);
        const fps   = raw.match(/fps=\s*([\d.]+)/);
        const time  = raw.match(/time=(\d+:\d+:\d+[.,]\d+)/);
        const speed = raw.match(/speed=([\d.]+x)/);
        if (frame || time) {
            const parts = [];
            if (frame) parts.push(`кадр ${frame[1]}`);
            if (fps)   parts.push(`${parseFloat(fps[1])} fps`);
            if (time)  parts.push(time[1]);
            if (speed) parts.push(speed[1]);
            return parts.join('  ·  ');
        }
        return raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
    }

    // ── Subtitle overlay ──────────────────────────────────────────────────────
    async function loadSRTForOverlay(srtName) {
        if (!srtName) {
            currentSubs = null;
            overlay.innerHTML = '';
            if (subEditorBlock) subEditorBlock.hidden = true;
            return;
        }
        try {
            const r = await getJSON(`/api/subtitles/${encodeURIComponent(srtName)}`);
            currentSubs = parseSRTContent(r.content);
            renderVidSubEditor(currentSubs, srtName);
        } catch (_) { currentSubs = null; }
        updateOverlay();
    }

    function renderVidSubEditor(subs, srtName) {
        if (!subEditorBlock) return;
        if (!subs || !subs.length) { subEditorBlock.hidden = true; return; }

        subEditorBlock.hidden = false;
        subEditorStatus.textContent = '';

        subEditorEl.innerHTML = subs.map((s, i) => `
            <div class="sub-row" data-index="${i}">
                <div>
                    <div class="sub-row-num">${i + 1}</div>
                    <div class="sub-row-times">
                        <input class="sub-time-in"  value="${srtTimeV(s.start)}" title="Начало">
                        <span class="sub-arrow">→</span>
                        <input class="sub-time-out" value="${srtTimeV(s.end)}" title="Конец">
                        <span class="sub-arrow" style="opacity:.5;font-size:10px">⏱</span>
                        <input class="sub-dur-in" type="number" value="${(s.end - s.start).toFixed(2)}" min="0.1" step="0.1" title="Длительность (с)">
                        <span style="font-size:10px;color:var(--text-dim)">с</span>
                    </div>
                </div>
                <textarea class="sub-row-text" rows="2">${escHtml(s.text)}</textarea>
            </div>
        `).join('');

        subEditorSaveRow.style.display = 'flex';

        subEditorEl.querySelectorAll('.sub-row').forEach((row, i) => {
            const tIn  = row.querySelector('.sub-time-in');
            const tOut = row.querySelector('.sub-time-out');
            const tDur = row.querySelector('.sub-dur-in');
            const tTxt = row.querySelector('.sub-row-text');

            const syncFromTimes = () => {
                const ns = parseSrtTime(tIn.value);
                const ne = parseSrtTime(tOut.value);
                if (isFinite(ns) && isFinite(ne) && ne > ns) {
                    tDur.value = (ne - ns).toFixed(2);
                    if (currentSubs[i]) { currentSubs[i].start = ns; currentSubs[i].end = ne; }
                    updateOverlay();
                }
            };
            const syncFromDur = () => {
                const ns  = parseSrtTime(tIn.value);
                const dur = parseFloat(tDur.value);
                if (isFinite(ns) && isFinite(dur) && dur > 0) {
                    const ne = ns + dur;
                    tOut.value = srtTimeV(ne);
                    if (currentSubs[i]) currentSubs[i].end = ne;
                    updateOverlay();
                }
            };

            tIn.addEventListener('change',  syncFromTimes);
            tOut.addEventListener('change', syncFromTimes);
            tDur.addEventListener('change', syncFromDur);
            tTxt.addEventListener('input',  () => {
                if (currentSubs[i]) currentSubs[i].text = tTxt.value;
                updateOverlay();
            });
        });

        subSaveBtn.onclick = async () => {
            const collected = Array.from(subEditorEl.querySelectorAll('.sub-row')).map((row, i) => ({
                index: i + 1,
                start: parseSrtTime(row.querySelector('.sub-time-in').value),
                end:   parseSrtTime(row.querySelector('.sub-time-out').value),
                text:  row.querySelector('.sub-row-text').value.trim(),
            })).filter(s => s.text);

            const content = subsToSRTV(collected);
            subEditorStatus.textContent = '';
            try {
                const r = await postJSON('/api/subtitles', { name: srtName, content });
                toast(r.status || 'Сохранено', 'ok');
                subEditorStatus.textContent = '✓ Сохранено';
                subEditorStatus.className   = 'status ok';
                events.dispatchEvent(new CustomEvent('subtitles-changed'));
                await refreshSRTList();
            } catch (e) {
                toast(e.message, 'err');
                subEditorStatus.textContent = '❌ ' + e.message;
                subEditorStatus.className   = 'status err';
            }
        };
    }

    function updateOverlay() {
        if (!currentSubs) { overlay.innerHTML = ''; return; }
        const t   = vidPreview.currentTime;
        const sub = currentSubs.find(s => t >= s.start && t <= s.end);

        if (!sub) { overlay.innerHTML = ''; applySubStyle(); return; }

        const karaokeOn    = karaokeEnEl && karaokeEnEl.checked;
        const karaokeColor = karaokeColorEl ? karaokeColorEl.value : '#ffdd00';

        if (karaokeOn && sub.end > sub.start) {
            const wordArr = sub.text.split(/\s+/);
            const elapsed = vidPreview.currentTime - sub.start;
            const spoken  = Math.min(wordArr.length,
                Math.floor(wordArr.length * elapsed / (sub.end - sub.start) + 0.5));
            const tokens  = sub.text.split(/(\s+)/);
            let wi = 0;
            const html = tokens.map(tok => {
                if (/^\s+$/.test(tok)) return tok;
                const esc = escHtml(tok);
                return wi++ < spoken
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

    // ── Preview ───────────────────────────────────────────────────────────────
    function showPreview(videoUrl) {
        vidPreview.src         = videoUrl;
        vidEmpty.style.display = 'none';
    }

    // ── Style application ─────────────────────────────────────────────────────
    function applySubStyle() {
        const fontSize     = parseFloat(fontSizeN ? fontSizeN.value : fontSizeR.value) || 24;
        const fontFamily   = fontFamilyEl.value;
        const textColor    = colorEl.value;
        const bold         = boldEl.checked;
        const bgOpacity    = parseFloat(bgOpacityN ? bgOpacityN.value : bgOpacityR.value) || 0;
        const bgColor      = bgColorEl.value;
        const padX         = parseFloat(bgPadXEl ? bgPadXEl.value : 12) || 0;
        const padY         = parseFloat(bgPadYEl ? bgPadYEl.value : 6)  || 0;
        const bgRadius     = parseFloat(bgRadiusEl ? bgRadiusEl.value : 4) || 4;
        const outlineSize  = parseFloat(outlineSizeN ? outlineSizeN.value : outlineSizeR.value) || 0;
        const outlineColor = outlineColorEl.value;
        const shadowSize   = parseFloat(shadowSizeN ? shadowSizeN.value : shadowSizeR.value) || 0;
        const shadowColor  = shadowColorEl.value;
        const lineH        = parseFloat(lineHeightEl ? lineHeightEl.value : 1.35) || 1.35;
        const maxW         = parseFloat(maxWidthEl ? maxWidthEl.value : 90) || 90;
        const marginV      = parseFloat(marginVEl ? marginVEl.value : 10) || 10;
        const subW         = parseFloat(subWidthEl ? subWidthEl.value : 0) || 0;
        const subH         = parseFloat(subHeightEl ? subHeightEl.value : 0) || 0;

        overlay.style.fontSize        = fontSize + 'px';
        overlay.style.fontFamily      = `"${fontFamily}", sans-serif`;
        overlay.style.color           = textColor;
        overlay.style.fontWeight      = bold ? '700' : '400';
        overlay.style.lineHeight      = lineH;
        overlay.style.wordSpacing     = '0.4em';
        overlay.style.textShadow      = makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor);
        overlay.style.cursor          = overlay.innerHTML ? 'move' : 'default';

        // Width: convert video-space px → % of vid-inner (which matches video aspect via CSS)
        if (subW > 0) {
            overlay.style.width    = videoNatW > 0 ? (subW / videoNatW * 100) + '%' : subW + 'px';
            overlay.style.maxWidth = 'none';
        } else {
            overlay.style.width    = '';
            overlay.style.maxWidth = maxW + '%';
        }

        // Height: exact height in video-space px → % of vid-inner height (no centering)
        if (subH > 0) {
            overlay.style.height    = videoNatH > 0 ? (subH / videoNatH * 100) + '%' : subH + 'px';
            overlay.style.minHeight = '';
        } else {
            overlay.style.height    = '';
            overlay.style.minHeight = '';
        }
        overlay.style.display        = '';
        overlay.style.flexDirection  = '';
        overlay.style.alignItems     = '';
        overlay.style.justifyContent = '';

        // Background — only visible when overlay has text
        const hasContent = overlay.textContent.trim() !== '';
        overlay.style.backgroundColor = (bgOpacity > 0 && hasContent) ? hexToRgba(bgColor, bgOpacity) : 'transparent';
        overlay.style.padding         = (bgOpacity > 0 && hasContent) ? `${padY}px ${padX}px` : '0';
        overlay.style.borderRadius    = (bgOpacity > 0 && hasContent) ? bgRadius + 'px' : '0';

        // Translate marginV (video px) → overlay % for preview approximation
        const marginVPct = videoNatH > 0 ? (marginV / videoNatH * 100) : 2;

        // Position
        if (posXpx !== null && posYpx !== null && videoNatW > 0) {
            overlay.style.left      = (posXpx / videoNatW * 100) + '%';
            overlay.style.top       = (posYpx / videoNatH * 100) + '%';
            overlay.style.bottom    = '';
            overlay.style.transform = 'translate(-50%, -50%)';
        } else {
            overlay.style.left   = '50%';
            overlay.style.bottom = '';
            overlay.style.top    = '';
            switch (posPresetEl ? posPresetEl.value : 'bottom') {
                case 'top':
                    overlay.style.top       = marginVPct + '%';
                    overlay.style.transform = 'translateX(-50%)';
                    break;
                case 'middle':
                    overlay.style.top       = '50%';
                    overlay.style.transform = 'translate(-50%,-50%)';
                    break;
                default:
                    overlay.style.bottom    = marginVPct + '%';
                    overlay.style.transform = 'translateX(-50%)';
            }
        }

        // Single-line preference: keep on one line if text fits, wrap only if it doesn't
        fitOverlayLine();
    }

    function fitOverlayLine() {
        if (!overlay.textContent.trim()) return;
        // Measure text width in no-wrap mode
        overlay.style.whiteSpace = 'nowrap';
        const overflows = overlay.scrollWidth > overlay.offsetWidth;
        // If text genuinely overflows the available box width → allow wrap
        overlay.style.whiteSpace = overflows ? 'pre-wrap' : 'nowrap';
    }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

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
    return String(s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function parseSrtTime(str) {
    const [hms, ms = '0'] = str.trim().split(',');
    const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms, 10) / 1000;
}

function parseSRTContent(content) {
    return content.trim().split(/\n\s*\n/).map((block, i) => {
        const lines = block.trim().split('\n');
        if (lines.length < 3) return null;
        const [startStr, endStr] = lines[1].split('-->').map(s => s.trim());
        const text = lines.slice(2).join('\n');
        return { index: i + 1, start: parseSrtTime(startStr), end: parseSrtTime(endStr), text };
    }).filter(Boolean);
}

function srtTimeV(sec) {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function subsToSRTV(subs) {
    return subs.map(s => `${s.index}\n${srtTimeV(s.start)} --> ${srtTimeV(s.end)}\n${s.text}`).join('\n\n') + '\n';
}
