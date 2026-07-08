import { getJSON, postJSON, synthesizeStream } from '../api.js';
import { FileUpload } from '../file-upload.js';
import { CustomSelect } from '../custom-select.js';
import { log } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { ICONS } from '../icons.js';
import { openPrompt } from '../modal.js';

export async function init() {
    // ── Core elements ─────────────────────────────────────────────────────────
    const ffwarnEl       = document.getElementById('vid-ffmpeg-warn');
    const vidPreview     = document.getElementById('vid-preview');
    const vidInner       = document.getElementById('vid-inner');
    const vidEmpty       = document.getElementById('vid-empty');
    const overlay        = document.getElementById('vid-sub-overlay');
    const statusEl       = document.getElementById('vid-status');
    const formatEl       = document.getElementById('vid-format');
    const dlBtn          = document.getElementById('vid-download-btn');

    // ── Style controls ────────────────────────────────────────────────────────
    const fontFamilyEl   = document.getElementById('vid-font-family');
    const fontSizeR      = document.getElementById('vid-font-size');
    const fontSizeN      = document.getElementById('vid-font-size-n');
    const colorEl        = document.getElementById('vid-font-color');
    const boldEl         = document.getElementById('vid-bold');
    const italicEl       = document.getElementById('vid-italic');
    const underlineEl    = document.getElementById('vid-underline');

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
    const reprocessBtn   = document.getElementById('vid-reprocess-btn');
    const timestampEl    = document.getElementById('vid-timestamp');
    const waveformWrap   = document.getElementById('vid-waveform-wrap');
    const waveformCanvas = document.getElementById('vid-waveform');
    const subSelEl       = document.getElementById('vid-sub-sel');
    const subSelIdxEl    = document.getElementById('vid-sub-sel-idx');
    const subSelStartEl  = document.getElementById('vid-sub-sel-start');
    const subSelEndEl    = document.getElementById('vid-sub-sel-end');
    const subSelTextEl   = document.getElementById('vid-sub-sel-text');

    const subEditorBlock   = document.getElementById('vid-sub-editor-block');
    const subEditorEl      = document.getElementById('vid-sub-editor');
    const subEditorSaveRow = document.getElementById('vid-sub-editor-save-row');
    const subEditorStatus  = document.getElementById('vid-sub-editor-status');
    const subSaveBtn       = document.getElementById('vid-sub-save-btn');
    const subProjectNameEl = document.getElementById('vid-sub-project-name');

    // ── State ─────────────────────────────────────────────────────────────────
    let uploadedVideoName = null;
    let currentSubs       = null;
    let videoNatW         = 0;
    let videoNatH         = 0;
    let posXpx            = null;   // null = no explicit position
    let posYpx            = null;
    let outputW           = 0;
    let outputH           = 0;
    let waveAudioData     = null;
    let waveDuration      = 0;
    let waveRafId         = null;
    let selectedSubIdx    = -1;
    let currentSrtName    = null;
    let vidDuration        = 0;
    let processedVideoUrl  = null;
    let processedVideoName = null;
    let _processing        = false;

    // ── FFmpeg check ──────────────────────────────────────────────────────────
    try {
        const s = await getJSON('/api/video/ffmpeg-status');
        if (!s.available) {
            ffwarnEl.style.display = 'block';
            dlBtn.disabled = true;
            dlBtn.title = 'FFmpeg не установлен';
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
    [fontFamilyEl, colorEl, bgColorEl, bgPadXEl, bgPadYEl, bgRadiusEl,
     outlineColorEl, shadowColorEl, karaokeColorEl, karaokeEnEl,
     lineHeightEl, maxWidthEl, marginVEl, subWidthEl, subHeightEl]
        .forEach(el => el && el.addEventListener('change', applySubStyle));

    // Bold / Italic / Underline toggle buttons
    [boldEl, italicEl, underlineEl].forEach(btn => {
        btn && btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            applySubStyle();
        });
    });

    // Text-align radio buttons
    const alignBtns = document.querySelectorAll('.fmt-align-btn');
    alignBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            alignBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applySubStyle();
        });
    });

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
    const vidTranscribeBtn    = document.getElementById('vid-transcribe-btn');
    const vidTranscribeStatus = document.getElementById('vid-transcribe-status');
    const vidTranscribeLang   = document.getElementById('vid-transcribe-lang');

    new FileUpload(document.getElementById('vid-upload-mount'), {
        accept: 'video/*',
        label: 'Перетащи видео или нажми',
        hint: 'MP4, MKV, AVI, WebM, MOV…',
        async onChange(file) {
            if (!file) {
                uploadedVideoName = null;
                processedVideoUrl = null;
                processedVideoName = null;
                vidInner.style.display = 'none';
                vidEmpty.style.display = 'block';
                overlay.innerHTML = '';
                videoNatW = videoNatH = 0;
                if (frameSizeEl) frameSizeEl.textContent = '';
                if (vidTranscribeBtn) vidTranscribeBtn.disabled = true;
                updateDownloadBtn();
                return;
            }
            const fd = new FormData();
            fd.append('file', file);
            try {
                const r    = await fetch('/api/video/upload', { method: 'POST', body: fd });
                const data = await r.json();
                uploadedVideoName = data.name;
                processedVideoUrl = null;
                processedVideoName = null;
                showPreview(data.url);
                updateDownloadBtn();
                if (vidTranscribeBtn) vidTranscribeBtn.disabled = false;
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
        vidDuration = vidPreview.duration || 0;
        updateTimestamp();
        // Auto-set bottom-center if no position yet
        if (posXpx === null) applyPositionPreset('bottom');
    });

    // ── Waveform animation ─────────────────────────────────────────────────────
    vidPreview.addEventListener('play', () => {
        cancelAnimationFrame(waveRafId);
        function rafTick() {
            drawWaveform(vidPreview.currentTime);
            if (!vidPreview.paused && !vidPreview.ended) waveRafId = requestAnimationFrame(rafTick);
        }
        waveRafId = requestAnimationFrame(rafTick);
    });
    vidPreview.addEventListener('pause',  () => { cancelAnimationFrame(waveRafId); drawWaveform(vidPreview.currentTime); });
    vidPreview.addEventListener('seeked', () => drawWaveform(vidPreview.currentTime));
    vidPreview.addEventListener('ended',  () => { cancelAnimationFrame(waveRafId); drawWaveform(vidPreview.currentTime); });

    // ── Waveform hover tooltip + drag-to-seek ─────────────────────────────────
    const waveTooltip = document.getElementById('vid-wave-tooltip');
    let _waveDragging = false;

    function _waveXtoTime(clientX) {
        if (!waveformCanvas || !waveDuration) return 0;
        const rect = waveformCanvas.getBoundingClientRect();
        return Math.max(0, Math.min(waveDuration, (clientX - rect.left) / rect.width * waveDuration));
    }

    function _fmtMmss(t) {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    function _drawHoverCursor(clientX) {
        if (!waveformCanvas || !waveDuration) return;
        const rect = waveformCanvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const W = waveformCanvas.width;
        const H = waveformCanvas.height;
        const cx = Math.round(x / rect.width * W);
        const ctx = waveformCanvas.getContext('2d');
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(cx - 1, 0, 2, H);
    }

    if (waveformCanvas) {
        waveformCanvas.addEventListener('mousemove', e => {
            if (!waveDuration) return;
            const t = _waveXtoTime(e.clientX);
            // Tooltip
            if (waveTooltip) {
                const rect = waveformCanvas.getBoundingClientRect();
                const wrapRect = waveformWrap.getBoundingClientRect();
                waveTooltip.textContent = _fmtMmss(t);
                waveTooltip.hidden = false;
                waveTooltip.style.left = (e.clientX - wrapRect.left) + 'px';
                waveTooltip.style.top  = (rect.top - wrapRect.top - 22) + 'px';
            }
            // Drag-to-seek
            if (_waveDragging) {
                vidPreview.currentTime = t;
                drawWaveform(t);
            } else {
                drawWaveform(vidPreview.currentTime);
            }
            _drawHoverCursor(e.clientX);
        });

        waveformCanvas.addEventListener('mouseleave', () => {
            if (waveTooltip) waveTooltip.hidden = true;
            if (!_waveDragging) drawWaveform(vidPreview.currentTime);
        });

        waveformCanvas.addEventListener('mousedown', e => {
            if (!waveDuration) return;
            _waveDragging = true;
            const t = _waveXtoTime(e.clientX);
            vidPreview.currentTime = t;
            drawWaveform(t);
            _drawHoverCursor(e.clientX);
            e.preventDefault();
        });

        document.addEventListener('mouseup', () => {
            if (_waveDragging) {
                _waveDragging = false;
                drawWaveform(vidPreview.currentTime);
            }
        });
    }

    // ── SRT selector ──────────────────────────────────────────────────────────
    const srtSel = new CustomSelect(document.getElementById('vid-srt-mount'), {
        placeholder: 'Выберите SRT файл…',
        async onChange(val) {
            processedVideoUrl = null;
            processedVideoName = null;
            if (uploadedVideoName) showPreview(`/api/video/file/${encodeURIComponent(uploadedVideoName)}`);
            await loadSRTForOverlay(val || null);
            updateDownloadBtn();
        },
    });

    async function refreshSRTList() {
        try {
            const data = await getJSON('/api/subtitles');
            const opts = data.files.map(f => ({ value: f, label: f }));
            srtSel.setOptions(opts);
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
                log('SRT загружен: ' + r.name, 'done');
            } catch (e) {
                toast('Ошибка загрузки SRT: ' + e.message, 'err');
            }
        },
    });

    // ── Download / Auto-burn ──────────────────────────────────────────────────
    dlBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (_processing) return;

        if (processedVideoUrl) {
            _triggerDownload(processedVideoUrl, processedVideoName || 'video.mp4');
            return;
        }

        if (!uploadedVideoName) { toast('Загрузите видео', 'warn'); return; }

        const editorHasSubs = currentSubs && currentSubs.length > 0 &&
                              currentSubs.some(s => s.text && s.text.trim());
        const selectedSrt   = srtSel.value;

        if (!editorHasSubs && !selectedSrt) {
            _triggerDownload(`/api/video/file/${encodeURIComponent(uploadedVideoName)}`, uploadedVideoName);
            return;
        }

        let finalSrtName = selectedSrt;

        if (editorHasSubs) {
            const toSave = currentSubs.filter(s => s.text && s.text.trim())
                                      .map((s, i) => ({ ...s, index: i + 1 }));
            const content  = subsToSRTV(toSave);
            const now = new Date();
            const p   = n => String(n).padStart(2, '0');
            const autoName = `_dl_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
            try {
                const r  = await postJSON('/api/subtitles', { name: autoName, content });
                finalSrtName = r.name;
            } catch (err) {
                toast('Ошибка сохранения субтитров: ' + err.message, 'err');
                return;
            }
        }

        if (!finalSrtName) {
            _triggerDownload(`/api/video/file/${encodeURIComponent(uploadedVideoName)}`, uploadedVideoName);
            return;
        }

        await _runBurn(finalSrtName);
    });

    async function _runBurn(srtName) {
        _processing = true;
        updateDownloadBtn();
        statusEl.textContent = '';
        statusEl.className   = 'status';
        progressWrap.hidden  = false;
        progressFill.style.width = '3%';
        if (progressPct) progressPct.textContent = '0%';

        const fd = new FormData();
        fd.append('video_name',    uploadedVideoName);
        fd.append('srt_name',      srtName);
        fd.append('font_family',   fontFamilyEl.value);
        fd.append('font_size',     fontSizeN.value);
        fd.append('font_color',    colorEl.value.replace('#', ''));
        fd.append('bold',          String(boldEl.classList.contains('active')));
        fd.append('italic',        String(italicEl?.classList.contains('active')    ?? false));
        fd.append('underline',     String(underlineEl?.classList.contains('active') ?? false));
        fd.append('text_align',    [...alignBtns].find(b => b.classList.contains('active'))?.dataset.align || 'center');
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
        fd.append('margin_v',      marginVEl  ? marginVEl.value  : '10');
        fd.append('sub_width_px',  subWidthEl  ? subWidthEl.value  : '0');
        fd.append('sub_height_px', subHeightEl ? subHeightEl.value : '0');
        fd.append('pos_x_px',      posXpx !== null ? String(posXpx) : '');
        fd.append('pos_y_px',      posYpx !== null ? String(posYpx) : '');
        fd.append('preview_width', String(Math.round(vidInner.offsetWidth)));
        fd.append('karaoke_enabled', String(karaokeEnEl ? karaokeEnEl.checked : false));
        fd.append('karaoke_color',   karaokeColorEl ? karaokeColorEl.value.replace('#', '') : 'ffdd00');

        await synthesizeStream(
            '/api/video/burn',
            { method: 'POST', body: fd },
            {
                progress(val, desc) {
                    if (val !== null && isFinite(val)) {
                        const pct = Math.round(val * 100);
                        progressFill.style.width = pct + '%';
                        if (progressPct) progressPct.textContent = pct + '%';
                    }
                },
                done(payload) {
                    _processing = false;
                    progressWrap.hidden      = true;
                    statusEl.textContent     = '✓ Готово';
                    statusEl.className       = 'status ok';

                    let finalName = payload.filename;
                    const selFmt  = formatEl.value;
                    if (selFmt) finalName = finalName.replace(/\.[^.]+$/, '') + '.' + selFmt;

                    processedVideoUrl  = payload.video_url;
                    processedVideoName = finalName;
                    updateDownloadBtn();
                    if (reprocessBtn) reprocessBtn.hidden = false;
                    log('Видео готово: ' + payload.filename, 'done');
                    toast('Видео обработано!', 'ok');
                    events.dispatchEvent(new CustomEvent('video-changed'));
                    _triggerDownload(payload.video_url, finalName);
                },
                error(msg) {
                    _processing = false;
                    updateDownloadBtn();
                    statusEl.textContent = msg;
                    statusEl.className   = 'status err';
                    toast(msg, 'err');
                    log(msg, 'err');
                    progressWrap.hidden = true;
                },
            }
        );
    }

    function updateDownloadBtn() {
        if (_processing) {
            dlBtn.textContent = 'Обработка…';
            dlBtn.disabled    = true;
            return;
        }
        if (processedVideoUrl) {
            dlBtn.textContent = 'Скачать ещё раз';
            dlBtn.disabled    = false;
            return;
        }
        if (!uploadedVideoName) {
            dlBtn.textContent = 'Скачать';
            dlBtn.disabled    = false;
            return;
        }
        const hasEditorSubs = currentSubs && currentSubs.some(s => s.text && s.text.trim());
        const hasSrtSel     = !!srtSel.value;
        dlBtn.textContent = (hasEditorSubs || hasSrtSel) ? 'Обработать и скачать' : 'Скачать (оригинал)';
        dlBtn.disabled    = false;
    }

    reprocessBtn && reprocessBtn.addEventListener('click', () => {
        processedVideoUrl  = null;
        processedVideoName = null;
        reprocessBtn.hidden = true;
        updateDownloadBtn();
        dlBtn.click();
    });

    function _triggerDownload(url, name) {
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    // ── Subtitle overlay ──────────────────────────────────────────────────────
    async function loadSRTForOverlay(srtName) {
        processedVideoUrl = null;
        if (!srtName) {
            currentSubs = null;
            overlay.innerHTML = '';
            applySubStyle();
            renderVidSubEditor([], null);
            updateDownloadBtn();
            return;
        }
        try {
            const r = await getJSON(`/api/subtitles/${encodeURIComponent(srtName)}`);
            currentSubs = parseSRTContent(r.content);
            renderVidSubEditor(currentSubs, srtName);
        } catch (_) { currentSubs = null; }
        updateOverlay();
        updateDownloadBtn();
    }

    function renderVidSubEditor(subs, srtName) {
        if (srtName) currentSrtName = srtName;
        if (srtName && subProjectNameEl) {
            const stem = srtName.replace(/\.srt$/i, '').replace(/_v\d{8}_\d{6}$/, '');
            subProjectNameEl.value = stem;
        }
        if (!subEditorBlock) return;

        subEditorBlock.hidden = false;
        subEditorStatus.textContent = '';

        const mkAdd = (after) =>
            `<button class="sub-add-btn" data-after="${after}" title="Добавить субтитр"><span></span>+<span></span></button>`;

        if (!subs || !subs.length) {
            subEditorEl.innerHTML =
                '<div class="sub-empty">Нет субтитров. Нажмите «+», чтобы добавить.</div>' +
                mkAdd(-1);
            subEditorSaveRow.style.display = 'none';
            updateSubInfoPanel();
            drawWaveform(vidPreview.currentTime);
            return;
        }

        subEditorEl.innerHTML = mkAdd(-1) + subs.map((s, i) => `
            <div class="sub-row${selectedSubIdx === i ? ' sub-row-selected' : ''}" data-index="${i}">
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
                    <button class="sub-del-btn" title="Удалить">${ICONS.trash}</button>
                </div>
                <textarea class="sub-row-text" rows="2">${escHtml(s.text)}</textarea>
            </div>
            ${mkAdd(i)}
        `).join('');

        subEditorSaveRow.style.display = 'flex';

        subEditorEl.querySelectorAll('.sub-row').forEach((row, i) => {
            const tIn  = row.querySelector('.sub-time-in');
            const tOut = row.querySelector('.sub-time-out');
            const tDur = row.querySelector('.sub-dur-in');
            const tTxt = row.querySelector('.sub-row-text');

            const syncTimes = () => {
                const ns = parseSrtTime(tIn.value);
                const ne = parseSrtTime(tOut.value);
                if (isFinite(ns) && isFinite(ne) && ne > ns) {
                    tDur.value = (ne - ns).toFixed(2);
                    if (currentSubs[i]) { currentSubs[i].start = ns; currentSubs[i].end = ne; }
                    updateOverlay();
                    if (selectedSubIdx === i) updateSubInfoPanel();
                    drawWaveform(vidPreview.currentTime);
                    processedVideoUrl = null;
                    updateDownloadBtn();
                }
            };
            const syncDur = () => {
                const ns  = parseSrtTime(tIn.value);
                const dur = parseFloat(tDur.value);
                if (isFinite(ns) && isFinite(dur) && dur > 0) {
                    const ne = ns + dur;
                    tOut.value = srtTimeV(ne);
                    if (currentSubs[i]) currentSubs[i].end = ne;
                    updateOverlay();
                    if (selectedSubIdx === i) updateSubInfoPanel();
                    drawWaveform(vidPreview.currentTime);
                    processedVideoUrl = null;
                    updateDownloadBtn();
                }
            };

            tIn.addEventListener('change',  syncTimes);
            tOut.addEventListener('change', syncTimes);
            tDur.addEventListener('change', syncDur);
            tTxt.addEventListener('input',  () => {
                if (currentSubs[i]) currentSubs[i].text = tTxt.value;
                updateOverlay();
                if (selectedSubIdx === i) updateSubInfoPanel();
                processedVideoUrl = null;
                updateDownloadBtn();
            });
        });

        subSaveBtn.onclick = async () => {
            subEditorEl.querySelectorAll('.sub-row').forEach((row, i) => {
                if (currentSubs[i]) currentSubs[i].text = row.querySelector('.sub-row-text').value.trim();
            });
            const toSave = currentSubs.filter(s => s.text).map((s, i) => ({ ...s, index: i + 1 }));
            const content = subsToSRTV(toSave);
            subEditorStatus.textContent = '';

            // Determine base name (strip .srt and version suffix)
            let baseName = subProjectNameEl ? subProjectNameEl.value.trim() : '';
            if (!baseName && currentSrtName) {
                baseName = currentSrtName.replace(/\.srt$/i, '').replace(/_v\d{8}_\d{6}$/, '');
            }
            if (!baseName) baseName = 'subtitle';

            // Always create a new versioned file
            const now = new Date();
            const p   = n => String(n).padStart(2, '0');
            const vSuffix = `_v${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
            const versionedName = baseName + vSuffix;

            try {
                const r = await postJSON('/api/subtitles', { name: versionedName, content });
                toast(r.status || 'Сохранено', 'ok');
                log('Субтитры сохранены: ' + versionedName, 'done');
                subEditorStatus.textContent = '✓ Версия: ' + versionedName;
                subEditorStatus.className   = 'status ok';
                events.dispatchEvent(new CustomEvent('subtitles-changed'));
                await refreshSRTList();
            } catch (e) {
                toast(e.message, 'err');
                subEditorStatus.textContent = '❌ ' + e.message;
                subEditorStatus.className   = 'status err';
            }
        };

        updateSubInfoPanel();
        drawWaveform(vidPreview.currentTime);
    }

    // ── Video sub editor delegation (set up once) ─────────────────────────────
    subEditorEl.addEventListener('click', e => {
        const delBtn = e.target.closest('.sub-del-btn');
        if (delBtn) {
            const row = delBtn.closest('.sub-row');
            const idx = parseInt(row.dataset.index);
            if (!currentSubs) return;
            currentSubs.splice(idx, 1);
            currentSubs.forEach((s, j) => { s.index = j + 1; });
            if (selectedSubIdx >= currentSubs.length) selectedSubIdx = currentSubs.length - 1;
            renderVidSubEditor(currentSubs, null);
            updateOverlay();
            return;
        }
        const addBtn = e.target.closest('.sub-add-btn');
        if (addBtn) {
            if (!currentSubs) currentSubs = [];
            const afterIdx = parseInt(addBtn.dataset.after);
            const prev = afterIdx >= 0 ? currentSubs[afterIdx] : null;
            const next = afterIdx + 1 < currentSubs.length ? currentSubs[afterIdx + 1] : null;
            const newStart = prev ? prev.end + 0.05 : 0;
            const newEnd   = next
                ? Math.max(newStart + 0.1, Math.min(newStart + 2, next.start - 0.05))
                : newStart + 2;
            currentSubs.splice(afterIdx + 1, 0, {
                index: 0, start: newStart, end: Math.max(newStart + 0.1, newEnd), text: '',
            });
            currentSubs.forEach((s, j) => { s.index = j + 1; });
            selectedSubIdx = afterIdx + 1;
            renderVidSubEditor(currentSubs, null);
            updateOverlay();
            const newRow = subEditorEl.querySelectorAll('.sub-row')[afterIdx + 1];
            if (newRow) {
                newRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                newRow.querySelector('.sub-row-text')?.focus();
            }
            return;
        }
        const row = e.target.closest('.sub-row');
        if (row && !e.target.closest('input, textarea, button')) {
            selectedSubIdx = parseInt(row.dataset.index);
            subEditorEl.querySelectorAll('.sub-row').forEach(r =>
                r.classList.toggle('sub-row-selected', r === row));
            updateSubInfoPanel();
        }
    });

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

    function formatTimestamp(t) {
        const h  = Math.floor(t / 3600);
        const m  = Math.floor((t % 3600) / 60);
        const s  = Math.floor(t % 60);
        const ms = Math.round((t % 1) * 1000);
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
    }
    function updateTimestamp() {
        if (timestampEl) timestampEl.textContent = `${formatTimestamp(vidPreview.currentTime)} / ${formatTimestamp(vidDuration)}`;
    }
    vidPreview.addEventListener('timeupdate', () => {
        updateOverlay();
        if (selectedSubIdx === -1) updateSubInfoPanel();
        updateTimestamp();
    });
    applySubStyle();

    // ── Preview ───────────────────────────────────────────────────────────────
    function showPreview(videoUrl) {
        vidPreview.src         = videoUrl;
        vidEmpty.style.display = 'none';
        loadWaveform(videoUrl);
    }

    // ── Style application ─────────────────────────────────────────────────────
    function applySubStyle() {
        const fontSize     = parseFloat(fontSizeN ? fontSizeN.value : fontSizeR.value) || 24;
        const fontFamily   = fontFamilyEl.value;
        const textColor    = colorEl.value;
        const bold         = boldEl.classList.contains('active');
        const italic       = italicEl?.classList.contains('active')    ?? false;
        const underline    = underlineEl?.classList.contains('active') ?? false;
        const activeAlign  = [...alignBtns].find(b => b.classList.contains('active'));
        const textAlign    = activeAlign?.dataset.align || 'center';
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
        overlay.style.fontWeight      = bold      ? '700'       : '400';
        overlay.style.fontStyle       = italic    ? 'italic'    : 'normal';
        overlay.style.textDecoration  = underline ? 'underline' : 'none';
        overlay.style.textAlign       = textAlign;
        overlay.style.lineHeight      = lineH;
        overlay.style.wordSpacing     = '0.4em';
        overlay.style.textShadow      = makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor);
        const hasText = overlay.textContent.trim() !== '';
        overlay.style.cursor          = hasText ? 'move' : 'default';
        overlay.style.pointerEvents   = hasText ? 'auto' : 'none';

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
        overlay.style.whiteSpace = 'nowrap';
        const overflows = overlay.scrollWidth > overlay.offsetWidth;
        overlay.style.whiteSpace = overflows ? 'pre-wrap' : 'nowrap';
    }

    // ── Waveform ──────────────────────────────────────────────────────────────
    async function loadWaveform(videoUrl) {
        if (!waveformCanvas || !waveformWrap) return;
        waveformWrap.hidden = false;
        waveAudioData = null;
        waveDuration  = 0;
        const W = waveformCanvas.clientWidth || 700;
        const H = 80;
        waveformCanvas.width  = W;
        waveformCanvas.height = H;
        const ctx = waveformCanvas.getContext('2d');
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#555';
        ctx.font = '11px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Загрузка аудио…', W / 2, H / 2 + 4);
        try {
            const resp  = await fetch(videoUrl);
            const buf   = await resp.arrayBuffer();
            const audio = new (window.AudioContext || window.webkitAudioContext)();
            const ab    = await audio.decodeAudioData(buf);
            waveAudioData = ab.getChannelData(0);
            waveDuration  = ab.duration;
            waveformCanvas.width = waveformCanvas.clientWidth || 700;
            drawWaveform(vidPreview.currentTime);
        } catch (err) {
            console.warn('Waveform:', err);
            const ctx2 = waveformCanvas.getContext('2d');
            ctx2.fillStyle = '#0d1117';
            ctx2.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
            ctx2.fillStyle = '#444';
            ctx2.font = '11px system-ui,sans-serif';
            ctx2.textAlign = 'center';
            ctx2.fillText('Аудиоволна недоступна', waveformCanvas.width / 2, waveformCanvas.height / 2 + 4);
        }
    }

    function drawWaveform(currentTime) {
        if (!waveformCanvas || !waveAudioData) return;
        const W     = waveformCanvas.width;
        const H     = waveformCanvas.height;
        const mid   = H / 2;
        const playX = waveDuration > 0 ? Math.round(W * currentTime / waveDuration) : 0;
        const ctx   = waveformCanvas.getContext('2d');

        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, H);

        // Subtitle span highlights
        if (currentSubs && waveDuration > 0) {
            for (let si = 0; si < currentSubs.length; si++) {
                const s  = currentSubs[si];
                const x1 = Math.round(s.start / waveDuration * W);
                const x2 = Math.round(s.end   / waveDuration * W);
                ctx.fillStyle = si === selectedSubIdx
                    ? 'rgba(74,158,255,0.22)' : 'rgba(74,158,255,0.08)';
                ctx.fillRect(x1, 0, Math.max(2, x2 - x1), H);
            }
        }

        // Bars: 2px wide + 1px gap for a cleaner look
        const totalSamples = waveAudioData.length;
        const barW = 2, gap = 1;
        for (let x = 0; x < W; x += barW + gap) {
            const i0 = Math.floor(x / W * totalSamples);
            const i1 = Math.min(totalSamples, Math.floor((x + barW + gap) / W * totalSamples));
            let mn = 0, mx = 0, sumSq = 0;
            const count = Math.max(1, i1 - i0);
            for (let j = i0; j < i1; j++) {
                const v = waveAudioData[j];
                if (v < mn) mn = v;
                if (v > mx) mx = v;
                sumSq += v * v;
            }
            const rms   = Math.sqrt(sumSq / count);
            const peakH = Math.max(1, Math.round((mx - mn) / 2 * mid * 0.92));
            const rmsH  = Math.max(1, Math.round(rms * mid * 0.92));
            const played = x < playX;
            // Soft RMS glow layer
            ctx.fillStyle = played ? 'rgba(74,158,255,0.28)' : 'rgba(42,56,80,0.5)';
            ctx.fillRect(x, mid - rmsH, barW, rmsH * 2);
            // Sharp peak bar on top
            ctx.fillStyle = played ? '#4a9eff' : '#2a3a58';
            ctx.fillRect(x, mid - peakH, barW, peakH * 2);
        }

        // Center guide line
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(0, mid, W, 1);

        // Playhead with triangle indicator at top
        if (playX > 0 && playX < W) {
            ctx.fillStyle = 'rgba(255,255,255,0.88)';
            ctx.fillRect(playX - 1, 0, 2, H);
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(playX - 5, 0);
            ctx.lineTo(playX + 5, 0);
            ctx.lineTo(playX, 8);
            ctx.closePath();
            ctx.fill();
        }
    }

    // ── Selected subtitle info panel ──────────────────────────────────────────
    function updateSubInfoPanel() {
        if (!currentSubs || !currentSubs.length || !subSelEl) return;
        let sub, idx;
        if (selectedSubIdx >= 0 && selectedSubIdx < currentSubs.length) {
            idx = selectedSubIdx;
            sub = currentSubs[idx];
        } else {
            const t = vidPreview.currentTime;
            idx = currentSubs.findIndex(s => t >= s.start && t <= s.end);
            sub = idx >= 0 ? currentSubs[idx] : null;
        }
        if (!sub) { subSelEl.hidden = true; return; }
        subSelEl.hidden = false;
        if (subSelIdxEl) subSelIdxEl.textContent = idx + 1;
        if (subSelStartEl && document.activeElement !== subSelStartEl)
            subSelStartEl.value = srtTimeV(sub.start);
        if (subSelEndEl && document.activeElement !== subSelEndEl)
            subSelEndEl.value = srtTimeV(sub.end);
        if (subSelTextEl) subSelTextEl.textContent = sub.text;
    }

    if (subSelStartEl) {
        subSelStartEl.addEventListener('change', () => {
            const idx = selectedSubIdx >= 0 ? selectedSubIdx : -1;
            if (idx < 0 || !currentSubs || !currentSubs[idx]) return;
            const ns = parseSrtTime(subSelStartEl.value);
            if (!isFinite(ns)) return;
            currentSubs[idx].start = ns;
            renderVidSubEditor(currentSubs, null);
            updateOverlay();
            drawWaveform(vidPreview.currentTime);
        });
    }
    if (subSelEndEl) {
        subSelEndEl.addEventListener('change', () => {
            const idx = selectedSubIdx >= 0 ? selectedSubIdx : -1;
            if (idx < 0 || !currentSubs || !currentSubs[idx]) return;
            const ne = parseSrtTime(subSelEndEl.value);
            if (!isFinite(ne)) return;
            currentSubs[idx].end = ne;
            renderVidSubEditor(currentSubs, null);
            updateOverlay();
            drawWaveform(vidPreview.currentTime);
        });
    }

    renderVidSubEditor([], null);
    updateDownloadBtn();

    // ── Transcribe from video (Whisper) ───────────────────────────────────────
    vidTranscribeBtn && vidTranscribeBtn.addEventListener('click', async () => {
        if (!uploadedVideoName) { toast('Загрузите видео', 'warn'); return; }
        vidTranscribeBtn.disabled = true;
        if (vidTranscribeStatus) { vidTranscribeStatus.textContent = 'Подготовка…'; vidTranscribeStatus.className = 'status busy'; }

        const fd = new FormData();
        fd.append('video_name', uploadedVideoName);
        fd.append('language', vidTranscribeLang ? vidTranscribeLang.value : 'ru');

        await synthesizeStream(
            '/api/transcribe/video',
            { method: 'POST', body: fd },
            {
                progress(val, desc) {
                    if (vidTranscribeStatus) {
                        vidTranscribeStatus.textContent = 'Обработка…';
                        vidTranscribeStatus.className = 'status busy';
                    }
                },
                async done(payload) {
                    vidTranscribeBtn.disabled = false;
                    if (vidTranscribeStatus) { vidTranscribeStatus.textContent = '✓ Распознано'; vidTranscribeStatus.className = 'status ok'; }
                    if (payload.srt) {
                        const parsed = parseSRTContent(payload.srt);
                        // Auto-generate name
                        const now = new Date();
                        const p   = n => String(n).padStart(2,'0');
                        const autoName = `transcribe-${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
                        // Save to backend
                        try {
                            await postJSON('/api/subtitles', { name: autoName, content: payload.srt });
                            events.dispatchEvent(new CustomEvent('subtitles-changed'));
                            await refreshSRTList();
                            srtSel.setValue(autoName + '.srt', true);
                        } catch (_) {}
                        renderVidSubEditor(parsed, autoName + '.srt');
                        currentSubs = parsed;
                        updateOverlay();
                        toast('Субтитры распознаны: ' + autoName, 'ok');
                        log('Whisper (видео): субтитры распознаны', 'done');
                    }
                },
                error(msg) {
                    vidTranscribeBtn.disabled = false;
                    if (vidTranscribeStatus) { vidTranscribeStatus.textContent = msg; vidTranscribeStatus.className = 'status err'; }
                    toast(msg, 'err');
                },
            }
        );
    });

    // ── Template selector ─────────────────────────────────────────────────────
    const tmplApplyBtn = document.getElementById('vid-tmpl-apply-btn');
    const tmplMount    = document.getElementById('vid-tmpl-mount');

    const tmplSel = new CustomSelect(tmplMount, {
        placeholder: 'Шаблон стиля…',
    });

    async function refreshTemplateList() {
        try {
            const data = await getJSON('/api/templates');
            const opts = (data.templates || []).map(n => ({ value: n, label: n }));
            tmplSel.setOptions(opts);
        } catch (_) {}
    }
    await refreshTemplateList();
    events.addEventListener('template-changed', refreshTemplateList);

    tmplApplyBtn && tmplApplyBtn.addEventListener('click', async () => {
        const name = tmplSel.value;
        if (!name) { toast('Выберите шаблон', 'warn'); return; }
        try {
            const data = await getJSON(`/api/templates/${encodeURIComponent(name)}`);
            const s = data.settings || {};
            function setVal(id, val) {
                const el = document.getElementById(id);
                if (!el || val === undefined) return;
                el.value = val;
                el.dispatchEvent(new Event('input',  { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            function setCheck(id, val) {
                const el = document.getElementById(id);
                if (!el || val === undefined) return;
                el.checked = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            setVal('vid-font-family',    s.fontFamily);
            setVal('vid-font-size',      s.fontSize);
            setVal('vid-font-size-n',    s.fontSize);
            setVal('vid-font-color',     s.fontColor);
            function setFmt(id, val) {
                const el = document.getElementById(id);
                if (!el || val === undefined) return;
                el.classList.toggle('active', Boolean(val));
            }
            setFmt('vid-bold',      s.bold);
            setFmt('vid-italic',    s.italic);
            setFmt('vid-underline', s.underline);
            if (s.textAlign) {
                alignBtns.forEach(b => b.classList.remove('active'));
                const al = document.getElementById(`vid-align-${s.textAlign}`);
                if (al) al.classList.add('active');
            }
            setVal('vid-position',       s.position);
            setVal('vid-bg-opacity',     s.bgOpacity);
            setVal('vid-bg-opacity-n',   s.bgOpacity);
            setVal('vid-bg-color',       s.bgColor);
            setVal('vid-bg-pad-x',       s.bgPadX);
            setVal('vid-bg-pad-y',       s.bgPadY);
            setVal('vid-bg-radius',      s.bgRadius);
            setVal('vid-outline-size',   s.outlineSize);
            setVal('vid-outline-size-n', s.outlineSize);
            setVal('vid-outline-color',  s.outlineColor);
            setVal('vid-shadow-size',    s.shadowSize);
            setVal('vid-shadow-size-n',  s.shadowSize);
            setVal('vid-shadow-color',   s.shadowColor);
            setVal('vid-line-height',    s.lineHeight);
            setVal('vid-max-width',      s.maxWidth);
            setVal('vid-margin-v',       s.marginV);
            setVal('vid-karaoke-color',  s.karaokeColor);
            setCheck('vid-karaoke-enable', s.karaokeEnabled);
            if (s.posX)      setVal('vid-pos-x',      s.posX);
            if (s.posY)      setVal('vid-pos-y',      s.posY);
            if (s.subWidth)  setVal('vid-sub-width',  s.subWidth);
            if (s.subHeight) setVal('vid-sub-height', s.subHeight);
            applySubStyle();
            toast('Шаблон применён: ' + name, 'ok');
        } catch (e) {
            toast('Ошибка применения шаблона: ' + e.message, 'err');
        }
    });

    // ── Save current style as template ────────────────────────────────────────
    const saveStyleBtn = document.getElementById('vid-save-style-btn');
    saveStyleBtn && saveStyleBtn.addEventListener('click', async () => {
        const name = await openPrompt({ title: 'Сохранить стиль как шаблон', placeholder: 'Название шаблона…' });
        if (!name || !name.trim()) return;
        // Auto-version if name already taken
        let finalName = name.trim();
        try {
            const existing = await getJSON('/api/templates');
            const taken = new Set(existing.templates || []);
            if (taken.has(finalName)) {
                let v = 2;
                while (taken.has(`${name.trim()}_v${v}`)) v++;
                finalName = `${name.trim()}_v${v}`;
            }
        } catch (_) {}
        const g = id => document.getElementById(id);
        const settings = {
            fontFamily:     (g('vid-font-family')    || {}).value   || 'Arial',
            fontSize:       (g('vid-font-size-n')    || {}).value   || '24',
            fontColor:      (g('vid-font-color')     || {}).value   || '#ffffff',
            bold:           g('vid-bold')?.classList.contains('active')       || false,
            italic:         g('vid-italic')?.classList.contains('active')     || false,
            underline:      g('vid-underline')?.classList.contains('active')  || false,
            textAlign:      [...alignBtns].find(b => b.classList.contains('active'))?.dataset.align || 'center',
            position:       (g('vid-position')       || {}).value   || 'bottom',
            posX:           (g('vid-pos-x')          || {}).value   || '',
            posY:           (g('vid-pos-y')          || {}).value   || '',
            subWidth:       (g('vid-sub-width')      || {}).value   || '',
            subHeight:      (g('vid-sub-height')     || {}).value   || '',
            bgOpacity:      (g('vid-bg-opacity-n')   || {}).value   || '50',
            bgColor:        (g('vid-bg-color')       || {}).value   || '#000000',
            bgPadX:         (g('vid-bg-pad-x')       || {}).value   || '12',
            bgPadY:         (g('vid-bg-pad-y')       || {}).value   || '6',
            bgRadius:       (g('vid-bg-radius')      || {}).value   || '4',
            outlineSize:    (g('vid-outline-size-n') || {}).value   || '1',
            outlineColor:   (g('vid-outline-color')  || {}).value   || '#000000',
            shadowSize:     (g('vid-shadow-size-n')  || {}).value   || '0',
            shadowColor:    (g('vid-shadow-color')   || {}).value   || '#000000',
            lineHeight:     (g('vid-line-height')    || {}).value   || '1.35',
            maxWidth:       (g('vid-max-width')      || {}).value   || '90',
            marginV:        (g('vid-margin-v')       || {}).value   || '10',
            karaokeColor:   (g('vid-karaoke-color')  || {}).value   || '#ffdd00',
            karaokeEnabled: (g('vid-karaoke-enable') || {}).checked || false,
        };
        try {
            await postJSON('/api/templates', { name: finalName, settings });
            toast('Шаблон сохранён: ' + finalName, 'ok');
            events.dispatchEvent(new CustomEvent('template-changed'));
            await refreshTemplateList();
        } catch (err) {
            toast('Ошибка: ' + err.message, 'err');
        }
    });

    // ── Restore subtitles from history ────────────────────────────────────────
    events.addEventListener('srt-restore', (e) => {
        const { content, filename } = e.detail || {};
        if (!content) return;
        const parsed = parseSRTContent(content);
        renderVidSubEditor(parsed, filename || null);
        currentSubs = parsed;
        updateOverlay();
        toast('Субтитры загружены из истории', 'ok');
    });
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
