import { getJSON, synthesizeStream } from '../api.js';
import { FileUpload } from '../file-upload.js';
import { CustomSelect } from '../custom-select.js';
import { log } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';

export async function init() {
    // ── Elements ──────────────────────────────────────────────────────────────
    const ffWarn       = document.getElementById('ff-ffmpeg-warn');
    const vidInner     = document.getElementById('ff-vid-inner');
    const vidEmpty     = document.getElementById('ff-vid-empty');
    const preview      = document.getElementById('ff-preview');
    const overlay      = document.getElementById('ff-sub-overlay');
    const statusEl     = document.getElementById('ff-status');
    const goBtn        = document.getElementById('ff-go');
    const exportBlock  = document.getElementById('ff-export-block');
    const dlBtn        = document.getElementById('ff-download-btn');
    const progressWrap = document.getElementById('ff-progress-wrap');
    const progressFill = document.getElementById('ff-progress-fill');
    const progressPct  = document.getElementById('ff-progress-pct');
    const ffLog        = document.getElementById('ff-ffmpeg-log');

    // Style controls
    const fontFamilyEl = document.getElementById('ff-font-family');
    const fontSizeEl   = document.getElementById('ff-font-size');
    const fontColorEl  = document.getElementById('ff-font-color');
    const boldEl       = document.getElementById('ff-bold');
    const positionEl   = document.getElementById('ff-position');
    const marginVEl    = document.getElementById('ff-margin-v');
    const maxWidthEl   = document.getElementById('ff-max-width');
    const bgOpacityEl  = document.getElementById('ff-bg-opacity');
    const bgColorEl    = document.getElementById('ff-bg-color');
    const bgPadXEl     = document.getElementById('ff-bg-pad-x');
    const bgPadYEl     = document.getElementById('ff-bg-pad-y');
    const outlineSzEl  = document.getElementById('ff-outline-size');
    const outlineClEl  = document.getElementById('ff-outline-color');
    const shadowSzEl   = document.getElementById('ff-shadow-size');
    const shadowClEl   = document.getElementById('ff-shadow-color');
    const subWidthEl   = document.getElementById('ff-sub-width');
    const subHeightEl  = document.getElementById('ff-sub-height');

    // ── State ─────────────────────────────────────────────────────────────────
    let uploadedVideoName = null;
    let currentSubs       = null;
    let videoNatW         = 0;
    let videoNatH         = 0;

    // ── FFmpeg availability check ─────────────────────────────────────────────
    try {
        const s = await getJSON('/api/video/ffmpeg-status');
        if (!s.available && ffWarn) ffWarn.style.display = '';
    } catch (_) {}

    // ── Style controls → live preview ─────────────────────────────────────────
    [fontFamilyEl, fontSizeEl, fontColorEl, boldEl, positionEl, marginVEl, maxWidthEl,
     bgOpacityEl, bgColorEl, bgPadXEl, bgPadYEl,
     outlineSzEl, outlineClEl, shadowSzEl, shadowClEl,
     subWidthEl, subHeightEl]
        .forEach(el => el && el.addEventListener('input', applySubStyle));
    [fontFamilyEl, positionEl]
        .forEach(el => el && el.addEventListener('change', applySubStyle));

    // ── Video upload ──────────────────────────────────────────────────────────
    new FileUpload(document.getElementById('ff-vid-upload-mount'), {
        accept: 'video/*',
        label: 'Перетащи или выбери видео файл',
        hint: 'MP4, MKV, AVI, MOV, WebM',
        async onChange(file) {
            if (!file) {
                uploadedVideoName = null;
                vidInner.style.display = 'none';
                vidEmpty.style.display = '';
                overlay.textContent = '';
                videoNatW = videoNatH = 0;
                return;
            }
            const fd = new FormData();
            fd.append('file', file);
            try {
                statusEl.textContent = 'Загрузка видео…';
                statusEl.className   = 'status busy';
                const r    = await fetch('/api/video/upload', { method: 'POST', body: fd });
                if (!r.ok) throw new Error(await r.text());
                const data = await r.json();
                uploadedVideoName = data.name;
                preview.src = data.url;
                exportBlock.hidden = true;
                statusEl.textContent = '✓ Видео загружено: ' + data.name;
                statusEl.className   = 'status ok';
                toast('Видео загружено', 'ok');
            } catch (e) {
                statusEl.textContent = '❌ ' + e.message;
                statusEl.className   = 'status err';
                toast('Ошибка загрузки видео: ' + e.message, 'err');
            }
        },
    });

    preview.addEventListener('loadedmetadata', () => {
        const { videoWidth: vw, videoHeight: vh } = preview;
        if (!vw || !vh) return;
        videoNatW = vw;
        videoNatH = vh;
        vidInner.style.aspectRatio = `${vw} / ${vh}`;
        vidInner.style.display     = 'block';
        vidEmpty.style.display     = 'none';
    });

    // ── SRT selector ─────────────────────────────────────────────────────────
    const srtSel = new CustomSelect(document.getElementById('ff-srt-mount'), {
        placeholder: 'Выберите SRT файл…',
        async onChange(val) {
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

    // ── Load SRT for overlay preview ──────────────────────────────────────────
    async function loadSRTForOverlay(name) {
        if (!name) { currentSubs = null; overlay.textContent = ''; return; }
        try {
            const r = await getJSON(`/api/subtitles/${encodeURIComponent(name)}`);
            currentSubs = parseSRTContent(r.content);
        } catch (_) { currentSubs = null; }
        updateOverlay();
    }

    function updateOverlay() {
        if (!currentSubs) { overlay.textContent = ''; applySubStyle(); return; }
        const t   = preview.currentTime;
        const sub = currentSubs.find(s => t >= s.start && t <= s.end);
        if (!sub) { overlay.textContent = ''; applySubStyle(); return; }
        overlay.textContent = sub.text;
        applySubStyle();
    }

    preview.addEventListener('timeupdate', updateOverlay);
    applySubStyle();

    // ── Style application ─────────────────────────────────────────────────────
    function applySubStyle() {
        const fontSize     = parseFloat(fontSizeEl.value)  || 24;
        const fontFamily   = fontFamilyEl.value;
        const textColor    = fontColorEl.value;
        const bold         = boldEl.checked;
        const bgOpacity    = parseFloat(bgOpacityEl.value) || 0;
        const bgColor      = bgColorEl.value;
        const padX         = parseFloat(bgPadXEl.value)    || 0;
        const padY         = parseFloat(bgPadYEl.value)    || 0;
        const outlineSize  = parseFloat(outlineSzEl.value) || 0;
        const outlineColor = outlineClEl.value;
        const shadowSize   = parseFloat(shadowSzEl.value)  || 0;
        const shadowColor  = shadowClEl.value;
        const maxW         = parseFloat(maxWidthEl.value)  || 90;
        const marginV      = parseFloat(marginVEl.value)   || 10;
        const subW         = parseFloat(subWidthEl.value)  || 0;
        const subH         = parseFloat(subHeightEl.value) || 0;

        overlay.style.fontSize    = fontSize + 'px';
        overlay.style.fontFamily  = `"${fontFamily}", sans-serif`;
        overlay.style.color       = textColor;
        overlay.style.fontWeight  = bold ? '700' : '400';
        overlay.style.wordSpacing = '0.2em';
        overlay.style.textShadow  = makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor);

        if (subW > 0) {
            overlay.style.width    = subW + 'px';
            overlay.style.maxWidth = 'none';
        } else {
            overlay.style.width    = '';
            overlay.style.maxWidth = maxW + '%';
        }

        if (subH > 0) {
            overlay.style.minHeight      = subH + 'px';
            overlay.style.display        = 'flex';
            overlay.style.flexDirection  = 'row';
            overlay.style.alignItems     = 'center';
            overlay.style.justifyContent = 'center';
        } else {
            overlay.style.minHeight      = '';
            overlay.style.display        = '';
            overlay.style.flexDirection  = '';
            overlay.style.alignItems     = '';
            overlay.style.justifyContent = '';
        }

        overlay.style.backgroundColor = bgOpacity > 0 ? hexToRgba(bgColor, bgOpacity) : 'transparent';
        overlay.style.padding         = bgOpacity > 0 ? `${padY}px ${padX}px` : '0';
        overlay.style.borderRadius    = bgOpacity > 0 ? '4px' : '0';

        const marginVPct = videoNatH > 0 ? (marginV / videoNatH * 100) : 2;
        overlay.style.left   = '50%';
        overlay.style.right  = '';
        overlay.style.top    = '';
        overlay.style.bottom = '';
        switch (positionEl.value) {
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

        if (overlay.textContent.trim()) {
            overlay.style.whiteSpace = 'nowrap';
            overlay.style.whiteSpace = overlay.scrollWidth > overlay.offsetWidth ? 'pre-wrap' : 'nowrap';
        }
    }

    // ── Burn button ───────────────────────────────────────────────────────────
    goBtn.addEventListener('click', async () => {
        const srtName = srtSel.value;
        if (!uploadedVideoName) { toast('Загрузите видео', 'warn'); return; }
        if (!srtName)           { toast('Выберите SRT файл', 'warn'); return; }

        goBtn.disabled = true;
        exportBlock.hidden = true;
        progressWrap.hidden = false;
        progressFill.style.width = '3%';
        progressPct.textContent  = '3%';
        ffLog.textContent = '';
        statusEl.textContent = 'Подготовка…';
        statusEl.className   = 'status busy';

        const fd = new FormData();
        fd.append('video_name',    uploadedVideoName);
        fd.append('srt_name',      srtName);
        fd.append('font_family',   fontFamilyEl.value);
        fd.append('font_size',     fontSizeEl.value);
        fd.append('font_color',    fontColorEl.value.replace('#', ''));
        fd.append('bold',          String(boldEl.checked));
        fd.append('position',      positionEl.value);
        fd.append('bg_opacity',    bgOpacityEl.value);
        fd.append('bg_color',      bgColorEl.value.replace('#', ''));
        fd.append('bg_pad_x',      bgPadXEl.value);
        fd.append('bg_pad_y',      bgPadYEl.value);
        fd.append('outline_size',  outlineSzEl.value);
        fd.append('outline_color', outlineClEl.value.replace('#', ''));
        fd.append('shadow_size',   shadowSzEl.value);
        fd.append('shadow_color',  shadowClEl.value.replace('#', ''));
        fd.append('output_format', '');
        fd.append('output_width',  '0');
        fd.append('output_height', '0');
        fd.append('resize_mode',   'pad');
        fd.append('max_width_pct', maxWidthEl.value);
        fd.append('margin_v',      marginVEl.value);
        fd.append('sub_width_px',  subWidthEl.value);
        fd.append('sub_height_px', subHeightEl.value);
        fd.append('pos_x_px',      '');
        fd.append('pos_y_px',      '');

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
                        const pretty = parseFfDesc(desc);
                        if (pretty) statusEl.textContent = pretty;
                        appendLog(desc);
                    }
                },
                done(payload) {
                    goBtn.disabled = false;
                    progressFill.style.width = '100%';
                    progressPct.textContent  = '100%';
                    statusEl.textContent = '✓ Готово! Видео с субтитрами создано.';
                    statusEl.className   = 'status ok';

                    preview.src = payload.video_url + '?t=' + Date.now();
                    vidInner.style.display = 'block';
                    vidEmpty.style.display = 'none';

                    dlBtn.href = payload.video_url;
                    dlBtn.setAttribute('download', payload.filename);
                    dlBtn.onclick = null;
                    exportBlock.hidden = false;

                    toast('Видео обработано!', 'ok');
                    log('FFmpeg: ' + payload.filename, 'done');
                },
                error(msg) {
                    goBtn.disabled = false;
                    statusEl.textContent = msg;
                    statusEl.className   = 'status err';
                    progressFill.style.width = '0%';
                    progressPct.textContent  = '0%';
                    toast(msg, 'err');
                    log(msg, 'err');
                    appendLog('ERROR: ' + msg);
                },
            }
        );
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    function appendLog(line) {
        const d = document.createElement('div');
        d.textContent = line;
        ffLog.appendChild(d);
        ffLog.scrollTop = ffLog.scrollHeight;
    }

    function parseFfDesc(raw) {
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
            return 'FFmpeg: ' + parts.join('  ·  ');
        }
        return '';
    }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function parseSRTContent(content) {
    return content.trim().split(/\n\s*\n/).map((block, i) => {
        const lines    = block.trim().split('\n');
        const timeLine = lines.find(l => l.includes('-->'));
        if (!timeLine) return null;
        const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
        const textLines = lines.slice(lines.indexOf(timeLine) + 1);
        return {
            index: i + 1,
            start: parseSrtTime(startStr),
            end:   parseSrtTime(endStr),
            text:  textLines.join('\n').trim(),
        };
    }).filter(Boolean);
}

function parseSrtTime(str) {
    const [hms, ms = '0'] = str.trim().replace('.', ',').split(',');
    const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + parseInt(ms, 10) / 1000;
}

function hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity / 100})`;
}

function makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor) {
    const parts = [];
    if (outlineSize > 0) {
        const sz = outlineSize, c = outlineColor;
        parts.push(
            `${-sz}px ${-sz}px 0 ${c}`, `${sz}px ${-sz}px 0 ${c}`,
            `${-sz}px  ${sz}px 0 ${c}`, `${sz}px  ${sz}px 0 ${c}`,
            `0 ${-sz}px 0 ${c}`, `0 ${sz}px 0 ${c}`,
            `${-sz}px 0 0 ${c}`, `${sz}px 0 0 ${c}`,
        );
    }
    if (shadowSize > 0) {
        const blur = Math.ceil(shadowSize / 2);
        parts.push(`${shadowSize}px ${shadowSize}px ${blur}px ${shadowColor}`);
    }
    return parts.join(', ');
}
