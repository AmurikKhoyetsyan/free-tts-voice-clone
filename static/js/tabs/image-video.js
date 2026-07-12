import { log }             from '../logger.js';
import { toast }           from '../toast.js';
import { synthesizeStream } from '../api.js';
import { openConfirm, openPrompt } from '../modal.js';
import { ICONS }           from '../icons.js';
import { events }          from '../events.js';

import { TRANSITIONS, EFFECTS_DEF, FONTS, ANIMS, START_EFFECTS, END_EFFECTS } from '../imgvid/constants.js';
import { uid, eh, fmt, fmtShort, buildCSSFilter, hexToRgba, _makeTextShadow, getSnapTargets, snap } from '../imgvid/utils.js';
import { totalDur as _totalDurFn, clipAtTime as _clipAtTimeFn } from '../imgvid/utils.js';
import { drawWaveform, probeAudioDuration } from '../imgvid/waveform.js';

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
    projectId: null, projectName: 'Новый проект',
    clips: [], audioTracks: [], subtitles: [],
    selIdx: -1, selAudioIdx: -1, selSubIdx: -1, selPipIdx: -1, selIdxs: new Set(),
    selSubIdxs: new Set(), selPipIdxs: new Set(), selAudioIdxs: new Set(),
    activeTab: 'slide', dirty: false,
    // Playback
    currentTime: 0, isPlaying: false,
    _playStartReal: 0, _playStartProject: 0, _rafId: null, _syncTick: 0,
    // Timeline
    pxPerSec: 80,
    // Preview zoom
    previewMode: 'fit',   // 'fit' | 'original' | 'custom'
    previewZoom: 1.0,     // actual CSS scale factor
    // PIP layers
    pipLayers: [],
    // Preview dimensions (set by _updatePreviewSize, used for subtitle scaling)
    previewH: 0, previewW: 0,
    // Template edit mode
    isTemplateMode: false, editingTemplateId: null,
};

// ── Undo/Redo history ────────────────────────────────────────────────────────
const _historyStack = [];
let _historyIdx = -1;

// ── Audio element pool ────────────────────────────────────────────────────────
const _audioEls = new Map(); // trackId → HTMLAudioElement

function _syncAudio(t, force = false) {
    const allIds = new Set(S.audioTracks.map(x => x.id));
    // Prune removed tracks
    for (const [id, el] of _audioEls) {
        if (!allIds.has(id)) { el.pause(); _audioEls.delete(id); }
    }
    for (const track of S.audioTracks) {
        let el = _audioEls.get(track.id);
        if (!el) {
            el = new Audio(track.fileUrl);
            el.volume = Math.max(0, Math.min(1, track.volume ?? 1));
            _audioEls.set(track.id, el);
        } else {
            el.volume = Math.max(0, Math.min(1, track.volume ?? 1));
        }
        const speed = track.speed ?? 1;
        if (el.playbackRate !== speed) el.playbackRate = speed;
        const trackT = t - (track.startOffset || 0);
        if (trackT < 0) { if (!el.paused) el.pause(); continue; }
        if (track.duration !== undefined && trackT >= track.duration) { if (!el.paused) el.pause(); continue; }
        if (force || Math.abs(el.currentTime - trackT) > 0.3) {
            el.currentTime = Math.max(0, trackT + (track.trimIn || 0));
        }
        if (S.isPlaying && el.paused) el.play().catch(() => {});
        if (!S.isPlaying && !el.paused) el.pause();
    }
}

function _pauseAllAudio() {
    for (const el of _audioEls.values()) el.pause();
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function init() {
    const $ = id => document.getElementById(id);

    // Wrappers so existing code that calls totalDur() / clipAtTime(t) / _snap / _getSnapTargets still works
    const totalDur = () => _totalDurFn(S.clips);
    const clipAtTime = (t) => _clipAtTimeFn(S.clips, t);
    const _getSnapTargets = (excludeIdx, type) => getSnapTargets(S, excludeIdx, type);
    const _snap = snap;
    const _probeAudioDuration = probeAudioDuration;

    const section       = document.querySelector('[data-panel="imgvid"]');
    const newBtn        = $('ive-new-btn');
    const addImgBtn     = $('ive-add-images-btn');
    const addVideoBtn   = $('ive-add-video-btn');
    const addAudioBtn   = $('ive-add-audio-btn');
    const imgInput      = $('ive-image-input');
    const videoInput    = $('ive-video-input');
    const audioInput    = $('ive-audio-input');
    const globalDurEl   = $('ive-global-dur');
    const applyDurBtn   = $('ive-apply-dur-btn');
    const projectNameEl = $('ive-project-name');
    const saveBtn       = $('ive-save-btn');
    const exportBtn     = $('ive-export-btn');
    const exportProg    = $('ive-export-progress');
    const exportStatus  = $('ive-export-status');
    const progFill      = $('ive-prog-fill');
    const progPct       = $('ive-prog-pct');
    // Preview
    const previewWrap   = $('ive-preview-inner').parentElement;
    const previewInner  = $('ive-preview-inner');
    const previewContent= $('ive-preview-content');
    const previewImg    = $('ive-preview-img');
    const previewVideo  = $('ive-preview-video');
    const previewEmpty  = $('ive-preview-empty');
    const subContainer  = $('ive-sub-container');
    const subOverlay    = $('ive-sub-overlay');
    // Transport
    const goStart       = $('ive-go-start');
    const rewindBtn     = $('ive-rewind-btn');
    const playPauseBtn  = $('ive-playpause-btn');
    const stopBtn       = $('ive-stop-btn');
    const fwdBtn        = $('ive-fwd-btn');
    const goEnd         = $('ive-go-end');
    const seekBar       = $('ive-seek-bar');
    const curTime       = $('ive-cur-time');
    const totTime       = $('ive-tot-time');
    // Zoom
    const zoomMode      = $('ive-zoom-mode');
    const zoomDisplay   = $('ive-zoom-display');
    const zoomPct       = $('ive-zoom-pct');
    const zoomSign      = $('ive-zoom-sign');
    const resEl         = $('ive-exp-res');
    const resWEl        = document.getElementById('ive-exp-res-w');
    const resHEl        = document.getElementById('ive-exp-res-h');
    const resXEl        = document.getElementById('ive-exp-res-x');
    // Timeline
    const totalDurEl    = $('ive-total-dur');
    const videoTrackEl  = $('ive-video-track');
    const audioTrackEl  = $('ive-audio-track');
    const subTrackEl    = $('ive-subtitle-track');
    const pipTrackEl    = $('ive-pip-track');
    const tracksScroll  = $('ive-tracks-scroll');
    const tracksInner   = $('ive-tracks-inner');
    const playheadEl    = $('ive-playhead');
    const timeRulerEl   = $('ive-time-ruler');
    const audioLblEl    = $('ive-audio-lbl');
    const propsBody     = $('ive-props-body');
    // Transition preview elements
    const previewContentNext = $('ive-preview-content-next');
    const previewImgNext     = $('ive-preview-img-next');
    const previewVideoNext   = $('ive-preview-video-next');
    const transOverlayEl     = $('ive-trans-overlay');
    // PIP
    const addPipBtn   = $('ive-add-pip-btn');
    const pipInput    = $('ive-pip-input');

    // .amur buttons
    const saveAmurBtn        = $('ive-save-amur-btn');
    const openAmurBtn        = $('ive-open-amur-btn');
    // .amur dialog elements (outside of tab section, use document.getElementById)
    const amurModal          = document.getElementById('modal-amur');
    const amurTitle          = document.getElementById('modal-amur-title');
    const amurDirInput       = document.getElementById('modal-amur-dir');
    const amurDirGo          = document.getElementById('modal-amur-dir-go');
    const amurFilenameRow    = document.getElementById('modal-amur-filename-row');
    const amurFilenameInput  = document.getElementById('modal-amur-filename');
    const amurFilesEl        = document.getElementById('modal-amur-files');
    const amurUploadRow      = document.getElementById('modal-amur-upload-row');
    const amurUploadInput    = document.getElementById('modal-amur-upload-input');
    const amurCancelBtn      = document.getElementById('modal-amur-cancel');
    const amurOkBtn          = document.getElementById('modal-amur-ok');

    // PIP element pool: pip.id → { wrapper, img, video }
    const _pipEls = new Map();

    let _amurMode = 'save';
    let _amurResolve = null;

    async function _amurBrowse(dir) {
        const q = dir ? '?path=' + encodeURIComponent(dir) : '';
        try {
            const r = await fetch('/api/imgvid/project/browse' + q);
            const d = await r.json();
            amurDirInput.value = d.dir;
            const _esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            amurFilesEl.innerHTML = d.files.length
                ? d.files.map(f =>
                    `<div class="amur-file-row" data-path="${_esc(f.path)}" data-name="${_esc(f.name)}"
                        style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px">
                        <span>${_esc(f.name)}</span>
                        <span style="color:var(--text-muted);font-size:11px">${(f.size/1024).toFixed(1)} KB</span>
                    </div>`).join('')
                : '<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:12px">Нет .project файлов</div>';
            amurFilesEl.querySelectorAll('.amur-file-row').forEach(el => {
                el.addEventListener('mouseenter', () => el.style.background = 'var(--surface-hover, rgba(0,0,0,0.05))');
                el.addEventListener('mouseleave', () => { if (!el.classList.contains('selected')) el.style.background = ''; });
                el.addEventListener('click', () => {
                    if (_amurMode === 'load') {
                        amurModal.hidden = true;
                        _amurResolve?.({ type: 'path', path: el.dataset.path });
                    } else {
                        amurFilesEl.querySelectorAll('.amur-file-row').forEach(r => {
                            r.classList.remove('selected'); r.style.background = '';
                        });
                        el.classList.add('selected');
                        el.style.background = 'var(--primary-light, rgba(59,130,246,0.1))';
                        amurFilenameInput.value = el.dataset.name;
                    }
                });
            });
        } catch (e) { toast('Ошибка обзора папки: ' + e.message, 'err'); }
    }

    async function _openSaveAmurDialog(projectName) {
        _amurMode = 'save';
        amurTitle.textContent = 'Сохранить проект как .project';
        amurFilenameRow.hidden = false;
        amurUploadRow.hidden = true;
        amurOkBtn.textContent = 'Сохранить';
        amurUploadInput.value = '';
        await _amurBrowse('');
        amurFilenameInput.value = (projectName || 'project').replace(/[^\wа-яА-Я\-]/g, '_') + '.project';
        amurModal.hidden = false;
        amurFilenameInput.focus();
        return new Promise(resolve => { _amurResolve = resolve; });
    }

    async function _openLoadAmurDialog() {
        _amurMode = 'load';
        amurTitle.textContent = 'Открыть проект .project';
        amurFilenameRow.hidden = true;
        amurUploadRow.hidden = false;
        amurOkBtn.textContent = 'Открыть';
        amurUploadInput.value = '';
        await _amurBrowse('');
        amurModal.hidden = false;
        return new Promise(resolve => { _amurResolve = resolve; });
    }

    amurDirGo.addEventListener('click', () => _amurBrowse(amurDirInput.value));
    amurDirInput.addEventListener('keydown', e => { if (e.key === 'Enter') _amurBrowse(amurDirInput.value); });
    amurCancelBtn.addEventListener('click', () => { amurModal.hidden = true; _amurResolve?.(null); });
    amurOkBtn.addEventListener('click', () => {
        if (_amurMode === 'save') {
            const fname = amurFilenameInput.value.trim();
            if (!fname) { toast('Введите имя файла', 'err'); return; }
            amurModal.hidden = true;
            _amurResolve?.({ type: 'save', dir: amurDirInput.value, filename: fname });
        } else {
            toast('Нажмите на файл из списка или загрузите файл', 'warn');
        }
    });
    amurUploadInput.addEventListener('change', () => {
        const file = amurUploadInput.files[0];
        if (file) { amurModal.hidden = true; _amurResolve?.({ type: 'file', file }); }
    });

    // ── New project ───────────────────────────────────────────────────────────
    newBtn.addEventListener('click', async () => {
        if (S.dirty && !confirm('Несохранённые изменения. Создать новый проект?')) return;
        _stopPlayback(); _resetState(); renderAll(); await loadProjectsList();
    });
    projectNameEl.addEventListener('input', () => { S.projectName = projectNameEl.value; S.dirty = true; });

    // ── Media upload ──────────────────────────────────────────────────────────
    addImgBtn.addEventListener('click', () => imgInput.click());
    addVideoBtn.addEventListener('click', () => videoInput.click());
    addAudioBtn.addEventListener('click', () => audioInput.click());
    imgInput.addEventListener('change',  () => { if (imgInput.files.length)   _uploadImages([...imgInput.files]);  imgInput.value  = ''; });
    videoInput.addEventListener('change',() => { if (videoInput.files.length) _uploadClips([...videoInput.files]); videoInput.value = ''; });
    audioInput.addEventListener('change',() => { if (audioInput.files.length) _uploadAudio(audioInput.files[0]);  audioInput.value = ''; });

    previewInner.addEventListener('dragover',  e => { e.preventDefault(); previewInner.classList.add('ive-drag-over'); });
    previewInner.addEventListener('dragleave', () => previewInner.classList.remove('ive-drag-over'));
    previewInner.addEventListener('drop', e => {
        e.preventDefault(); previewInner.classList.remove('ive-drag-over');
        const files = [...(e.dataTransfer.files || [])];
        const imgs = files.filter(f => /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
        const vids = files.filter(f => /\.(mp4|mov|mkv|webm|avi)$/i.test(f.name));
        const auds = files.filter(f => /\.(mp3|wav|aac|flac|ogg)$/i.test(f.name));
        if (imgs.length) _uploadImages(imgs);
        if (vids.length) _uploadClips(vids);
        auds.forEach(f => _uploadAudio(f));
    });

    applyDurBtn.addEventListener('click', () => {
        const d = parseFloat(globalDurEl.value);
        if (!isFinite(d) || d < 0.5) return;
        S.clips.filter(c => c.type === 'image').forEach(c => { c.duration = d; });
        S.dirty = true; renderAll();
    });

    // ── Transport controls ────────────────────────────────────────────────────
    goStart.addEventListener('click',      () => _seek(0));
    rewindBtn.addEventListener('click',    () => _seek(S.currentTime - 5));
    playPauseBtn.addEventListener('click', _togglePlay);
    stopBtn.addEventListener('click',      () => { _stopPlayback(); _seek(0); });
    fwdBtn.addEventListener('click',    () => _seek(S.currentTime + 5));
    goEnd.addEventListener('click',     () => _seek(totalDur()));

    seekBar.addEventListener('input', () => {
        _seek((parseFloat(seekBar.value) / 10000) * totalDur());
    });

    // ── Preview zoom ──────────────────────────────────────────────────────────
    zoomMode.addEventListener('change', () => {
        const mode = zoomMode.value;
        if (mode === 'custom') {
            _applyZoom('custom', parseFloat(zoomPct.value) || 100);
        } else {
            _applyZoom(mode, 100);
        }
    });

    zoomPct.addEventListener('input', () => {
        if (S.previewMode === 'custom') {
            previewContent.style.transformOrigin = '';  // center for manual input
            _applyZoom('custom', parseFloat(zoomPct.value) || 100);
        }
    });

    // Ctrl+Scroll on preview = cursor-relative zoom
    previewInner.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newPct = Math.round(Math.max(10, Math.min(800, (S.previewZoom * 100) * factor)));

        // Determine cursor position in unscaled content space so we can pivot there
        const rect     = previewContent.getBoundingClientRect();
        const contentW = previewContent.offsetWidth  || 640;
        const contentH = previewContent.offsetHeight || 360;
        const screenX  = e.clientX - rect.left;
        const screenY  = e.clientY - rect.top;
        const logicalX = screenX / S.previewZoom;
        const logicalY = screenY / S.previewZoom;
        const pctX = Math.max(0, Math.min(100, (logicalX / contentW) * 100));
        const pctY = Math.max(0, Math.min(100, (logicalY / contentH) * 100));

        // Set pivot before scaling so the point under cursor stays fixed
        previewContent.style.transformOrigin = `${pctX.toFixed(2)}% ${pctY.toFixed(2)}%`;
        _applyZoom('custom', newPct);
        zoomMode.value = 'custom';
    }, { passive: false });

    // ── Subtitle overlay: text element + resize handles (created once) ────────
    const subTextEl = document.createElement('span');
    subTextEl.className = 'ive-sub-text-inner';
    subOverlay.appendChild(subTextEl);
    subOverlay._textEl = subTextEl;

    const subRhE  = document.createElement('div');
    subRhE.className  = 'ive-sub-rh ive-sub-rh-e';
    subRhE.title = 'Изменить ширину';
    const subRhS  = document.createElement('div');
    subRhS.className  = 'ive-sub-rh ive-sub-rh-s';
    subRhS.title = 'Изменить высоту';
    const subRhSE = document.createElement('div');
    subRhSE.className = 'ive-sub-rh ive-sub-rh-se';
    subRhSE.title = 'Изменить ширину и высоту';
    subOverlay.appendChild(subRhE);
    subOverlay.appendChild(subRhS);
    subOverlay.appendChild(subRhSE);

    subRhE.addEventListener('mousedown', e => {
        const sub = S.subtitles[S.selSubIdx]; if (!sub) return;
        e.stopPropagation(); e.preventDefault();
        const rect = previewContent.getBoundingClientRect();
        const sx = e.clientX;
        const w0 = sub.w > 0 ? sub.w : 50;
        if (!(sub.w > 0)) sub.w = 50;
        let moved = false;
        const onMove = ev => {
            moved = true;
            const dx = (ev.clientX - sx) / rect.width * 100;
            sub.w = Math.max(5, Math.min(100, Math.round((w0 + 2 * dx) * 10) / 10));
            S.dirty = true; renderPreview(); if (S.selSubIdx >= 0) renderProps();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            if (moved) _pushHistory();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    subRhS.addEventListener('mousedown', e => {
        const sub = S.subtitles[S.selSubIdx]; if (!sub) return;
        e.stopPropagation(); e.preventDefault();
        const _resPH = parseInt((resEl?.value || '1920x1080').split('x')[1] || 1080, 10);
        const sc = (previewContent.clientHeight || _resPH) / _resPH;
        const sy = e.clientY;
        const h0 = sub.h > 0 ? sub.h : 80;
        if (!(sub.h > 0)) sub.h = 80;
        let moved = false;
        const onMove = ev => {
            moved = true;
            const dy = (ev.clientY - sy) / sc;
            sub.h = Math.max(10, Math.round(h0 + 2 * dy));
            S.dirty = true; renderPreview(); if (S.selSubIdx >= 0) renderProps();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            if (moved) _pushHistory();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    subRhSE.addEventListener('mousedown', e => {
        const sub = S.subtitles[S.selSubIdx]; if (!sub) return;
        e.stopPropagation(); e.preventDefault();
        const rect = previewContent.getBoundingClientRect();
        const _resPH = parseInt((resEl?.value || '1920x1080').split('x')[1] || 1080, 10);
        const sc = (previewContent.clientHeight || _resPH) / _resPH;
        const sx = e.clientX, sy = e.clientY;
        const w0 = sub.w > 0 ? sub.w : 50;
        const h0 = sub.h > 0 ? sub.h : 80;
        if (!(sub.w > 0)) sub.w = 50;
        if (!(sub.h > 0)) sub.h = 80;
        let moved = false;
        const onMove = ev => {
            moved = true;
            const dx = (ev.clientX - sx) / rect.width * 100;
            const dy = (ev.clientY - sy) / sc;
            sub.w = Math.max(5, Math.min(100, Math.round((w0 + 2 * dx) * 10) / 10));
            sub.h = Math.max(10, Math.round(h0 + 2 * dy));
            S.dirty = true; renderPreview(); if (S.selSubIdx >= 0) renderProps();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            if (moved) _pushHistory();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // ── Subtitle overlay drag (move subtitle position with mouse) ─────────────
    let _subDragging = false, _subDx0 = 0, _subDy0 = 0, _subX0 = 0, _subY0 = 0, _subOverlayMoved = false;

    subOverlay.addEventListener('mousedown', e => {
        const sub = subOverlay._activeSub;
        if (!sub) return;
        e.stopPropagation(); e.preventDefault();
        _subDragging = true;
        _subOverlayMoved = false;
        _subDx0 = e.clientX; _subDy0 = e.clientY;
        _subX0 = sub.x ?? 50; _subY0 = sub.y ?? 88;
        subOverlay.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', e => {
        if (!_subDragging) return;
        const sub = subOverlay._activeSub;
        if (!sub) return;
        _subOverlayMoved = true;
        const rect = (subContainer || previewContent).getBoundingClientRect();
        const dxPct = (e.clientX - _subDx0) / rect.width  * 100;
        const dyPct = (e.clientY - _subDy0) / rect.height * 100;
        sub.x = Math.max(0, Math.min(100, Math.round((_subX0 + dxPct) * 10) / 10));
        sub.y = Math.max(0, Math.min(100, Math.round((_subY0 + dyPct) * 10) / 10));
        subOverlay.style.left = sub.x + '%';
        subOverlay.style.top  = sub.y + '%';
        S.dirty = true;
        if (S.selSubIdx >= 0) renderProps();
    });

    document.addEventListener('mouseup', () => {
        if (_subDragging) {
            _subDragging = false; subOverlay.style.cursor = 'grab';
            if (_subOverlayMoved) _pushHistory();
        }
    });

    // Click on sub overlay selects the subtitle
    subOverlay.addEventListener('click', e => {
        const sub = subOverlay._activeSub;
        if (!sub) return;
        const idx = S.subtitles.indexOf(sub);
        if (idx >= 0) {
            S.selSubIdx = idx; S.selIdx = -1; S.selAudioIdx = -1;
            S.activeTab = 'subs';
            document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
            document.querySelector('[data-ptab="subs"]')?.classList.add('active');
            renderTimeline(); renderProps();
        }
    });

    // ── Timeline interaction ──────────────────────────────────────────────────
    tracksScroll.addEventListener('click', e => {
        if (e.target.closest('.ive-tl-clip') || e.target.closest('.ive-tl-audio-item') || e.target.closest('.ive-tl-sub-item') || e.target.closest('.ive-tl-pip-item')) return;
        const rect = tracksInner.getBoundingClientRect();
        _seek(Math.max(0, (e.clientX - rect.left) / S.pxPerSec));
    });
    tracksScroll.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const rect = tracksScroll.getBoundingClientRect();
        const cursorOffsetX = e.clientX - rect.left;
        const timeAtCursor = (tracksScroll.scrollLeft + cursorOffsetX) / S.pxPerSec;
        S.pxPerSec = Math.max(20, Math.min(500, S.pxPerSec * (e.deltaY < 0 ? 1.15 : 0.87)));
        renderTimeline();
        tracksScroll.scrollLeft = timeAtCursor * S.pxPerSec - cursorOffsetX;
    }, { passive: false });

    // ── Time ruler scrubbing (mousedown + drag) ───────────────────────────────
    let _rulerDragging = false;
    timeRulerEl.style.cursor = 'col-resize';
    timeRulerEl.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        _rulerDragging = true;
        const rect = tracksInner.getBoundingClientRect();
        _seek(Math.max(0, (e.clientX - rect.left) / S.pxPerSec));
    });
    document.addEventListener('mousemove', e => {
        if (!_rulerDragging) return;
        const rect = tracksInner.getBoundingClientRect();
        _seek(Math.max(0, (e.clientX - rect.left) / S.pxPerSec));
    });
    document.addEventListener('mouseup', () => { if (_rulerDragging) _rulerDragging = false; });

    // ── Props tabs ────────────────────────────────────────────────────────────
    $('ive-props').addEventListener('click', e => {
        const tab = e.target.closest('.ive-ptab');
        if (!tab) return;
        document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
        tab.classList.add('active');
        S.activeTab = tab.dataset.ptab;
        renderProps();
    });

    // ── Save / Export ─────────────────────────────────────────────────────────
    saveBtn.addEventListener('click', _saveProject);
    exportBtn.addEventListener('click', _startExport);
    $('ive-save-template-btn')?.addEventListener('click', async () => {
        if (!S.projectId) { await _saveProject(); }
        if (!S.projectId) { toast('Сначала сохраните проект', 'warn'); return; }
        const suggestedName = (S.projectName || 'Шаблон').trim();
        const name = await openPrompt({ title: 'Сохранить как шаблон', initial: suggestedName, confirmLabel: 'Сохранить' });
        if (name === null) return;
        try {
            const r = await fetch(`/api/imgvid/projects/${S.projectId}/save-as-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim() || suggestedName }),
            });
            const d = await r.json();
            if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
            toast('Шаблон сохранён: ' + d.name, 'ok');
            await loadTemplatesList();
            events.dispatchEvent(new CustomEvent('imgvid-template-changed'));
            _switchSidebarTab('templates');
        } catch (e) { toast(e.message, 'err'); }
    });
    // .amur save/open
    saveAmurBtn?.addEventListener('click', async () => {
        if (!S.projectId) { await _saveProject(); }
        if (!S.projectId) { toast('Не удалось сохранить проект', 'err'); return; }
        const result = await _openSaveAmurDialog(S.projectName);
        if (!result) return;
        try {
            const r = await fetch('/api/imgvid/project/save-to-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pid: S.projectId, dir: result.dir, filename: result.filename }),
            });
            const d = await r.json();
            if (!r.ok) { toast(d.detail || 'Ошибка сохранения', 'err'); return; }
            toast('Сохранено: ' + d.filename, 'ok');
        } catch (e) { toast(e.message, 'err'); }
    });
    openAmurBtn?.addEventListener('click', async () => {
        if (S.dirty && !confirm('Несохранённые изменения. Открыть .project?')) return;
        const result = await _openLoadAmurDialog();
        if (!result) return;
        toast('Открытие .project…', 'info');
        try {
            let d;
            if (result.type === 'file') {
                const fd = new FormData(); fd.append('file', result.file);
                const r = await fetch('/api/imgvid/project/unpack', { method: 'POST', body: fd });
                d = await r.json();
                if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
            } else {
                const r = await fetch('/api/imgvid/project/load-from-path', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_path: result.path }),
                });
                d = await r.json();
                if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
            }
            _stopPlayback();
            S.projectId = d.id; S.projectName = d.name;
            S.clips = d.slides || []; S.audioTracks = d.audio || [];
            S.subtitles = d.subtitles || [];
            _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
            _pipEls.clear();
            S.pipLayers = d.pip || d.pipLayers || [];
            S.selPipIdx = -1; S.selIdxs = new Set();
            S.selIdx = S.clips.length ? 0 : -1; S.dirty = false;
            if ($('ive-project-name')) $('ive-project-name').value = S.projectName;
            _applyExportSettings(d.export_settings);
            renderAll(); _pushHistory(); await loadProjectsList();
            toast('Проект загружен из .project', 'ok');
        } catch (e) { toast(e.message, 'err'); }
    });
    // Listen for open-project event from History tab
    events?.addEventListener('imgvid-open-project', async (ev) => {
        const pid = ev.detail?.pid; if (!pid) return;
        if (S.dirty && !confirm('Несохранённые изменения. Открыть другой проект?')) return;
        try {
            const r = await fetch(`/api/imgvid/projects/${pid}`);
            const d = await r.json();
            _stopPlayback();
            S.projectId = d.id; S.projectName = d.name;
            S.clips = d.slides || []; S.audioTracks = d.audio || [];
            S.subtitles = d.subtitles || [];
            _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
            _pipEls.clear();
            S.pipLayers = d.pip || d.pipLayers || [];
            S.selPipIdx = -1; S.selIdxs = new Set();
            S.selIdx = S.clips.length ? 0 : -1; S.dirty = false;
            if ($('ive-project-name')) $('ive-project-name').value = S.projectName;
            _applyExportSettings(d.export_settings);
            renderAll(); _pushHistory(); await loadProjectsList();
            toast('Проект открыт: ' + d.name, 'ok');
        } catch (e) { toast(e.message, 'err'); }
    });

    // ── Select All button ─────────────────────────────────────────────────────
    $('ive-select-all-btn')?.addEventListener('click', () => _selectAll());

    // ── Marquee selection (rubber-band on empty timeline areas) ───────────────
    let _marqueeDragging = false;
    let _marqueeEl = null;
    let _marqueeClientStart = null;

    function _getMarqueeEl() {
        if (!_marqueeEl) {
            _marqueeEl = document.createElement('div');
            _marqueeEl.style.cssText = 'position:fixed;border:1.5px dashed var(--accent,#f97316);background:rgba(74,158,255,0.08);pointer-events:none;z-index:9999;display:none;border-radius:2px;';
            document.body.appendChild(_marqueeEl);
        }
        return _marqueeEl;
    }

    tracksScroll.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const tgt = e.target;
        if (tgt.closest('.ive-tl-clip') || tgt.closest('.ive-tl-audio-item') ||
            tgt.closest('.ive-tl-sub-item') || tgt.closest('.ive-tl-pip-item') ||
            tgt.closest('.ive-playhead') || tgt.closest('.ive-time-ruler') ||
            tgt.closest('.ive-tl-trans-block')) return;

        if (!e.ctrlKey) _clearAllSelections();

        _marqueeClientStart = { x: e.clientX, y: e.clientY };
        _marqueeDragging = false;
        const mEl = _getMarqueeEl();
        mEl.style.display = 'none';

        const onMove = ev => {
            const dx = Math.abs(ev.clientX - _marqueeClientStart.x);
            const dy = Math.abs(ev.clientY - _marqueeClientStart.y);
            if (!_marqueeDragging && dx < 5 && dy < 5) return;
            _marqueeDragging = true;
            const x = Math.min(ev.clientX, _marqueeClientStart.x);
            const y = Math.min(ev.clientY, _marqueeClientStart.y);
            const w = Math.abs(ev.clientX - _marqueeClientStart.x);
            const h = Math.abs(ev.clientY - _marqueeClientStart.y);
            mEl.style.left = x + 'px'; mEl.style.top = y + 'px';
            mEl.style.width = w + 'px'; mEl.style.height = h + 'px';
            mEl.style.display = 'block';
        };

        const onUp = ev => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const mEl2 = _getMarqueeEl();
            mEl2.style.display = 'none';
            if (!_marqueeDragging) { _marqueeDragging = false; return; }
            _marqueeDragging = false;

            const scrollRect = tracksScroll.getBoundingClientRect();
            const scrollX = tracksScroll.scrollLeft;
            const x1c = Math.min(ev.clientX, _marqueeClientStart.x);
            const x2c = Math.max(ev.clientX, _marqueeClientStart.x);
            const y1c = Math.min(ev.clientY, _marqueeClientStart.y);
            const y2c = Math.max(ev.clientY, _marqueeClientStart.y);
            const t1 = Math.max(0, (x1c - scrollRect.left + scrollX) / S.pxPerSec);
            const t2 = (x2c - scrollRect.left + scrollX) / S.pxPerSec;

            const overlapY = el => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                return y1c < r.bottom && y2c > r.top;
            };

            if (overlapY(videoTrackEl)) {
                let cursor = 0;
                S.clips.forEach((clip, i) => {
                    const cEnd = cursor + (clip.duration || 3);
                    if (cEnd > t1 && cursor < t2) { S.selIdxs.add(i); S.selIdx = i; }
                    cursor += clip.duration || 3;
                });
            }

            if (overlapY(subTrackEl) && S.subtitles.length) {
                S.subtitles.forEach((sub, si) => {
                    if ((sub.end || 3) > t1 && (sub.start || 0) < t2) {
                        S.selSubIdxs.add(si); S.selSubIdx = si;
                    }
                });
                if (S.selSubIdx >= 0) {
                    S.activeTab = 'subs';
                    document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-ptab="subs"]')?.classList.add('active');
                }
            }

            if (overlapY(audioTrackEl)) {
                S.audioTracks.forEach((track, i) => {
                    const tStart = track.startOffset || 0;
                    const tEnd = tStart + (track.duration !== undefined ? track.duration : Math.max(1, totalDur() - tStart));
                    if (tEnd > t1 && tStart < t2) { S.selAudioIdxs.add(i); S.selAudioIdx = i; }
                });
            }

            if (pipTrackEl && overlapY(pipTrackEl)) {
                S.pipLayers.forEach((pip, pi) => {
                    const pStart = pip.startTime || 0;
                    const pEnd = pip.endTime ?? (pStart + 5);
                    if (pEnd > t1 && pStart < t2) { S.selPipIdxs.add(pi); S.selPipIdx = pi; }
                });
            }

            renderTimeline(); renderProps();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Listen for edit-template event from History tab
    events?.addEventListener('imgvid-edit-template', async (ev) => {
        const tid = ev.detail?.tid; if (!tid) return;
        await _editTemplate(tid);
    });

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        if (!section || section.hidden) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
        switch (e.key) {
            case ' ':        e.preventDefault(); _togglePlay();                                 break;
            case 'k': case 'K': e.preventDefault(); S.isPlaying ? _pausePlayback() : null;    break;
            case 'j': case 'J': e.preventDefault(); _seek(S.currentTime - 5);                 break;
            case 'l': case 'L': e.preventDefault(); _seek(S.currentTime + 5);                 break;
            case 'ArrowLeft':   e.preventDefault(); _seek(S.currentTime - (e.shiftKey ? 1 : 0.1)); break;
            case 'ArrowRight':  e.preventDefault(); _seek(S.currentTime + (e.shiftKey ? 1 : 0.1)); break;
            case 'Home':        e.preventDefault(); _seek(0);                                  break;
            case 'End':         e.preventDefault(); _seek(totalDur());                         break;
            case 'Delete': case 'Backspace': {
            const hasAnySelection = S.selIdx >= 0 || S.selIdxs.size > 0 ||
                S.selSubIdx >= 0 || S.selSubIdxs.size > 0 ||
                S.selPipIdx >= 0 || S.selPipIdxs.size > 0 ||
                S.selAudioIdx >= 0 || S.selAudioIdxs.size > 0;
            if (hasAnySelection) { e.preventDefault(); _deleteSelectedClip(); }
            break;
        }
        case 'z': case 'Z':
            if (e.ctrlKey && e.shiftKey) { e.preventDefault(); _redo(); }
            else if (e.ctrlKey) { e.preventDefault(); _undo(); }
            break;
        case 'y': case 'Y':
            if (e.ctrlKey) { e.preventDefault(); _redo(); }                                    break;
        case 'a': case 'A':
            if (e.ctrlKey) { e.preventDefault(); _selectAll(); }                               break;
        case 'Escape':
            _clearAllSelections();                                                              break;
        case 'c': case 'C':
            if (e.ctrlKey) { e.preventDefault(); _copySelected(); }                            break;
        case 'v': case 'V':
            if (e.ctrlKey) { e.preventDefault(); _pasteSelected(); }                           break;
        }
    });

    // ── Sidebar sub-tabs (Projects / Templates) ───────────────────────────────
    function _switchSidebarTab(name) {
        document.querySelectorAll('.ive-stab').forEach(b => {
            b.classList.toggle('active', b.dataset.stab === name);
        });
        document.querySelectorAll('.ive-stab-pane').forEach(p => {
            p.style.display = p.dataset.stabpane === name ? '' : 'none';
        });
    }
    document.querySelectorAll('.ive-stab').forEach(b => {
        b.addEventListener('click', () => _switchSidebarTab(b.dataset.stab));
    });

    // ── Boot ──────────────────────────────────────────────────────────────────
    // Populate transport buttons with SVG icons
    goStart.innerHTML       = ICONS.tbGoStart;
    rewindBtn.innerHTML     = ICONS.skipBack;
    playPauseBtn.innerHTML  = ICONS.play;
    stopBtn.innerHTML       = ICONS.tbStop;
    fwdBtn.innerHTML        = ICONS.skipFwd;
    goEnd.innerHTML         = ICONS.tbGoEnd;

    await loadProjectsList();
    await loadTemplatesList();
    renderAll();
    // Initialize history with empty baseline so first Ctrl+Z has a state to return to
    _pushHistory();

    // Size the preview content to match the selected export resolution aspect ratio
    // → imgvid/preview.js (updateCustomResVis)
    function _updateCustomResVis() {
        const isCustom = resEl?.value === 'custom';
        if (resWEl) resWEl.style.display = isCustom ? '' : 'none';
        if (resHEl) resHEl.style.display = isCustom ? '' : 'none';
        if (resXEl) resXEl.style.display = isCustom ? '' : 'none';
    }

    // → imgvid/export.js (updateExportModePanels)
    function _updateExportModePanels() {
        const fmtVal = $('ive-exp-format')?.value || 'mp4';
        const isAudio = fmtVal.startsWith('audio:');
        const hide = isAudio ? 'none' : '';
        const codecEl = $('ive-exp-codec');
        if (codecEl) codecEl.style.display = hide;
        if (resEl)   resEl.style.display   = hide;
        if (resWEl)  resWEl.style.display  = isAudio ? 'none' : (resEl?.value === 'custom' ? '' : 'none');
        if (resHEl)  resHEl.style.display  = isAudio ? 'none' : (resEl?.value === 'custom' ? '' : 'none');
        if (resXEl)  resXEl.style.display  = isAudio ? 'none' : (resEl?.value === 'custom' ? '' : 'none');
        const fpsEl = $('ive-exp-fps');
        const qualEl = $('ive-exp-quality');
        if (fpsEl)  fpsEl.style.display  = hide;
        if (qualEl) qualEl.style.display = hide;
    }

    _updateCustomResVis();
    _updateExportModePanels();
    _updatePreviewSize();
    resEl?.addEventListener('change', () => { _updateCustomResVis(); _updatePreviewSize(); renderPreview(); });
    $('ive-exp-format')?.addEventListener('change', _updateExportModePanels);
    resWEl?.addEventListener('change', () => { _updatePreviewSize(); renderPreview(); });
    resHEl?.addEventListener('change', () => { _updatePreviewSize(); renderPreview(); });
    new ResizeObserver(() => { _updatePreviewSize(); renderPreview(); }).observe(previewInner);

    // ══════════════════════════════════════════════════════════════════════════
    // Upload helpers
    // ══════════════════════════════════════════════════════════════════════════

    async function _uploadImages(files) {
        const dur = parseFloat(globalDurEl.value) || 3;
        for (const file of files) {
            try {
                const fd = new FormData(); fd.append('file', file);
                const r = await fetch('/api/imgvid/images', { method: 'POST', body: fd });
                const d = await r.json();
                if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); continue; }
                S.clips.push({ id: uid(), type: 'image', file: d.name, fileUrl: d.url, thumbUrl: d.url, original: d.original, duration: dur, transition: { type: 'fade', duration: 0.5 }, startEffect: { type: 'none', duration: 1.0 }, endEffect: { type: 'none', duration: 1.0 }, effects: [], subtitles: [], imgScale: 100, imgOffsetX: 0, imgOffsetY: 0, crop: null });
                _pushHistory();
                S.dirty = true; log('Изображение добавлено: ' + d.original, 'done');
            } catch (e) { toast(e.message, 'err'); }
        }
        if (S.selIdx < 0 && S.clips.length) S.selIdx = 0;
        renderAll();
    }

    async function _uploadClips(files) {
        for (const file of files) {
            try {
                toast('Загрузка видео…', 'info');
                const fd = new FormData(); fd.append('file', file);
                const r = await fetch('/api/imgvid/clips', { method: 'POST', body: fd });
                const d = await r.json();
                if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); continue; }
                S.clips.push({ id: uid(), type: 'video', file: d.name, fileUrl: d.url, thumbUrl: d.thumb_url || '', original: d.original, duration: d.duration || 5, transition: { type: 'fade', duration: 0.5 }, startEffect: { type: 'none', duration: 1.0 }, endEffect: { type: 'none', duration: 1.0 }, effects: [], subtitles: [] });
                _pushHistory();
                S.dirty = true; log('Видеоклип добавлен: ' + d.original, 'done');
            } catch (e) { toast(e.message, 'err'); }
        }
        if (S.selIdx < 0 && S.clips.length) S.selIdx = 0;
        renderAll();
    }

    async function _uploadAudio(file) {
        try {
            const fd = new FormData(); fd.append('file', file);
            const r = await fetch('/api/imgvid/audio', { method: 'POST', body: fd });
            const d = await r.json();
            if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
            const track = { id: uid(), file: d.name, fileUrl: d.url, original: d.original, volume: 1, fadeIn: 0, fadeOut: 0, startOffset: 0, trimIn: 0 };
            S.audioTracks.push(track);
            _pushHistory();
            S.dirty = true; log('Аудио добавлено: ' + d.original, 'done');
            renderMediaList(); renderTimeline();
            // Probe original duration asynchronously via Web Audio
            _probeAudioDuration(d.url).then(dur => { if (dur > 0) { track.originalDuration = dur; track.duration = dur; renderTimeline(); } });
        } catch (e) { toast(e.message, 'err'); }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Playback engine
    // ══════════════════════════════════════════════════════════════════════════

    function _togglePlay() { S.isPlaying ? _pausePlayback() : _startPlayback(); }

    function _startPlayback() {
        if (!S.clips.length) return;
        if (S.currentTime >= totalDur() - 0.05) _seek(0);
        S.isPlaying = true;
        S._playStartReal    = performance.now();
        S._playStartProject = S.currentTime;
        S._syncTick = 0;
        playPauseBtn.innerHTML = ICONS.pause;
        playPauseBtn.classList.add('playing');
        _syncAudio(S.currentTime, true);
        S._rafId = requestAnimationFrame(_tick);
    }

    function _pausePlayback() {
        S.isPlaying = false;
        playPauseBtn.innerHTML = ICONS.play;
        playPauseBtn.classList.remove('playing');
        if (S._rafId) { cancelAnimationFrame(S._rafId); S._rafId = null; }
        _pauseAllAudio();
        previewVideo.pause();
        // Pause all PIP video elements
        _pipEls.forEach(({ video }) => { if (video) video.pause(); });
    }

    function _stopPlayback() {
        _pausePlayback();
        S.currentTime = 0;
    }

    function _tick(now) {
        if (!S.isPlaying) return;
        const elapsed = (now - S._playStartReal) / 1000;
        const total   = totalDur();
        S.currentTime = Math.min(S._playStartProject + elapsed, total);
        _updateTransportUI();
        renderPreview();
        renderPlayhead();
        // Sync audio every ~30 frames (~0.5s) to avoid stuttering
        S._syncTick++;
        if (S._syncTick % 30 === 0) _syncAudio(S.currentTime);
        if (S.currentTime >= total) { S.currentTime = total; _pausePlayback(); return; }
        S._rafId = requestAnimationFrame(_tick);
    }

    function _seek(t) {
        S.currentTime = Math.max(0, Math.min(totalDur(), t));
        if (S.isPlaying) { S._playStartReal = performance.now(); S._playStartProject = S.currentTime; }
        _updateTransportUI();
        renderPreview();
        renderPlayhead();
        _syncAudio(S.currentTime, true);
    }

    function _updateTransportUI() {
        const total = totalDur();
        seekBar.value = total > 0 ? (S.currentTime / total) * 10000 : 0;
        curTime.textContent = fmt(S.currentTime);
        totTime.textContent = fmt(total);
    }

    // ── Preview zoom ──────────────────────────────────────────────────────────
    // → imgvid/preview.js (applyZoom)
    function _applyZoom(mode, pct) {
        S.previewMode = mode;
        if (mode === 'fit') {
            S.previewZoom = 1;
            previewContent.style.transform = '';
            previewContent.style.transformOrigin = '';
            zoomDisplay.textContent = 'Fit';
            zoomPct.style.display = 'none'; zoomSign.style.display = 'none';
            _updatePreviewSize();
        } else if (mode === 'original') {
            S.previewZoom = 1;
            previewContent.style.transform = '';
            previewContent.style.transformOrigin = '';
            zoomDisplay.textContent = '100%';
            zoomPct.style.display = 'none'; zoomSign.style.display = 'none';
            _updatePreviewSize();
        } else {
            const scale = Math.max(0.1, Math.min(8, pct / 100));
            S.previewZoom = scale;
            previewContent.style.transform = `scale(${scale})`;
            zoomDisplay.textContent = Math.round(scale * 100) + '%';
            zoomPct.value = Math.round(scale * 100);
            zoomPct.style.display = ''; zoomSign.style.display = '';
            _updatePreviewSize();
        }
    }

    function _getResolution() {
        const v = resEl ? resEl.value : '1920x1080';
        if (v === 'custom') {
            const w = parseInt(resWEl?.value) || 1920;
            const h = parseInt(resHEl?.value) || 1080;
            return `${w}x${h}`;
        }
        return v;
    }

    // → imgvid/preview.js (updatePreviewSize)
    function _updatePreviewSize() {
        const resVal = _getResolution();
        const parts  = resVal.split('x').map(Number);
        const resW   = parts[0] || 1920;
        const resH   = parts[1] || 1080;
        let w, h;
        if (S.previewMode === 'original') {
            w = resW; h = resH;
        } else {
            const cW = previewInner.clientWidth  || 640;
            const cH = previewInner.clientHeight || 360;
            const sc = Math.min(cW / resW, cH / resH);
            w = Math.floor(resW * sc); h = Math.floor(resH * sc);
        }
        previewContent.style.width  = w + 'px';
        previewContent.style.height = h + 'px';
        S.previewH = h; S.previewW = w;
        if (previewContentNext) {
            const iW   = previewInner.clientWidth  || 640;
            const iH   = previewInner.clientHeight || 360;
            const left = Math.floor((iW - w) / 2);
            const top  = Math.floor((iH - h) / 2);
            previewContentNext.style.width  = w + 'px';
            previewContentNext.style.height = h + 'px';
            previewContentNext.style.left   = left + 'px';
            previewContentNext.style.top    = top  + 'px';
            if (transOverlayEl) {
                transOverlayEl.style.width  = w + 'px';
                transOverlayEl.style.height = h + 'px';
                transOverlayEl.style.left   = left + 'px';
                transOverlayEl.style.top    = top  + 'px';
            }
            // Sync subtitle container with same position as previewContentNext
            if (subContainer) {
                subContainer.style.width  = w + 'px';
                subContainer.style.height = h + 'px';
                subContainer.style.left   = left + 'px';
                subContainer.style.top    = top  + 'px';
            }
        }
    }

    // ── Transition preview ────────────────────────────────────────────────────
    function _applyTransitionCSS(type, p) {
        if (!previewContentNext) return;
        const zT = S.previewMode === 'custom' ? `scale(${S.previewZoom})` : '';
        previewContent.style.opacity  = '1';
        previewContent.style.clipPath = '';
        previewContentNext.style.opacity  = '1';
        previewContentNext.style.clipPath = '';
        if (transOverlayEl) transOverlayEl.style.display = 'none';
        switch (type) {
            case 'fade': case 'crossfade': case 'dissolve':
                previewContent.style.opacity = String(1 - p);
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'fadeblack': case 'fadegrays': {
                const col = type === 'fadegrays' ? '#888' : '#000';
                if (transOverlayEl) { transOverlayEl.style.display = 'block'; transOverlayEl.style.background = col; }
                if (p < 0.5) {
                    previewContent.style.opacity = String(1 - p * 2);
                    if (transOverlayEl) transOverlayEl.style.opacity = String(p * 2);
                } else {
                    previewContent.style.opacity = '0';
                    if (transOverlayEl) transOverlayEl.style.opacity = String((1 - p) * 2);
                }
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            }
            case 'fadewhite':
                if (transOverlayEl) { transOverlayEl.style.display = 'block'; transOverlayEl.style.background = '#fff'; }
                if (p < 0.5) {
                    previewContent.style.opacity = String(1 - p * 2);
                    if (transOverlayEl) transOverlayEl.style.opacity = String(p * 2);
                } else {
                    previewContent.style.opacity = '0';
                    if (transOverlayEl) transOverlayEl.style.opacity = String((1 - p) * 2);
                }
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'slideleft':
                previewContent.style.transform = `translateX(${-p * 100}%) ${zT}`.trim();
                previewContentNext.style.transform = `translateX(${(1 - p) * 100}%)`;
                break;
            case 'slideright':
                previewContent.style.transform = `translateX(${p * 100}%) ${zT}`.trim();
                previewContentNext.style.transform = `translateX(${-(1 - p) * 100}%)`;
                break;
            case 'slideup':
                previewContent.style.transform = `translateY(${-p * 100}%) ${zT}`.trim();
                previewContentNext.style.transform = `translateY(${(1 - p) * 100}%)`;
                break;
            case 'slidedown':
                previewContent.style.transform = `translateY(${p * 100}%) ${zT}`.trim();
                previewContentNext.style.transform = `translateY(${-(1 - p) * 100}%)`;
                break;
            case 'wipeleft':
                previewContent.style.clipPath = `inset(0 ${p * 100}% 0 0)`;
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'wiperight':
                previewContent.style.clipPath = `inset(0 0 0 ${p * 100}%)`;
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'wipeup':
                previewContent.style.clipPath = `inset(${p * 100}% 0 0 0)`;
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'wipedown':
                previewContent.style.clipPath = `inset(0 0 ${p * 100}% 0)`;
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'zoomin':
                previewContent.style.transform = `scale(${1 + p * 0.3}) ${zT}`.trim();
                previewContent.style.opacity = String(1 - p);
                previewContentNext.style.transform = '';
                break;
            case 'hblur': case 'pixelize':
                previewContent.style.opacity = String(1 - p);
                previewContent.style.filter  = `blur(${p * 15}px)`;
                previewContent.style.transform = zT;
                previewContentNext.style.opacity = String(p);
                previewContentNext.style.filter  = `blur(${(1 - p) * 10}px)`;
                previewContentNext.style.transform = '';
                break;
            case 'circlecrop': case 'radial':
                previewContent.style.clipPath = `circle(${(1 - p) * 72}% at 50% 50%)`;
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'hlslice':
                previewContent.style.clipPath = `inset(0 ${p * 50}% 0 ${p * 50}%)`;
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            case 'vuslice':
                previewContent.style.clipPath = `inset(${p * 50}% 0 ${p * 50}% 0)`;
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
                break;
            default:
                previewContent.style.opacity = String(1 - p);
                previewContent.style.transform = zT;
                previewContentNext.style.transform = '';
        }
    }

    function _resetTransitionPreview() {
        if (!previewContentNext) return;
        const zT = S.previewMode === 'custom' ? `scale(${S.previewZoom})` : '';
        previewContent.style.opacity  = '1';
        previewContent.style.clipPath = '';
        if (zT) previewContent.style.transform = zT;
        else previewContent.style.transform = '';
        previewContentNext.style.display   = 'none';
        previewContentNext.style.opacity   = '1';
        previewContentNext.style.transform = '';
        previewContentNext.style.clipPath  = '';
        previewContentNext.style.filter    = '';
        if (transOverlayEl) transOverlayEl.style.display = 'none';
        if (previewVideoNext && !previewVideoNext.paused) previewVideoNext.pause();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Render functions
    // ══════════════════════════════════════════════════════════════════════════

    function renderAll() {
        renderMediaList(); renderTimeline(); renderPreview(); renderProps();
        projectNameEl.value = S.projectName; _updateTransportUI();
    }

    // ── Media list (sidebar) ──────────────────────────────────────────────────
    function renderMediaList() {
        const listEl = $('ive-media-list');
        const items = [
            ...S.clips.map((c, i)      => ({ ...c, _k: 'clip',  _i: i })),
            ...S.audioTracks.map((a, i) => ({ ...a, _k: 'audio', _i: i })),
        ];
        if (!items.length) { listEl.innerHTML = '<div class="ive-empty">Нет медиафайлов</div>'; return; }
        listEl.innerHTML = items.map(item => {
            const typeTag = item._k === 'audio' ? 'AUDIO' : item.type === 'video' ? 'VIDEO' : 'IMG';
            const icon    = item._k === 'audio' ? '♪' : item.type === 'video' ? '▶' : '';
            const thumbHtml = item.thumbUrl
                ? `<img class="ive-media-thumb" src="${item.thumbUrl}" loading="lazy">`
                : `<div class="ive-media-thumb" style="font-size:15px">${icon}</div>`;
            const meta = item._k === 'clip' ? item.duration.toFixed(1) + 'с' : '';
            const active = item._k === 'clip' && item._i === S.selIdx ? ' active' : '';
            return `<div class="ive-media-item${active}" data-mk="${item._k}" data-mi="${item._i}">
                ${thumbHtml}
                <div class="ive-media-info">
                    <div class="ive-media-name">${eh(item.original || item.file)}</div>
                    <div class="ive-media-meta">${meta} <span class="ive-media-type">${typeTag}</span></div>
                </div>
                <button class="hist-btn danger" data-mdel="${item._k}" data-mdi="${item._i}">${ICONS.trash}</button>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.ive-media-item').forEach(row => {
            row.addEventListener('click', e => {
                const del = e.target.closest('[data-mdel]');
                if (del) {
                    const k = del.dataset.mdel, i = +del.dataset.mdi;
                    if (k === 'clip') { S.clips.splice(i, 1); if (S.selIdx >= S.clips.length) S.selIdx = S.clips.length - 1; }
                    else { S.audioTracks.splice(i, 1); if (S.selAudioIdx >= S.audioTracks.length) S.selAudioIdx = -1; }
                    _pushHistory();
                    S.dirty = true; renderAll(); return;
                }
                if (row.dataset.mk === 'clip') _selectClip(+row.dataset.mi, { ctrl: e.ctrlKey, shift: e.shiftKey });
            });
        });
    }

    // ── Timeline ──────────────────────────────────────────────────────────────
    function renderTimeline() {
        const total = totalDur();
        totalDurEl.textContent = total.toFixed(1) + 'с';
        const contentW = Math.max(total * S.pxPerSec, (tracksScroll.clientWidth || 500));
        tracksInner.style.minWidth = contentW + 'px';
        _renderRuler(contentW, total);
        _renderVideoTrack(total);
        _renderAudioTracks(total, contentW);
        _renderSubsTrack(total);
        _renderPipTrack(total);
        renderPlayhead();
    }

    function _renderRuler(contentW, total) {
        timeRulerEl.innerHTML = '';
        timeRulerEl.style.width = contentW + 'px';
        if (total <= 0) return;
        const step = total < 10 ? 1 : total < 60 ? 5 : total < 300 ? 10 : 30;
        for (let t = 0; t <= total + 0.01; t += step) {
            const x = t * S.pxPerSec;
            const tick = Object.assign(document.createElement('div'), { className: 'ive-ruler-tick' });
            tick.style.left = x + 'px';
            timeRulerEl.appendChild(tick);
            const lbl = Object.assign(document.createElement('div'), { className: 'ive-ruler-label', textContent: fmtShort(t) });
            lbl.style.left = x + 'px';
            timeRulerEl.appendChild(lbl);
        }
    }

    function _renderVideoTrack(total) {
        videoTrackEl.style.width = Math.max(total * S.pxPerSec, tracksScroll.clientWidth || 500) + 'px';
        videoTrackEl.innerHTML = '';
        if (!S.clips.length) {
            videoTrackEl.innerHTML = '<div class="ive-tl-empty-abs">Добавьте медиафайлы</div>'; return;
        }
        let cursor = 0;
        S.clips.forEach((clip, i) => {
            const dur = clip.duration || 3;
            const w   = Math.max(16, dur * S.pxPerSec);
            const div = document.createElement('div');
            const isMultiSel = S.selIdxs.size > 1 && S.selIdxs.has(i);
            div.className = `ive-tl-clip${i === S.selIdx ? ' sel' : ''}${isMultiSel ? ' multi-sel' : ''}`;
            div.dataset.cidx = i;
            div.style.left  = (cursor * S.pxPerSec) + 'px';
            div.style.width = w + 'px';

            const thumbHtml = clip.thumbUrl
                ? `<img class="ive-tl-clip-thumb" src="${clip.thumbUrl}" draggable="false">`
                : `<div class="ive-tl-clip-thumb" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:18px">▶</div>`;

            div.innerHTML = `${thumbHtml}
                <div class="ive-tl-clip-label">${eh(clip.original || clip.file)}</div>
                ${clip.type === 'video' ? '<div class="ive-tl-clip-badge">▶</div><div class="ive-tl-clip-resize-left"></div>' : ''}
                ${clip.type !== 'video' ? `<div class="ive-tl-clip-resize" data-ridx="${i}"></div>` : ''}`;

            div.addEventListener('click', e => {
                if (e.target.closest('.ive-tl-clip-resize') || e.target.closest('.ive-tl-clip-resize-left')) return;
                _selectClip(i, { ctrl: e.ctrlKey, shift: e.shiftKey });
            });
            // Mouse-based drag to reorder clips
            div.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                if (e.target.closest('.ive-tl-clip-resize') || e.target.closest('.ive-tl-clip-resize-left')) return;
                e.preventDefault(); e.stopPropagation();
                _selectClip(i, { ctrl: e.ctrlKey, shift: e.shiftKey });
                const sx = e.clientX;
                let moved = false;
                const onMove = ev => {
                    const dx = ev.clientX - sx;
                    if (!moved && Math.abs(dx) < 5) return;
                    moved = true;
                    div.classList.add('dragging');
                    // Calculate which position to insert at
                    const tlRect = videoTrackEl.getBoundingClientRect();
                    const mouseX = ev.clientX - tlRect.left + tracksScroll.scrollLeft;
                    let dropIdx = 0, cur2 = 0;
                    for (let j = 0; j < S.clips.length; j++) {
                        const mid = (cur2 + S.clips[j].duration / 2) * S.pxPerSec;
                        if (mouseX > mid) dropIdx = j + 1;
                        cur2 += S.clips[j].duration || 3;
                    }
                    // Show drop indicator
                    document.querySelectorAll('.ive-tl-drop-indicator').forEach(el => el.remove());
                    let dropX = 0; let dc2 = 0;
                    for (let j = 0; j < Math.min(dropIdx, S.clips.length); j++) dc2 += S.clips[j].duration || 3;
                    dropX = dc2 * S.pxPerSec;
                    const ind = document.createElement('div');
                    ind.className = 'ive-tl-drop-indicator';
                    ind.style.cssText = `position:absolute;left:${dropX}px;top:0;bottom:0;width:3px;background:var(--accent);pointer-events:none;z-index:10`;
                    videoTrackEl.appendChild(ind);
                };
                const onUp = ev => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.querySelectorAll('.ive-tl-drop-indicator').forEach(el => el.remove());
                    div.classList.remove('dragging');
                    if (!moved) return;
                    const tlRect = videoTrackEl.getBoundingClientRect();
                    const mouseX = ev.clientX - tlRect.left + tracksScroll.scrollLeft;
                    let dropIdx = 0, cur2 = 0;
                    for (let j = 0; j < S.clips.length; j++) {
                        const mid = (cur2 + (S.clips[j].duration || 3) / 2) * S.pxPerSec;
                        if (mouseX > mid) dropIdx = j + 1;
                        cur2 += S.clips[j].duration || 3;
                    }
                    if (dropIdx !== i && dropIdx !== i + 1) {
                        const [moved2] = S.clips.splice(i, 1);
                        const finalIdx = dropIdx > i ? dropIdx - 1 : dropIdx;
                        S.clips.splice(finalIdx, 0, moved2);
                        _pushHistory();
                        S.selIdx = finalIdx; S.dirty = true; renderAll();
                    }
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            div.querySelector('.ive-tl-clip-resize')?.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, sd = clip.duration;
                let moved = false;
                const onMove = ev => {
                    moved = true;
                    clip.duration = Math.max(0.5, Math.round((sd + (ev.clientX - sx) / S.pxPerSec) * 10) / 10);
                    S.dirty = true; renderTimeline(); renderMediaList(); if (i === S.selIdx) renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            // Left trim handle — video only (shifts in-point, preserves out-point)
            if (clip.type === 'video') {
                div.querySelector('.ive-tl-clip-resize-left')?.addEventListener('mousedown', e => {
                    e.stopPropagation(); e.preventDefault();
                    const sx = e.clientX, sTrimIn = clip.trimIn || 0, sDur = clip.duration;
                    const outPt = sTrimIn + sDur;
                    let moved = false;
                    const onMove = ev => {
                        moved = true;
                        const newIn = Math.max(0, Math.round((sTrimIn + (ev.clientX - sx) / S.pxPerSec) * 10) / 10);
                        clip.trimIn   = newIn;
                        clip.duration = Math.max(0.5, Math.round((outPt - newIn) * 10) / 10);
                        S.dirty = true; renderTimeline(); renderMediaList(); if (i === S.selIdx) renderProps();
                    };
                    const onUp = () => {
                        document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                        if (moved) _pushHistory();
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
            }
            videoTrackEl.appendChild(div);
            cursor += dur;
        });
        // Add inter-clip transition blocks at clip boundaries (additive model)
        let tCursor = 0;
        S.clips.forEach((clip, i) => {
            const dur = clip.duration || 3;
            // Transition stored on INCOMING clip (clip.transition = from clips[i-1] to clips[i])
            if (i > 0) {
                const trans = clip.transition;
                if (trans?.type && trans.type !== 'none') {
                    const transDur   = trans.duration || 0.5;
                    const transDurPx = Math.max(20, transDur * S.pxPerSec);
                    const junctionX  = tCursor * S.pxPerSec;
                    const block = document.createElement('div');
                    block.className = 'ive-tl-trans-block';
                    // Block starts at the junction and extends into the incoming clip's territory
                    block.style.left  = junctionX + 'px';
                    block.style.width = transDurPx + 'px';
                    const lbl = TRANSITIONS.find(t => t.value === trans.type)?.label || trans.type;
                    block.innerHTML = `<span class="ive-tl-trans-label">${eh(lbl)}</span><span class="ive-tl-trans-dur">${transDur}s</span>`;
                    block.addEventListener('click', e => {
                        e.stopPropagation();
                        _selectClip(i);
                        S.activeTab = 'slide';
                        document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                        document.querySelector('[data-ptab="slide"]')?.classList.add('active');
                        renderProps();
                    });
                    videoTrackEl.appendChild(block);
                }
            }
            tCursor += dur;
        });
    }

    function _renderAudioTracks(total, contentW) {
        const count  = Math.max(1, S.audioTracks.length);
        const rowH   = 44;
        const totalH = count * rowH;
        audioTrackEl.style.height = totalH + 'px';
        audioLblEl.style.height   = totalH + 'px';
        audioTrackEl.innerHTML = '';
        if (!S.audioTracks.length) {
            const empty = document.createElement('div');
            empty.className = 'ive-audio-row-inner';
            empty.innerHTML = '<div class="ive-tl-empty-abs">Нет аудиодорожек</div>';
            audioTrackEl.appendChild(empty);
            return;
        }
        S.audioTracks.forEach((track, i) => {
            const row = document.createElement('div');
            row.className = 'ive-audio-row-inner';
            row.style.width = contentW + 'px';
            const offsetPx = (track.startOffset || 0) * S.pxPerSec;
            const trackDur = track.duration !== undefined ? track.duration : Math.max(1, total - (track.startOffset || 0));
            const itemW    = Math.max(40, trackDur * S.pxPerSec);
            const item     = document.createElement('div');
            const isMultiAudioSel = S.selAudioIdxs.size > 1 && S.selAudioIdxs.has(i);
            item.className = `ive-tl-audio-item${i === S.selAudioIdx ? ' sel' : ''}${isMultiAudioSel ? ' multi-sel' : ''}`;
            item.dataset.aidx = i;
            item.style.left  = offsetPx + 'px';
            item.style.width = itemW + 'px';
            const canvas = document.createElement('canvas');
            canvas.className = 'ive-waveform-canvas';
            canvas.width  = Math.max(40, itemW); canvas.height = rowH - 4;
            item.appendChild(canvas);
            // Left handle: moves startOffset (keeps out-point)
            const lh = document.createElement('div');
            lh.className = 'ive-tl-audio-resize ive-tl-audio-resize-left';
            item.appendChild(lh);
            // Right handle: changes duration
            const rh = document.createElement('div');
            rh.className = 'ive-tl-audio-resize ive-tl-audio-resize-right';
            item.appendChild(rh);

            item.addEventListener('mousedown', e => {
                if (e.target.closest('.ive-tl-audio-resize')) return;
                if (e.button !== 0) return;
                e.stopPropagation(); e.preventDefault();
                if (e.ctrlKey) {
                    if (S.selAudioIdxs.has(i)) {
                        S.selAudioIdxs.delete(i);
                        if (S.selAudioIdx === i) S.selAudioIdx = [...S.selAudioIdxs].at(-1) ?? -1;
                    } else {
                        S.selAudioIdxs.add(i);
                        S.selAudioIdx = i;
                    }
                    S.activeTab = 'slide'; renderTimeline(); renderProps();
                    return;
                }
                // Preserve multi-selection if the clicked item is already selected
                if (!S.selAudioIdxs.has(i)) {
                    S.selAudioIdx = i; S.selAudioIdxs = new Set([i]);
                    S.selIdx = -1; S.selIdxs = new Set(); S.selSubIdx = -1; S.selSubIdxs = new Set(); S.selPipIdx = -1; S.selPipIdxs = new Set();
                } else {
                    S.selAudioIdx = i;
                }
                S.activeTab = 'slide'; renderTimeline(); renderProps();
                const sx = e.clientX;
                // Capture initial positions of ALL selected types for cross-type group drag
                const _dragInitAudio = [...S.selAudioIdxs].map(idx => ({ idx, startOffset: S.audioTracks[idx]?.startOffset || 0 }));
                const _dragInitSub = [...S.selSubIdxs].map(idx => {
                    const s = S.subtitles[idx] || {};
                    return { idx, start: s.start || 0, dur: (s.end || 3) - (s.start || 0) };
                });
                const _dragInitPip = [...S.selPipIdxs].map(idx => {
                    const p = S.pipLayers[idx] || {};
                    const st = p.startTime || 0;
                    return { idx, startTime: st, dur: (p.endTime ?? (st + 5)) - st };
                });
                let moved = false;
                const onMove = ev => {
                    if (!moved && Math.abs(ev.clientX - sx) < 4) return;
                    moved = true;
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    _dragInitAudio.forEach(({ idx, startOffset }) => {
                        if (S.audioTracks[idx]) S.audioTracks[idx].startOffset = Math.max(0, Math.round((startOffset + dx) * 10) / 10);
                    });
                    _dragInitSub.forEach(({ idx, start, dur }) => {
                        const s = S.subtitles[idx]; if (!s) return;
                        const newStart = Math.max(0, Math.round((start + dx) * 10) / 10);
                        s.start = newStart; s.end = Math.round((newStart + dur) * 10) / 10;
                    });
                    _dragInitPip.forEach(({ idx, startTime, dur }) => {
                        const p = S.pipLayers[idx]; if (!p) return;
                        const newStart = Math.max(0, Math.round((startTime + dx) * 10) / 10);
                        p.startTime = newStart; p.endTime = Math.round((newStart + dur) * 10) / 10;
                    });
                    S.dirty = true; renderTimeline(); renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            lh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, sOff = track.startOffset || 0, sTrimIn = track.trimIn || 0;
                const sDur = track.duration !== undefined ? track.duration : Math.max(1, total - sOff);
                const outPt = sOff + sDur;  // keep out-point fixed
                let moved = false;
                const onMove = ev => {
                    moved = true;
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    const maxTrimIn = (track.originalDuration || 9999) - 0.5;
                    const newOff    = Math.max(0, Math.round((sOff + dx) * 10) / 10);
                    const newTrimIn = Math.max(0, Math.min(maxTrimIn, Math.round((sTrimIn + dx) * 10) / 10));
                    track.startOffset = newOff;
                    track.trimIn      = newTrimIn;
                    track.duration    = Math.max(0.5, Math.round((outPt - newOff) * 10) / 10);
                    S.dirty = true; renderTimeline(); if (i === S.selAudioIdx) renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            rh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX;
                const sDur = track.duration !== undefined ? track.duration : Math.max(1, total - (track.startOffset || 0));
                let moved = false;
                const onMove = ev => {
                    moved = true;
                    const maxDur = (track.originalDuration || 9999) - (track.trimIn || 0);
                    track.duration = Math.max(0.5, Math.min(maxDur, Math.round((sDur + (ev.clientX - sx) / S.pxPerSec) * 10) / 10));
                    S.dirty = true; renderTimeline(); if (i === S.selAudioIdx) renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            row.appendChild(item);
            audioTrackEl.appendChild(row);
            drawWaveform(canvas, track.fileUrl);
        });
    }

    function _renderSubsTrack(total) {
        subTrackEl.style.width = Math.max(total * S.pxPerSec, tracksScroll.clientWidth || 500) + 'px';
        subTrackEl.innerHTML = '';
        S.subtitles.forEach((sub, si) => {
            const w = Math.max(8, ((sub.end || 3) - (sub.start || 0)) * S.pxPerSec);
            const el = document.createElement('div');
            const isMultiSubSel = S.selSubIdxs.size > 1 && S.selSubIdxs.has(si);
            el.className = `ive-tl-sub-item${si === S.selSubIdx ? ' sel' : ''}${isMultiSubSel ? ' multi-sel' : ''}`;
            el.style.left  = ((sub.start || 0) * S.pxPerSec) + 'px';
            el.style.width = w + 'px';
            el.title = sub.text || '';
            el.textContent = sub.text ? sub.text.slice(0, 20) : '—';
            el.addEventListener('click', e => {
                e.stopPropagation();
                if (e.ctrlKey) {
                    if (S.selSubIdxs.has(si)) {
                        S.selSubIdxs.delete(si);
                        if (S.selSubIdx === si) S.selSubIdx = [...S.selSubIdxs].at(-1) ?? -1;
                    } else {
                        S.selSubIdxs.add(si);
                        S.selSubIdx = si;
                    }
                    S.selIdx = -1; S.selIdxs = new Set(); S.selPipIdx = -1; S.selPipIdxs = new Set();
                } else {
                    S.selSubIdx = si;
                    S.selSubIdxs = new Set([si]);
                    S.selIdx = -1; S.selIdxs = new Set(); S.selAudioIdx = -1; S.selAudioIdxs = new Set(); S.selPipIdx = -1; S.selPipIdxs = new Set();
                }
                S.activeTab = 'subs';
                document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-ptab="subs"]')?.classList.add('active');
                renderTimeline(); renderProps();
            });
            // Drag to move subtitle timing
            el.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                if (e.ctrlKey) return; // Ctrl+click handled by click event
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX;
                const snapTargets = _getSnapTargets(si, 'sub');
                // Capture initial positions of all selected subs for group drag
                const _dragSubIds = S.selSubIdxs.has(si) && S.selSubIdxs.size > 1
                    ? [...S.selSubIdxs]
                    : [si];
                const _dragSubData = _dragSubIds.map(idx => {
                    const s2 = S.subtitles[idx] || {};
                    return { idx, start0: s2.start || 0, dur: (s2.end || 3) - (s2.start || 0) };
                });
                // Capture initial positions of other selected types for cross-type group drag
                const _dragInitAudio = [...S.selAudioIdxs].map(idx => ({ idx, startOffset: S.audioTracks[idx]?.startOffset || 0 }));
                const _dragInitPip = [...S.selPipIdxs].map(idx => {
                    const p = S.pipLayers[idx] || {};
                    const st = p.startTime || 0;
                    return { idx, startTime: st, dur: (p.endTime ?? (st + 5)) - st };
                });
                let moved = false;
                const onMove = ev => {
                    if (!moved && Math.abs(ev.clientX - sx) < 3) return;
                    moved = true;
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    _dragSubData.forEach(({ idx, start0, dur: d }) => {
                        const s2 = S.subtitles[idx]; if (!s2) return;
                        let newStart = Math.max(0, start0 + dx);
                        if (_dragSubIds.length === 1 && _dragInitAudio.length === 0 && _dragInitPip.length === 0) newStart = _snap(newStart, snapTargets);
                        s2.start = Math.round(newStart * 10) / 10;
                        s2.end   = Math.round((newStart + d) * 10) / 10;
                    });
                    _dragInitAudio.forEach(({ idx, startOffset }) => {
                        if (S.audioTracks[idx]) S.audioTracks[idx].startOffset = Math.max(0, Math.round((startOffset + dx) * 10) / 10);
                    });
                    _dragInitPip.forEach(({ idx, startTime, dur }) => {
                        const p = S.pipLayers[idx]; if (!p) return;
                        const newStart = Math.max(0, Math.round((startTime + dx) * 10) / 10);
                        p.startTime = newStart; p.endTime = Math.round((newStart + dur) * 10) / 10;
                    });
                    S.dirty = true; renderTimeline();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            // Right resize handle
            const rh = document.createElement('div');
            rh.className = 'ive-tl-clip-resize';
            rh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, e0 = sub.end || 3;
                let moved = false;
                const onMove = ev => {
                    moved = true;
                    sub.end = Math.max((sub.start || 0) + 0.1, Math.round((e0 + (ev.clientX - sx) / S.pxPerSec) * 10) / 10);
                    S.dirty = true; renderTimeline();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            el.appendChild(rh);
            subTrackEl.appendChild(el);
        });
        // Also render legacy per-clip subtitles if present
        let cursor = 0;
        S.clips.forEach((clip, ci) => {
            const clipDur = clip.duration || 3;
            (clip.subtitles || []).forEach(sub => {
                const absStart = cursor + (sub.start || 0);
                const absEnd   = cursor + (sub.end || clipDur);
                const w = Math.max(8, (absEnd - absStart) * S.pxPerSec);
                const el = document.createElement('div');
                el.className = 'ive-tl-sub-item legacy';
                el.style.left  = (absStart * S.pxPerSec) + 'px';
                el.style.width = w + 'px';
                el.title = (sub.text || '') + ' (старый формат)';
                el.textContent = sub.text ? sub.text.slice(0, 18) : '—';
                el.style.opacity = '0.5';
                el.addEventListener('click', e => { e.stopPropagation(); _selectClip(ci); S.activeTab = 'subs'; document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active')); document.querySelector('[data-ptab="subs"]')?.classList.add('active'); renderProps(); });
                subTrackEl.appendChild(el);
            });
            cursor += clipDur;
        });
    }

    function renderPlayhead() {
        const total = totalDur();
        if (total <= 0 || !S.clips.length) { playheadEl.style.display = 'none'; return; }
        playheadEl.style.display = 'block';
        playheadEl.style.left    = (S.currentTime * S.pxPerSec) + 'px';
        if (S.isPlaying) {
            const x = S.currentTime * S.pxPerSec;
            const vr = tracksScroll.scrollLeft + tracksScroll.clientWidth;
            if (x > vr - 60) tracksScroll.scrollLeft = x - tracksScroll.clientWidth * 0.3;
        }
    }

    // ── Preview ───────────────────────────────────────────────────────────────
    let _lastSubStart = null;

    function renderPreview() {
        const info = clipAtTime(S.currentTime);
        if (!info) {
            previewImg.style.display    = 'none';
            previewVideo.style.display  = 'none';
            previewEmpty.style.display  = 'flex';
            subOverlay.style.display    = 'none';
            if (subContainer) subContainer.style.display = 'none';
            previewContent.style.filter = '';
            previewImg.style.filter     = '';
            previewVideo.style.filter   = '';
            _resetTransitionPreview();
            _renderPipInPreview(S.currentTime);
            return;
        }
        const inTrans = info.inTransition;
        let clip, idx, local, nextClip, transType, transDur, transProgress;
        if (inTrans) {
            clip          = info.outClip;
            idx           = info.outIdx;
            nextClip      = info.inClip;
            transType     = info.transType;
            transDur      = info.transDur;
            transProgress = info.transProgress;
            // Additive model: outgoing clip has finished playing — show its last frame
            local         = info.outClip.duration;
        } else {
            clip          = info.clip;
            idx           = info.idx;
            local         = info.local;
            nextClip      = null;
            transType     = 'none';
            transDur      = 0.5;
            transProgress = 0;
        }

        previewEmpty.style.display  = 'none';

        // Determine active subtitle early so we can route the CSS filter correctly
        const _t = S.currentTime;
        const _activeSub = S.subtitles.find(s => _t >= (s.start || 0) && _t <= (s.end ?? 3))
            || (clip ? (clip.subtitles || []).find(s => local >= (s.start || 0) && local <= (s.end ?? clip.duration)) : null);

        // Apply CSS effects filter: if aboveEffects, filter only the media elements (not subContainer)
        const _cssFilter = inTrans ? '' : buildCSSFilter(clip.effects || []);
        if (_activeSub?.aboveEffects) {
            previewContent.style.filter = '';
            previewImg.style.filter   = _cssFilter;
            previewVideo.style.filter = _cssFilter;
            if (subContainer) subContainer.style.filter = '';
        } else {
            previewContent.style.filter = _cssFilter;
            previewImg.style.filter   = '';
            previewVideo.style.filter = '';
            if (subContainer) subContainer.style.filter = _cssFilter;
        }

        // Show current clip
        if (clip.type === 'image') {
            previewVideo.style.display = 'none';
            if (previewImg.dataset.src !== clip.fileUrl) {
                previewImg.src = clip.fileUrl; previewImg.dataset.src = clip.fileUrl;
            }
            previewImg.style.display = 'block';
            _applyImgTransform(previewImg, clip);
        } else {
            previewImg.style.display = 'none';
            previewImg.style.transform = '';
            previewImg.style.clipPath = '';
            if (previewVideo.dataset.src !== clip.fileUrl) {
                previewVideo.src = clip.fileUrl; previewVideo.dataset.src = clip.fileUrl;
                previewVideo.load();
            }
            previewVideo.style.display = 'block';
            const videoTime = local + (clip.trimIn || 0);
            const vSpeed    = clip.speed ?? 1;
            if (previewVideo.playbackRate !== vSpeed) previewVideo.playbackRate = vSpeed;
            if (inTrans) {
                // Outgoing clip at its last frame — always frozen during transition
                if (!previewVideo.paused) previewVideo.pause();
                if (Math.abs(previewVideo.currentTime - videoTime) > 0.05) previewVideo.currentTime = videoTime;
            } else if (!S.isPlaying) {
                if (Math.abs(previewVideo.currentTime - videoTime) > 0.15) previewVideo.currentTime = videoTime;
                if (!previewVideo.paused) previewVideo.pause();
            } else {
                if (previewVideo.paused) previewVideo.play().catch(() => {});
                if (Math.abs(previewVideo.currentTime - videoTime) > 0.3) previewVideo.currentTime = videoTime;
            }
        }

        // Transition preview: show next clip and apply CSS effect
        if (inTrans && previewContentNext) {
            const nextLocal = transProgress * transDur;
            if (nextClip.type === 'image') {
                previewVideoNext.style.display = 'none';
                if (previewImgNext.dataset.src !== nextClip.fileUrl) {
                    previewImgNext.src = nextClip.fileUrl; previewImgNext.dataset.src = nextClip.fileUrl;
                }
                previewImgNext.style.display = 'block';
            } else {
                previewImgNext.style.display = 'none';
                if (previewVideoNext.dataset.src !== nextClip.fileUrl) {
                    previewVideoNext.src = nextClip.fileUrl; previewVideoNext.dataset.src = nextClip.fileUrl;
                    previewVideoNext.load();
                }
                previewVideoNext.style.display = 'block';
                const nVT = nextLocal + (nextClip.trimIn || 0);
                const nSpeed = nextClip.speed ?? 1;
                if (previewVideoNext.playbackRate !== nSpeed) previewVideoNext.playbackRate = nSpeed;
                if (!S.isPlaying) {
                    if (Math.abs(previewVideoNext.currentTime - nVT) > 0.15) previewVideoNext.currentTime = nVT;
                    if (!previewVideoNext.paused) previewVideoNext.pause();
                } else {
                    if (previewVideoNext.paused) previewVideoNext.play().catch(() => {});
                    if (Math.abs(previewVideoNext.currentTime - nVT) > 0.3) previewVideoNext.currentTime = nVT;
                }
            }
            previewContentNext.style.display = 'block';
            _applyTransitionCSS(transType, transProgress);
        } else {
            _resetTransitionPreview();
            _applyClipStartEndEffects(clip, local);
        }

        // Render PIP layers
        _renderPipInPreview(S.currentTime);

        // Render active subtitle (already resolved above)
        if (_activeSub?.text) {
            if (subContainer) subContainer.style.display = 'block';
            _renderSubOverlay(_activeSub, _activeSub.id || '');
        } else {
            subOverlay.style.display = 'none';
            if (subContainer) subContainer.style.display = 'none';
            _lastSubStart = null;
        }
    }

    function _applyImgTransform(imgEl, clip) {
        const sc = (clip.imgScale || 100) / 100;
        const ox = clip.imgOffsetX || 0;
        const oy = clip.imgOffsetY || 0;
        imgEl.style.transform = (sc !== 1 || ox !== 0 || oy !== 0)
            ? `scale(${sc}) translate(${ox}%,${oy}%)`
            : '';
        const crop = clip.crop;
        if (crop && (crop.x > 0 || crop.y > 0 || crop.w < 100 || crop.h < 100)) {
            const t = crop.y, r = 100 - crop.x - crop.w;
            const b = 100 - crop.y - crop.h, l = crop.x;
            imgEl.style.clipPath = `inset(${t}% ${r}% ${b}% ${l}%)`;
        } else {
            imgEl.style.clipPath = '';
        }
    }

    function _applyClipStartEndEffects(clip, local) {
        const start = clip.startEffect;
        const end   = clip.endEffect;
        const dur   = clip.duration || 3;
        let opacity = 1, scale = 1, tx = 0, ty = 0;

        if (start?.type && start.type !== 'none') {
            const d = Math.max(0.01, start.duration || 1);
            const p = Math.max(0, Math.min(1, local / d));
            if (p < 1) {
                switch (start.type) {
                    case 'fade-in':    opacity *= p; break;
                    case 'zoom-in':    scale = 0.5 + 0.5 * p; break;
                    case 'zoom-out':   scale = 1.5 - 0.5 * p; break;
                    case 'slide-left': tx = (p - 1) * 100; break;
                    case 'slide-right':tx = (1 - p) * 100; break;
                    case 'slide-up':   ty = (p - 1) * 100; break;
                    case 'slide-down': ty = (1 - p) * 100; break;
                }
            }
        }

        if (end?.type && end.type !== 'none') {
            const d = Math.max(0.01, end.duration || 1);
            const p = Math.max(0, Math.min(1, (dur - local) / d));
            if (p < 1) {
                switch (end.type) {
                    case 'fade-out':   opacity *= p; break;
                    case 'zoom-in':    scale *= 1 + (1 - p) * 0.5; break;
                    case 'zoom-out':   scale *= 0.5 + 0.5 * p; break;
                    case 'slide-left': tx -= (1 - p) * 100; break;
                    case 'slide-right':tx += (1 - p) * 100; break;
                    case 'slide-up':   ty -= (1 - p) * 100; break;
                    case 'slide-down': ty += (1 - p) * 100; break;
                }
            }
        }

        const zT  = S.previewMode === 'custom' ? `scale(${S.previewZoom})` : '';
        const effT = (scale !== 1 || tx !== 0 || ty !== 0)
            ? `scale(${scale.toFixed(4)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%)`
            : '';
        previewContent.style.opacity   = opacity.toFixed(4);
        previewContent.style.transform = [zT, effT].filter(Boolean).join(' ') || '';
    }

    function _renderSubOverlay(sub, subKey) {
        subOverlay.style.display = 'block';

        const animType   = sub.animation || 'none';
        const animDurSec = sub.animDuration || 0.6;
        const elapsed    = Math.max(0, S.currentTime - (sub.start || 0));
        const subDur     = Math.max(0.001, (sub.end || 3) - (sub.start || 0));

        // ── Text content ──────────────────────────────────────────────────────
        const textEl = subOverlay._textEl || subOverlay;
        if (sub.karaokeEnable && sub.end > sub.start) {
            const karaokeColor = sub.karaokeColor || '#ffdd00';
            const normalColor  = sub.color || '#ffffff';
            const wordArr  = sub.text.split(/\s+/).filter(Boolean);
            const wordIdx  = Math.min(wordArr.length - 1, Math.floor(wordArr.length * elapsed / subDur));
            const kmode    = sub.karaokeMode || 'word';
            const tokens   = sub.text.split(/(\s+)/);
            let wi = 0;
            textEl.innerHTML = tokens.map(tok => {
                if (/^\s+$/.test(tok)) return tok;
                const idx = wi++;
                const color = kmode === 'cumulative' ? (idx <= wordIdx ? karaokeColor : normalColor)
                                                     : (idx === wordIdx ? karaokeColor : normalColor);
                return `<span style="color:${color}">${eh(tok)}</span>`;
            }).join('');
        } else if (animType === 'typewriter') {
            // Character-by-character reveal — matches ASS export exactly.
            // Shows floor(elapsed/animDurSec * n) chars, min 1, max all.
            const text = sub.text || '';
            const n = text.length;
            if (elapsed >= animDurSec || n === 0) {
                textEl.textContent = text;
            } else {
                textEl.textContent = text.slice(0, Math.max(1, Math.ceil(n * elapsed / animDurSec)));
            }
        } else {
            textEl.textContent = sub.text;
        }

        // ── Scale pixel values to preview/export resolution ratio ─────────────
        const _resParts = _getResolution().split('x').map(Number);
        const _resH     = _resParts[1] || 1080;
        const _pvH      = S.previewH || _resH;
        const sc        = _pvH / _resH;

        subOverlay.style.left        = (sub.x ?? 50) + '%';
        subOverlay.style.top         = (sub.y ?? 88) + '%';
        subOverlay.style.transform   = `translate(-50%, -50%) rotate(${sub.rotation || 0}deg)`;
        subOverlay.style.fontSize    = ((sub.fontSize || 40) * sc) + 'px';
        subOverlay.style.color       = sub.color || '#ffffff';
        subOverlay.style.fontFamily  = `"${sub.fontFamily || 'Arial'}", sans-serif`;
        subOverlay.style.fontWeight  = sub.bold      ? 'bold'      : 'normal';
        subOverlay.style.fontStyle   = sub.italic    ? 'italic'    : 'normal';
        subOverlay.style.textDecoration = sub.underline ? 'underline' : 'none';
        subOverlay.style.textAlign   = sub.align     || 'center';
        subOverlay.style.lineHeight  = sub.lineHeight || 1.35;
        subOverlay.style.textShadow  = _makeTextShadow(
            (sub.outline ?? 2) * sc, sub.outlineColor || '#000000',
            (sub.shadow  ?? 1) * sc, sub.shadowColor  || '#000000'
        );

        if (sub.w > 0) {
            subOverlay.style.width    = sub.w + '%';
            subOverlay.style.maxWidth = sub.w + '%';
        } else {
            subOverlay.style.width    = '';
            subOverlay.style.maxWidth = '90%';
        }
        if (sub.h > 0) {
            subOverlay.style.minHeight = (sub.h * sc) + 'px';
        } else {
            subOverlay.style.minHeight = '';
        }

        const bgOp = sub.bgOpacity ?? 0;
        if (bgOp > 0) {
            subOverlay.style.background   = hexToRgba(sub.bgColor || '#000000', bgOp);
            subOverlay.style.padding      = `${(sub.bgPadY ?? 6) * sc}px ${(sub.bgPadX ?? 12) * sc}px`;
            subOverlay.style.borderRadius = ((sub.bgRadius ?? 4) * sc) + 'px';
        } else {
            subOverlay.style.background   = 'none';
            subOverlay.style.padding      = '0';
            subOverlay.style.borderRadius = '0';
        }

        // ── Animation ─────────────────────────────────────────────────────────
        // Clear properties that time-based or CSS animations might have set previously.
        subOverlay.style.clipPath = '';

        const key = subKey || ((sub.id || '') + ':' + (sub.start ?? 0));

        if (animType === 'typewriter') {
            // Text content already updated above; no CSS animation needed.
            if (key !== _lastSubStart) {
                _lastSubStart = key;
                subOverlay.style.animation = 'none';
                void subOverlay.offsetWidth;
            }
            subOverlay.style.animation = '';
            subOverlay.style.opacity   = '';

        } else if (animType === 'fade-out') {
            // Fade out at the END of the subtitle — matches ASS \fad(0,anim_ms).
            // (A CSS `sub-fade-out` animation would play at the *start*, which is wrong.)
            const fadeStart = subDur - animDurSec;
            if (elapsed >= fadeStart && fadeStart >= 0) {
                subOverlay.style.opacity = String(Math.max(0, 1 - (elapsed - fadeStart) / Math.max(0.001, animDurSec)));
            } else {
                subOverlay.style.opacity = '1';
            }
            if (key !== _lastSubStart) {
                _lastSubStart = key;
                subOverlay.style.animation = 'none';
                void subOverlay.offsetWidth;
            }
            subOverlay.style.animation = '';

        } else {
            // CSS animations for fade-in, zoom-in, slide-up, slide-down.
            // These all play at the START of the subtitle, matching ASS behaviour.
            subOverlay.style.opacity = '';
            if (key !== _lastSubStart) {
                _lastSubStart = key;
                subOverlay.style.animation = 'none';
                void subOverlay.offsetWidth;
                subOverlay.style.animation = animType !== 'none'
                    ? `sub-${animType} ${animDurSec.toFixed(2)}s ease forwards`
                    : '';
            }
        }

        subOverlay.style.cursor = 'grab';
        subOverlay._activeSub   = sub;
        const isSelected = S.selSubIdx >= 0 && S.subtitles[S.selSubIdx] === sub;
        subOverlay.classList.toggle('selected', isSelected);
    }

    // ── Properties panel ──────────────────────────────────────────────────────
    function renderProps() {
        if (S.selPipIdxs.size > 1) { _renderPropsMultiPip(); return; }
        if (S.selPipIdx >= 0 && S.selPipIdx < S.pipLayers.length) {
            _renderPropsPip(S.pipLayers[S.selPipIdx], S.selPipIdx); return;
        }
        if (S.selIdxs.size > 1 && S.activeTab !== 'subs') {
            _renderPropsMulti(); return;
        }
        if (S.selAudioIdxs.size > 1) { _renderPropsMultiAudio(); return; }
        if (S.selAudioIdx >= 0 && S.selAudioIdx < S.audioTracks.length && S.activeTab === 'slide') {
            _renderPropsAudio(S.audioTracks[S.selAudioIdx], S.selAudioIdx); return;
        }
        if (S.activeTab === 'subs') {
            if (S.selSubIdxs.size > 1) { _renderPropsMultiSub(); return; }
            _renderPropsSubsGlobal(); return;
        }
        const clip = S.clips[S.selIdx];
        if (!clip) { propsBody.innerHTML = '<div class="ive-empty ive-props-placeholder">Выберите клип</div>'; return; }
        if (S.activeTab === 'slide')   _renderPropsSlide(clip);
        if (S.activeTab === 'effects') _renderPropsEffects(clip);
    }

    function _renderPropsSubsGlobal() {
        const subs = S.subtitles;
        propsBody.innerHTML = `
    <div class="ive-subs-header">
        <button class="btn btn-sm" id="pv-add-sub">+ Субтитр</button>
        <span style="font-size:10px;color:var(--text-dim)">Независимая дорожка</span>
    </div>
    <div id="pv-subs-list">${subs.map((sub, si) => `
    <details class="ive-sub-item${si === S.selSubIdx ? ' ive-sub-sel' : ''}" data-subitem="${si}"${si === S.selSubIdx ? ' open' : ''}>
        <summary class="ive-sub-hdr">
            <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden">
                <span style="flex-shrink:0;font-weight:700">#${si + 1}</span>
                <span class="ive-sub-preview-text">${eh((sub.text || '—').slice(0, 28))}</span>
            </div>
            <div style="display:flex;gap:2px;align-items:center;flex-shrink:0" onclick="event.stopPropagation()">
                <button class="ive-style-btn${sub.bold      ? ' active' : ''}" data-sbf="bold"      data-si="${si}"><b>B</b></button>
                <button class="ive-style-btn${sub.italic    ? ' active' : ''}" data-sbf="italic"    data-si="${si}"><i>I</i></button>
                <button class="ive-style-btn${sub.underline ? ' active' : ''}" data-sbf="underline" data-si="${si}"><u>U</u></button>
                ${subs.length > 1 ? `<button class="btn btn-xs" data-apply-all="${si}" title="Применить стиль ко всем">→ все</button>` : ''}
                <button class="hist-btn danger" data-sdel="${si}">${ICONS.trash}</button>
            </div>
        </summary>
        <div class="ive-sub-body">
        <label class="ive-label">Текст<textarea class="ive-textarea" data-sf="text" data-si="${si}" rows="2">${eh(sub.text || '')}</textarea></label>
        <div class="ive-row2">
            <label class="ive-label">Нач.(с)<input class="ive-input" type="number" data-sf="start" data-si="${si}" min="0" step="0.1" value="${(sub.start ?? 0).toFixed(1)}"></label>
            <label class="ive-label">Кон.(с)<input class="ive-input" type="number" data-sf="end"   data-si="${si}" min="0" step="0.1" value="${(sub.end ?? 3).toFixed(1)}"></label>
        </div>
        <div class="ive-row2">
            <label class="ive-label">X%<input class="ive-input" type="number" data-sf="x" data-si="${si}" min="0" max="100" value="${sub.x ?? 50}"></label>
            <label class="ive-label">Y%<input class="ive-input" type="number" data-sf="y" data-si="${si}" min="0" max="100" value="${sub.y ?? 88}"></label>
        </div>
        <div class="ive-row2">
            <label class="ive-label" title="Ширина (0 = авто)">Width%<input class="ive-input" type="number" data-sf="w" data-si="${si}" min="0" max="100" step="1" value="${sub.w || 0}" placeholder="Авто"></label>
            <label class="ive-label" title="Высота в пикселях (0 = авто)">Height px<input class="ive-input" type="number" data-sf="h" data-si="${si}" min="0" max="2000" step="10" value="${sub.h || 0}" placeholder="Авто"></label>
        </div>
        <div class="ive-row2">
            <label class="ive-label">Вращение°<input class="ive-input" type="number" data-sf="rotation" data-si="${si}" min="-180" max="180" step="1" value="${sub.rotation || 0}"></label>
            <label class="ive-label">Шрифт<select class="ive-select" data-sf="fontFamily" data-si="${si}">${FONTS.map(f => `<option${sub.fontFamily === f ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
        </div>
        <div class="ive-row2">
            <label class="ive-label">Размер<input class="ive-input" type="number" data-sf="fontSize" data-si="${si}" min="8" max="300" value="${sub.fontSize || 40}"></label>
            <label class="ive-label">Цвет<input class="ive-input" type="color" data-sf="color" data-si="${si}" value="${sub.color || '#ffffff'}"></label>
        </div>
        <div class="ive-row2">
            <label class="ive-label">Контур<input class="ive-input" type="number" data-sf="outline" data-si="${si}" min="0" max="15" step="0.5" value="${sub.outline ?? 2}"></label>
            <label class="ive-label">Тень<input class="ive-input" type="number" data-sf="shadow" data-si="${si}" min="0" max="15" step="0.5" value="${sub.shadow ?? 1}"></label>
        </div>
        <div class="ive-row2">
            <label class="ive-label">Фон цвет<input class="ive-input" type="color" data-sf="bgColor" data-si="${si}" value="${sub.bgColor || '#000000'}"></label>
            <label class="ive-label">Прозрачн.
                <div class="ive-range-row">
                    <input class="ive-range" type="range" data-sf="bgOpacity" data-si="${si}" min="0" max="1" step="0.05" value="${sub.bgOpacity ?? 0}">
                    <span class="ive-range-val">${((sub.bgOpacity ?? 0) * 100).toFixed(0)}%</span>
                </div>
            </label>
        </div>
        <div class="ive-row2">
            <label class="ive-label">Анимация
                <select class="ive-select" data-sf="animation" data-si="${si}">
                    ${ANIMS.map(a => `<option value="${a}"${(sub.animation||'none')===a?' selected':''}>${a}</option>`).join('')}
                </select>
            </label>
            <label class="ive-label">Длит. анимации (с)
                <input class="ive-input" type="number" data-sf="animDuration" data-si="${si}" min="0.1" max="10" step="0.1" value="${(sub.animDuration || 0.6).toFixed(1)}">
            </label>
        </div>
        <label class="ive-label">Выравн.
            <div class="ive-row3">
                <button class="ive-align-btn${(sub.align||'center')==='left'?' active':''}" data-align="left" data-si="${si}">${ICONS.alignLeft}</button>
                <button class="ive-align-btn${(sub.align||'center')==='center'?' active':''}" data-align="center" data-si="${si}">${ICONS.alignCenter}</button>
                <button class="ive-align-btn${(sub.align||'center')==='right'?' active':''}" data-align="right" data-si="${si}">${ICONS.alignRight}</button>
            </div>
        </label>
        <details class="ive-sub-extra">
            <summary>Дополнительно</summary>
            <div class="ive-row2">
                <label class="ive-label">Цвет контура<input class="ive-input" type="color" data-sf="outlineColor" data-si="${si}" value="${sub.outlineColor || '#000000'}"></label>
                <label class="ive-label">Цвет тени<input class="ive-input" type="color" data-sf="shadowColor" data-si="${si}" value="${sub.shadowColor || '#000000'}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">Межстрочный<input class="ive-input" type="number" data-sf="lineHeight" data-si="${si}" min="0.5" max="4" step="0.05" value="${(sub.lineHeight || 1.35).toFixed(2)}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">Отступ фон X<input class="ive-input" type="number" data-sf="bgPadX" data-si="${si}" min="0" max="100" value="${sub.bgPadX ?? 12}"></label>
                <label class="ive-label">Отступ фон Y<input class="ive-input" type="number" data-sf="bgPadY" data-si="${si}" min="0" max="100" value="${sub.bgPadY ?? 6}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">Радиус фона<input class="ive-input" type="number" data-sf="bgRadius" data-si="${si}" min="0" max="50" value="${sub.bgRadius ?? 4}"></label>
            </div>
            <div class="ive-sub-karaoke">
                <label class="ive-label" style="flex-direction:row;align-items:center;gap:6px;font-size:12px">
                    <input type="checkbox" data-sf="karaokeEnable" data-si="${si}"${sub.karaokeEnable ? ' checked' : ''}>
                    <span>Подсветка слов</span>
                </label>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px">
                    <select class="ive-select" data-sf="karaokeMode" data-si="${si}" style="font-size:12px;padding:2px 4px">
                        <option value="word"${(!sub.karaokeMode || sub.karaokeMode === 'word') ? ' selected' : ''}>Только слово</option>
                        <option value="cumulative"${sub.karaokeMode === 'cumulative' ? ' selected' : ''}>Накопительно</option>
                    </select>
                    <input class="ive-input" type="color" data-sf="karaokeColor" data-si="${si}" value="${sub.karaokeColor || '#ffdd00'}">
                </div>
            </div>
            <label class="ive-label ive-sub-above-row" style="flex-direction:row;align-items:center;gap:6px;font-size:12px;margin-top:6px">
                <input type="checkbox" data-sf="aboveEffects" data-si="${si}"${sub.aboveEffects ? ' checked' : ''}>
                <span title="Субтитр отображается поверх фильтров и эффектов изображения">☑ Поверх эффектов (Always On Top)</span>
            </label>
        </details>
        </div>
    </details>`).join('')}</div>`;

        // Accordion: open one → select it, close others
        propsBody.querySelectorAll('[data-subitem]').forEach(details => {
            details.addEventListener('toggle', () => {
                if (details.open) {
                    S.selSubIdx = +details.dataset.subitem;
                    propsBody.querySelectorAll('[data-subitem]').forEach(other => {
                        if (other !== details && other.open) other.open = false;
                    });
                    renderTimeline(); renderPreview();
                }
            });
        });

        propsBody.querySelectorAll('[data-apply-all]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const srcIdx = +btn.dataset.applyAll;
                const src = S.subtitles[srcIdx]; if (!src) return;
                const keys = ['fontFamily','fontSize','color','bold','italic','underline',
                              'outline','outlineColor','shadow','shadowColor',
                              'bgColor','bgOpacity','bgPadX','bgPadY','bgRadius',
                              'animation','animDuration','align','lineHeight',
                              'karaokeEnable','karaokeColor','karaokeMode',
                              'x','y','rotation','w','h','aboveEffects'];
                S.subtitles.forEach((sub, si) => {
                    if (si === srcIdx) return;
                    keys.forEach(k => { if (src[k] !== undefined) sub[k] = src[k]; });
                });
                S.dirty = true; renderProps(); renderPreview();
                toast(`Стиль #${srcIdx + 1} применён к ${subs.length - 1} субтитрам`, 'ok');
            });
        });

        $('pv-add-sub').addEventListener('click', () => {
            const t = S.currentTime;
            S.subtitles.push({ id: uid(), text: '', start: Math.round(t * 10) / 10, end: Math.round((t + 3) * 10) / 10,
                x: 50, y: 88, w: 0, h: 0, fontFamily: 'Arial', fontSize: 40, color: '#ffffff',
                outline: 2, outlineColor: '#000000', shadow: 1, shadowColor: '#000000',
                bold: false, italic: false, underline: false,
                align: 'center', bgColor: '#000000', bgOpacity: 0, bgPadX: 12, bgPadY: 6, bgRadius: 4,
                animation: 'none', animDuration: 0.6, rotation: 0,
                lineHeight: 1.35, karaokeEnable: false, karaokeColor: '#ffdd00', karaokeMode: 'word',
                aboveEffects: false });
            _pushHistory();
            S.selSubIdx = S.subtitles.length - 1;
            S.dirty = true; renderProps(); renderPreview(); renderTimeline();
        });

        propsBody.querySelectorAll('[data-sdel]').forEach(btn => {
            btn.addEventListener('click', () => {
                S.subtitles.splice(+btn.dataset.sdel, 1);
                if (S.selSubIdx >= S.subtitles.length) S.selSubIdx = S.subtitles.length - 1;
                S.dirty = true; renderProps(); renderPreview(); renderTimeline();
            });
        });

        propsBody.querySelectorAll('[data-sbf]').forEach(btn => {
            btn.addEventListener('click', () => {
                const si = +btn.dataset.si, key = btn.dataset.sbf;
                const sub = S.subtitles[si]; if (!sub) return;
                sub[key] = !sub[key]; btn.classList.toggle('active', sub[key]);
                S.dirty = true; renderPreview();
            });
        });

        propsBody.querySelectorAll('[data-align]').forEach(btn => {
            btn.addEventListener('click', () => {
                const si = +btn.dataset.si;
                const sub = S.subtitles[si]; if (!sub) return;
                sub.align = btn.dataset.align;
                btn.closest('.ive-row3')?.querySelectorAll('.ive-align-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                S.dirty = true; renderPreview();
            });
        });

        propsBody.querySelectorAll('[data-sf][data-si]').forEach(el => {
            const ev = el.tagName === 'TEXTAREA' ? 'input' : 'change';
            el.addEventListener(ev, () => {
                const sub = S.subtitles[+el.dataset.si]; if (!sub) return;
                const key = el.dataset.sf;
                if (el.type === 'checkbox') sub[key] = el.checked;
                else if (el.type === 'number') sub[key] = parseFloat(el.value) || 0;
                else if (el.type === 'range') {
                    sub[key] = parseFloat(el.value);
                    const vEl = el.nextElementSibling;
                    if (vEl?.classList.contains('ive-range-val')) vEl.textContent = key === 'bgOpacity' ? Math.round(parseFloat(el.value) * 100) + '%' : el.value;
                } else sub[key] = el.value;
                S.dirty = true; renderPreview();
                if (['start', 'end'].includes(key)) renderTimeline();
            });
        });
    }

    function _renderPropsAudio(track, idx) {
        const AUDIO_FX = [
            { type: 'echo',       label: 'Эхо',       params: [{key:'delay',label:'Задержка (мс)',min:50,max:2000,step:50,def:500},{key:'decay',label:'Затухание',min:0.1,max:1,step:0.1,def:0.5}] },
            { type: 'reverb',     label: 'Реверб',    params: [{key:'delay',label:'Задержка (мс)',min:50,max:3000,step:50,def:1000},{key:'decay',label:'Затухание',min:0.1,max:1,step:0.1,def:0.8}] },
            { type: 'bassboost',  label: 'Бас',       params: [{key:'gain',label:'Усиление (дБ)',min:-20,max:20,step:1,def:10}] },
            { type: 'treble',     label: 'Тембр',     params: [{key:'gain',label:'Усиление (дБ)',min:-20,max:20,step:1,def:8}] },
            { type: 'compressor', label: 'Компрес.',  params: [{key:'ratio',label:'Коэффициент',min:1,max:20,step:0.5,def:4}] },
            { type: 'phone',      label: 'Телефон',   params: [] },
            { type: 'radio',      label: 'Радио',     params: [] },
            { type: 'lowpass',    label: 'НЧ фильтр', params: [{key:'freq',label:'Частота (Гц)',min:100,max:8000,step:100,def:500}] },
            { type: 'highpass',   label: 'ВЧ фильтр', params: [{key:'freq',label:'Частота (Гц)',min:200,max:12000,step:200,def:2000}] },
            { type: 'chorus',     label: 'Хорус',     params: [] },
            { type: 'flanger',    label: 'Флэнджер',  params: [] },
            { type: 'distortion', label: 'Дисторшн',  params: [{key:'level',label:'Уровень',min:0.5,max:5,step:0.1,def:1.5}] },
            { type: 'noise',      label: 'Шумодав',   params: [] },
            { type: 'pitch',      label: 'Питч',      params: [{key:'semitones',label:'Полутоны',min:-12,max:12,step:1,def:2}] },
        ];
        const SPEED_VALS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
        const curSpeed = track.speed ?? 1;
        const isCustomSpeed = !SPEED_VALS.includes(curSpeed);

        propsBody.innerHTML = `
        <div class="ive-audio-props-item">
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${eh(track.original || track.file)}</div>
            <label class="ive-label">Громкость
                <div class="ive-range-row">
                    <input class="ive-range" type="range" id="acp-vol" min="0" max="2" step="0.02" value="${track.volume ?? 1}">
                    <span class="ive-range-val" id="acp-vol-v">${(track.volume ?? 1).toFixed(2)}</span>
                </div>
            </label>
            <div class="ive-row2">
                <label class="ive-label">Fade In (с)<input class="ive-input" id="acp-fi" type="number" min="0" max="30" step="0.5" value="${track.fadeIn || 0}"></label>
                <label class="ive-label">Fade Out (с)<input class="ive-input" id="acp-fo" type="number" min="0" max="30" step="0.5" value="${track.fadeOut || 0}"></label>
            </div>
            <label class="ive-label">Начало (с)<input class="ive-input" id="acp-offset" type="number" min="0" step="0.5" value="${track.startOffset || 0}"></label>
            <label class="ive-label">Длит. (с)<input class="ive-input" id="acp-dur" type="number" min="0" step="0.5" placeholder="авто" value="${track.duration !== undefined ? track.duration : ''}"></label>
            <label class="ive-label">Скорость
                <select class="ive-select" id="acp-speed">
                    ${SPEED_VALS.map(v => `<option value="${v}"${curSpeed===v?' selected':''}>${v===1?'1× (норма)':v+'×'}</option>`).join('')}
                    <option value="custom"${isCustomSpeed?' selected':''}>Другое…</option>
                </select>
            </label>
            <div id="acp-speed-custom-wrap" style="display:${isCustomSpeed?'block':'none'};margin-top:2px">
                <input class="ive-input" id="acp-speed-custom" type="number" min="0.1" max="10" step="0.05" placeholder="напр. 1.8" value="${isCustomSpeed?curSpeed:''}">
            </div>
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:8px 0 4px">Звуковые эффекты</div>
            <div class="ive-sfx-chips" id="acp-sfx-chips"></div>
            <div id="acp-sfx-params"></div>
            <button class="btn btn-sm" id="acp-split" style="margin-top:8px" title="Разделить в позиции курсора">✂ Разделить</button>
            <button class="btn btn-sm danger" id="acp-del" style="margin-top:6px">Удалить дорожку</button>
        </div>`;

        const volEl = $('acp-vol'), volV = $('acp-vol-v');
        volEl.addEventListener('input', () => {
            track.volume = parseFloat(volEl.value);
            volV.textContent = track.volume.toFixed(2);
            S.dirty = true;
            const el = _audioEls.get(track.id);
            if (el) el.volume = Math.max(0, Math.min(1, track.volume));
        });
        $('acp-fi').addEventListener('change', e => { track.fadeIn = parseFloat(e.target.value) || 0; S.dirty = true; });
        $('acp-fo').addEventListener('change', e => { track.fadeOut = parseFloat(e.target.value) || 0; S.dirty = true; });
        $('acp-offset').addEventListener('change', e => { track.startOffset = parseFloat(e.target.value) || 0; S.dirty = true; renderTimeline(); });
        $('acp-dur').addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            track.duration = isFinite(v) && v > 0 ? v : undefined;
            S.dirty = true; renderTimeline();
        });

        const speedSel = $('acp-speed'), speedCustomWrap = $('acp-speed-custom-wrap'), speedCustom = $('acp-speed-custom');
        const _applySpeed = (val) => {
            track.speed = val;
            S.dirty = true;
            const el = _audioEls.get(track.id);
            if (el) el.playbackRate = val;
        };
        speedSel.addEventListener('change', () => {
            if (speedSel.value === 'custom') {
                speedCustomWrap.style.display = 'block';
                speedCustom.focus();
            } else {
                speedCustomWrap.style.display = 'none';
                _applySpeed(parseFloat(speedSel.value) || 1);
            }
        });
        speedCustom.addEventListener('change', () => {
            const v = parseFloat(speedCustom.value);
            if (isFinite(v) && v > 0) _applySpeed(v);
        });

        // ── Sound effects ──────────────────────────────────────────────────────
        if (!track.soundEffects) track.soundEffects = [];

        function _sfxRender() {
            const chipsEl = $('acp-sfx-chips'), paramsEl = $('acp-sfx-params');
            if (!chipsEl || !paramsEl) return;
            chipsEl.innerHTML = AUDIO_FX.map(fx => {
                const on = track.soundEffects.some(e => e.type === fx.type);
                return `<button class="ive-sfx-chip${on?' active':''}" data-fxt="${fx.type}">${fx.label}</button>`;
            }).join('');
            paramsEl.innerHTML = '';
            track.soundEffects.forEach(eff => {
                const fxDef = AUDIO_FX.find(f => f.type === eff.type);
                if (!fxDef || !fxDef.params.length) return;
                const wrap = document.createElement('div');
                wrap.className = 'ive-sfx-params-block';
                wrap.innerHTML = `<div class="ive-sfx-params-label">${fxDef.label}</div>` +
                    fxDef.params.map(p => {
                        const val = eff[p.key] !== undefined ? eff[p.key] : p.def;
                        return `<label class="ive-label">${p.label}
                            <div class="ive-range-row">
                                <input class="ive-range" type="range" data-efft="${eff.type}" data-pk="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">
                                <span class="ive-range-val" id="sfxv-${eff.type}-${p.key}">${val}</span>
                            </div></label>`;
                    }).join('');
                paramsEl.appendChild(wrap);
            });
            chipsEl.querySelectorAll('.ive-sfx-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.fxt;
                    const i = track.soundEffects.findIndex(e => e.type === type);
                    if (i >= 0) {
                        track.soundEffects.splice(i, 1);
                    } else {
                        const fxDef = AUDIO_FX.find(f => f.type === type);
                        const entry = { type };
                        if (fxDef) fxDef.params.forEach(p => { entry[p.key] = p.def; });
                        track.soundEffects.push(entry);
                    }
                    S.dirty = true; _sfxRender();
                });
            });
            paramsEl.querySelectorAll('input[data-efft]').forEach(rng => {
                rng.addEventListener('input', () => {
                    const eff = track.soundEffects.find(e => e.type === rng.dataset.efft);
                    if (!eff) return;
                    const val = parseFloat(rng.value);
                    eff[rng.dataset.pk] = val;
                    const vEl = $(`sfxv-${rng.dataset.efft}-${rng.dataset.pk}`);
                    if (vEl) vEl.textContent = val;
                    S.dirty = true;
                });
            });
        }
        _sfxRender();

        $('acp-split').addEventListener('click', () => {
            const t = S.currentTime;
            const st = track.startOffset || 0;
            const origDur = track.originalDuration || 3600;
            const usedDur = track.duration !== undefined ? track.duration : Math.max(1, totalDur() - st);
            const end = st + usedDur;
            if (t <= st + 0.05 || t >= end - 0.05) {
                toast('Поставьте курсор внутри аудио дорожки', 'warn'); return;
            }
            const firstDur = t - st;
            const audioSplitPos = (track.trimIn || 0) + firstDur;
            const secondDur = end - t;
            track.duration = firstDur;
            const newTrack = { ...track, id: uid(), startOffset: t, trimIn: Math.min(audioSplitPos, origDur - 0.1), duration: secondDur };
            const ti = S.audioTracks.indexOf(track);
            S.audioTracks.splice(ti + 1, 0, newTrack);
            S.dirty = true; renderTimeline(); renderProps();
            toast('Аудио разделено', 'ok');
        });
        $('acp-del').addEventListener('click', () => { S.audioTracks.splice(idx, 1); S.selAudioIdx = -1; S.dirty = true; renderAll(); });
    }

    function _renderPropsSlide(clip) {
        const isVideo = clip.type === 'video';
        propsBody.innerHTML = `
        <div class="ive-form">
            ${isVideo ? `<div style="font-size:10px;color:var(--text-dim);padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${eh(clip.original)}</div>` : ''}
            <label class="ive-label">Длительность (с)
                <input class="ive-input" id="pv-dur" type="number" min="0.5" max="300" step="0.5" value="${clip.duration}">
            </label>
            <label class="ive-label">Переход
                <select class="ive-select" id="pv-trans-type">
                    ${TRANSITIONS.map(t => `<option value="${t.value}"${clip.transition?.type === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}
                </select>
            </label>
            <label class="ive-label" id="pv-tdur-row" ${(!clip.transition?.type || clip.transition.type === 'none') ? 'hidden' : ''}>Длит. перехода (с)
                <input class="ive-input" id="pv-trans-dur" type="number" min="0.1" max="4" step="0.1" value="${clip.transition?.duration || 0.5}">
            </label>
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 2px">Начальный эффект</div>
            <label class="ive-label">Тип
                <select class="ive-select" id="pv-start-eff-type">
                    ${START_EFFECTS.map(e => `<option value="${e.value}"${(clip.startEffect?.type||'none')===e.value?' selected':''}>${e.label}</option>`).join('')}
                </select>
            </label>
            <label class="ive-label" id="pv-start-eff-dur-row" ${(!clip.startEffect?.type||clip.startEffect.type==='none')?'hidden':''}>Длит. (с)
                <input class="ive-input" id="pv-start-eff-dur" type="number" min="0.1" max="${clip.duration}" step="0.1" value="${clip.startEffect?.duration||1.0}">
            </label>
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 2px">Конечный эффект</div>
            <label class="ive-label">Тип
                <select class="ive-select" id="pv-end-eff-type">
                    ${END_EFFECTS.map(e => `<option value="${e.value}"${(clip.endEffect?.type||'none')===e.value?' selected':''}>${e.label}</option>`).join('')}
                </select>
            </label>
            <label class="ive-label" id="pv-end-eff-dur-row" ${(!clip.endEffect?.type||clip.endEffect.type==='none')?'hidden':''}>Длит. (с)
                <input class="ive-input" id="pv-end-eff-dur" type="number" min="0.1" max="${clip.duration}" step="0.1" value="${clip.endEffect?.duration||1.0}">
            </label>
            <label class="ive-label">Скорость
                <select class="ive-select" id="pv-speed">
                    <option value="0.25"${(clip.speed??1)===0.25?' selected':''}>0.25×</option>
                    <option value="0.5"${(clip.speed??1)===0.5?' selected':''}>0.5×</option>
                    <option value="0.75"${(clip.speed??1)===0.75?' selected':''}>0.75×</option>
                    <option value="1"${(!clip.speed||clip.speed===1)?' selected':''}>1× (норма)</option>
                    <option value="1.25"${(clip.speed??1)===1.25?' selected':''}>1.25×</option>
                    <option value="1.5"${(clip.speed??1)===1.5?' selected':''}>1.5×</option>
                    <option value="2"${(clip.speed??1)===2?' selected':''}>2×</option>
                    <option value="4"${(clip.speed??1)===4?' selected':''}>4×</option>
                </select>
            </label>
            ${isVideo ? `<label class="ive-toggle-row ive-label">Убрать аудио видео
                <input class="ive-toggle" type="checkbox" id="pv-mute-audio"${clip.muteAudio ? ' checked' : ''}>
            </label>
            <label class="ive-label">Вход (с)
                <input class="ive-input" id="pv-trimin" type="number" min="0" step="0.1" value="${clip.trimIn || 0}" title="Начальная точка в файле">
            </label>` : ''}
            ${!isVideo ? `<div class="ive-label ive-row-btns" style="margin-top:4px">
                <span>Изображение</span>
                <input type="file" id="pv-replace-file" accept=".jpg,.jpeg,.png,.webp,.bmp" hidden>
                <button class="btn btn-sm" id="pv-replace-btn">Заменить</button>
            </div>
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 2px">Трансформация</div>
            <label class="ive-label">Масштаб%<input class="ive-input" type="number" id="pv-img-scale" min="10" max="500" step="5" value="${clip.imgScale||100}"></label>
            <div class="ive-row2">
                <label class="ive-label">Смещ. X<input class="ive-input" type="number" id="pv-img-ox" min="-100" max="100" step="1" value="${clip.imgOffsetX||0}"></label>
                <label class="ive-label">Смещ. Y<input class="ive-input" type="number" id="pv-img-oy" min="-100" max="100" step="1" value="${clip.imgOffsetY||0}"></label>
            </div>
            <div class="ive-row2">
                <button class="btn btn-sm" id="pv-crop-btn">${clip.crop && clip.crop.w < 100 ? '✂ Обрезка (' + Math.round(clip.crop.w) + '×' + Math.round(clip.crop.h) + '%)' : '✂ Обрезать'}</button>
                <button class="btn btn-sm" id="pv-reset-transform" title="Сбросить трансформацию">↺ Сброс</button>
            </div>` : ''}
            ${isVideo ? `<button class="btn btn-sm" id="pv-extract-audio" style="margin-top:4px">Извлечь аудио</button>` : ''}
            <button class="btn btn-sm" id="pv-apply-all" style="margin-top:4px">Apply to All</button>
            <button class="btn btn-sm danger" id="pv-remove-clip" style="margin-top:4px">Удалить клип</button>
        </div>`;

        $('pv-dur').addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            if (isFinite(v) && v >= 0.5) { clip.duration = v; S.dirty = true; renderTimeline(); renderMediaList(); }
        });
        const ttEl = $('pv-trans-type'), tdRow = $('pv-tdur-row');
        ttEl.addEventListener('change', () => {
            clip.transition = clip.transition || {};
            clip.transition.type = ttEl.value;
            tdRow.hidden = ttEl.value === 'none';
            S.dirty = true; renderTimeline();
        });
        $('pv-trans-dur')?.addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            if (isFinite(v) && v > 0) { clip.transition.duration = v; S.dirty = true; }
        });
        const seTypeEl = $('pv-start-eff-type'), seDurRow = $('pv-start-eff-dur-row');
        seTypeEl.addEventListener('change', () => {
            clip.startEffect = clip.startEffect || {};
            clip.startEffect.type = seTypeEl.value;
            seDurRow.hidden = seTypeEl.value === 'none';
            S.dirty = true; renderPreview();
        });
        $('pv-start-eff-dur')?.addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            if (isFinite(v) && v > 0) { (clip.startEffect = clip.startEffect || {}).duration = v; S.dirty = true; renderPreview(); }
        });
        const eeTypeEl = $('pv-end-eff-type'), eeDurRow = $('pv-end-eff-dur-row');
        eeTypeEl.addEventListener('change', () => {
            clip.endEffect = clip.endEffect || {};
            clip.endEffect.type = eeTypeEl.value;
            eeDurRow.hidden = eeTypeEl.value === 'none';
            S.dirty = true; renderPreview();
        });
        $('pv-end-eff-dur')?.addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            if (isFinite(v) && v > 0) { (clip.endEffect = clip.endEffect || {}).duration = v; S.dirty = true; renderPreview(); }
        });
        if (!isVideo) {
            $('pv-replace-btn').addEventListener('click', () => $('pv-replace-file').click());
            $('pv-replace-file').addEventListener('change', async () => {
                const f = $('pv-replace-file').files[0]; if (!f) return;
                const fd = new FormData(); fd.append('file', f);
                try {
                    const r = await fetch('/api/imgvid/images', { method: 'POST', body: fd });
                    const d = await r.json();
                    clip.file = d.name; clip.fileUrl = d.url; clip.thumbUrl = d.url; clip.original = d.original;
                    S.dirty = true; log('Изображение заменено: ' + d.original, 'done'); renderAll();
                } catch (err) { toast(err.message, 'err'); }
                $('pv-replace-file').value = '';
            });
        }
        if (!isVideo) {
            $('pv-img-scale')?.addEventListener('change', e => {
                clip.imgScale = Math.max(10, Math.min(500, parseFloat(e.target.value) || 100));
                S.dirty = true; renderPreview();
            });
            $('pv-img-ox')?.addEventListener('change', e => {
                clip.imgOffsetX = parseFloat(e.target.value) || 0;
                S.dirty = true; renderPreview();
            });
            $('pv-img-oy')?.addEventListener('change', e => {
                clip.imgOffsetY = parseFloat(e.target.value) || 0;
                S.dirty = true; renderPreview();
            });
            $('pv-crop-btn')?.addEventListener('click', () => _openCropDialog(clip));
            $('pv-reset-transform')?.addEventListener('click', () => {
                clip.imgScale = 100; clip.imgOffsetX = 0; clip.imgOffsetY = 0; clip.crop = null;
                S.dirty = true; renderPreview(); renderProps();
            });
        }
        $('pv-speed').addEventListener('change', e => {
            clip.speed = parseFloat(e.target.value) || 1;
            S.dirty = true; renderPreview();
        });
        if (isVideo) {
            $('pv-mute-audio')?.addEventListener('change', e => {
                clip.muteAudio = e.target.checked;
                S.dirty = true;
            });
            $('pv-trimin')?.addEventListener('change', e => {
                clip.trimIn = Math.max(0, parseFloat(e.target.value) || 0);
                S.dirty = true; renderPreview();
            });
        }
        $('pv-apply-all').addEventListener('click', () => {
            S.clips.forEach((c, idx) => {
                if (c === clip) return;
                c.duration    = clip.duration;
                c.transition  = JSON.parse(JSON.stringify(clip.transition  || {}));
                c.startEffect = JSON.parse(JSON.stringify(clip.startEffect || {}));
                c.endEffect   = JSON.parse(JSON.stringify(clip.endEffect   || {}));
                c.speed      = clip.speed;
                c.muteAudio  = clip.muteAudio;
                c.trimIn     = clip.trimIn;
            });
            S.dirty = true;
            toast(`Настройки применены к ${S.clips.length - 1} клипам`, 'ok');
            renderTimeline(); renderMediaList();
        });
        $('pv-remove-clip').addEventListener('click', () => { _deleteSelectedClip(); });
        if (isVideo) {
            $('pv-extract-audio')?.addEventListener('click', async () => {
                toast('Извлечение аудио…', 'info');
                try {
                    const r = await fetch('/api/imgvid/extract-audio', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file: clip.file }),
                    });
                    const d = await r.json();
                    if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
                    const track = { id: uid(), file: d.name, fileUrl: d.url, original: d.original, volume: 1, fadeIn: 0, fadeOut: 0, startOffset: 0, trimIn: 0, originalDuration: d.duration || undefined };
                    S.audioTracks.push(track);
                    S.dirty = true; log('Аудио извлечено: ' + d.original, 'done');
                    renderMediaList(); renderTimeline();
                    toast('Аудио добавлено в таймлайн', 'ok');
                } catch (e) { toast(e.message, 'err'); }
            });
        }
    }

    function _openCropDialog(clip) {
        const modal = document.getElementById('ive-crop-modal');
        if (!modal) { toast('Модальное окно кропа не найдено', 'err'); return; }
        const crop = clip.crop || { x: 0, y: 0, w: 100, h: 100 };
        document.getElementById('ive-crop-x').value = crop.x || 0;
        document.getElementById('ive-crop-y').value = crop.y || 0;
        document.getElementById('ive-crop-w').value = crop.w || 100;
        document.getElementById('ive-crop-h').value = crop.h || 100;
        const prevImg = document.getElementById('ive-crop-preview-img');
        if (prevImg) prevImg.src = clip.fileUrl || '';
        modal.hidden = false;

        const applyPreset = (ar) => {
            const xEl = document.getElementById('ive-crop-x');
            const yEl = document.getElementById('ive-crop-y');
            const wEl = document.getElementById('ive-crop-w');
            const hEl = document.getElementById('ive-crop-h');
            if (ar === 'original') { xEl.value=0; yEl.value=0; wEl.value=100; hEl.value=100; return; }
            const [aw, ah] = ar.split(':').map(Number);
            const ratio = aw / ah;
            let w = 100, h = Math.round(100 / ratio);
            if (h > 100) { h = 100; w = Math.round(100 * ratio); }
            xEl.value = Math.round((100 - w) / 2);
            yEl.value = Math.round((100 - h) / 2);
            wEl.value = w;
            hEl.value = h;
        };

        modal.querySelectorAll('.ive-crop-preset').forEach(btn => {
            btn.onclick = () => applyPreset(btn.dataset.preset);
        });

        document.getElementById('ive-crop-ok').onclick = () => {
            const x = Math.max(0, parseFloat(document.getElementById('ive-crop-x').value) || 0);
            const y = Math.max(0, parseFloat(document.getElementById('ive-crop-y').value) || 0);
            const w = Math.max(1, parseFloat(document.getElementById('ive-crop-w').value) || 100);
            const h = Math.max(1, parseFloat(document.getElementById('ive-crop-h').value) || 100);
            clip.crop = (x === 0 && y === 0 && w >= 100 && h >= 100) ? null : { x, y, w, h };
            S.dirty = true; modal.hidden = true; renderPreview(); renderProps();
        };
        document.getElementById('ive-crop-cancel').onclick = () => { modal.hidden = true; };
    }

    // ── Full-featured subtitle editor ─────────────────────────────────────────
    function _renderPropsSubs(clip) {
        const subs = clip.subtitles || [];
        propsBody.innerHTML = `
        <div class="ive-subs-header"><button class="btn btn-sm" id="pv-add-sub">+ Субтитр</button></div>
        <div id="pv-subs-list">${subs.map((sub, si) => `
        <div class="ive-sub-item${si === 0 ? ' ive-sub-sel' : ''}" data-subitem="${si}">
            <div class="ive-sub-hdr">
                <span>#${si + 1}</span>
                <div style="display:flex;gap:2px">
                    <button class="ive-style-btn${sub.bold      ? ' active' : ''}" data-sbf="bold"      data-si="${si}" title="Жирный"><b>B</b></button>
                    <button class="ive-style-btn${sub.italic    ? ' active' : ''}" data-sbf="italic"    data-si="${si}" title="Курсив"><i>I</i></button>
                    <button class="ive-style-btn${sub.underline ? ' active' : ''}" data-sbf="underline" data-si="${si}" title="Подчёркнутый"><u>U</u></button>
                    <button class="hist-btn danger" data-sdel="${si}">${ICONS.trash}</button>
                </div>
            </div>
            <label class="ive-label">Текст
                <textarea class="ive-textarea" data-sf="text" data-si="${si}" rows="2">${eh(sub.text || '')}</textarea>
            </label>
            <div class="ive-row2">
                <label class="ive-label">Нач.(с)<input class="ive-input" type="number" data-sf="start" data-si="${si}" min="0" step="0.1" value="${sub.start ?? 0}"></label>
                <label class="ive-label">Кон.(с)<input class="ive-input" type="number" data-sf="end"   data-si="${si}" min="0" step="0.1" value="${sub.end ?? clip.duration}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">X%<input class="ive-input" type="number" data-sf="x" data-si="${si}" min="0" max="100" value="${sub.x ?? 50}"></label>
                <label class="ive-label">Y%<input class="ive-input" type="number" data-sf="y" data-si="${si}" min="0" max="100" value="${sub.y ?? 88}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">Вращение°<input class="ive-input" type="number" data-sf="rotation" data-si="${si}" min="-180" max="180" step="1" value="${sub.rotation || 0}"></label>
                <label class="ive-label">Выравн.
                    <div class="ive-row3">
                        <button class="ive-align-btn${(sub.align||'center')==='left'?' active':''}" data-align="left" data-si="${si}" title="По левому краю">${ICONS.alignLeft}</button>
                        <button class="ive-align-btn${(sub.align||'center')==='center'?' active':''}" data-align="center" data-si="${si}" title="По центру">${ICONS.alignCenter}</button>
                        <button class="ive-align-btn${(sub.align||'center')==='right'?' active':''}" data-align="right" data-si="${si}" title="По правому краю">${ICONS.alignRight}</button>
                    </div>
                </label>
            </div>
            <label class="ive-label">Шрифт
                <select class="ive-select" data-sf="fontFamily" data-si="${si}">${FONTS.map(f => `<option${sub.fontFamily === f ? ' selected' : ''}>${f}</option>`).join('')}</select>
            </label>
            <div class="ive-row2">
                <label class="ive-label">Размер<input class="ive-input" type="number" data-sf="fontSize" data-si="${si}" min="8" max="300" value="${sub.fontSize || 40}"></label>
                <label class="ive-label">Цвет<input class="ive-input" type="color" data-sf="color" data-si="${si}" value="${sub.color || '#ffffff'}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">Контур<input class="ive-input" type="number" data-sf="outline" data-si="${si}" min="0" max="15" step="0.5" value="${sub.outline ?? 2}"></label>
                <label class="ive-label">Тень<input class="ive-input" type="number" data-sf="shadow" data-si="${si}" min="0" max="15" step="0.5" value="${sub.shadow ?? 1}"></label>
            </div>
            <hr class="ive-divider">
            <div class="ive-row2">
                <label class="ive-label">Фон цвет<input class="ive-input" type="color" data-sf="bgColor" data-si="${si}" value="${sub.bgColor || '#000000'}"></label>
                <label class="ive-label">Прозрачн.
                    <div class="ive-range-row">
                        <input class="ive-range" type="range" data-sf="bgOpacity" data-si="${si}" min="0" max="1" step="0.05" value="${sub.bgOpacity ?? 0}">
                        <span class="ive-range-val">${((sub.bgOpacity ?? 0) * 100).toFixed(0)}%</span>
                    </div>
                </label>
            </div>
            <label class="ive-label">Анимация
                <select class="ive-select" data-sf="animation" data-si="${si}">
                    ${ANIMS.map(a => `<option value="${a}"${(sub.animation||'none')===a?' selected':''}>${a}</option>`).join('')}
                </select>
            </label>
        </div>`).join('')}</div>`;

        $('pv-add-sub').addEventListener('click', () => {
            if (!clip.subtitles) clip.subtitles = [];
            clip.subtitles.push({ id: uid(), text: '', start: 0, end: clip.duration,
                x: 50, y: 88, fontFamily: 'Arial', fontSize: 40, color: '#ffffff',
                outline: 2, shadow: 1, bold: false, italic: false, underline: false,
                align: 'center', bgColor: '#000000', bgOpacity: 0,
                animation: 'none', rotation: 0 });
            S.dirty = true; renderProps(); renderPreview();
        });

        propsBody.querySelectorAll('[data-sdel]').forEach(btn => {
            btn.addEventListener('click', () => {
                clip.subtitles.splice(+btn.dataset.sdel, 1);
                S.dirty = true; renderProps(); renderPreview(); renderTimeline();
            });
        });

        // B/I/U toggle buttons
        propsBody.querySelectorAll('[data-sbf]').forEach(btn => {
            btn.addEventListener('click', () => {
                const si  = +btn.dataset.si;
                const key = btn.dataset.sbf;
                const sub = clip.subtitles[si]; if (!sub) return;
                sub[key] = !sub[key];
                btn.classList.toggle('active', sub[key]);
                S.dirty = true; renderPreview();
            });
        });

        // Align buttons
        propsBody.querySelectorAll('[data-align]').forEach(btn => {
            btn.addEventListener('click', () => {
                const si  = +btn.dataset.si;
                const sub = clip.subtitles[si]; if (!sub) return;
                sub.align = btn.dataset.align;
                btn.closest('.ive-row3')?.querySelectorAll('.ive-align-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                S.dirty = true; renderPreview();
            });
        });

        // All data-sf inputs
        propsBody.querySelectorAll('[data-sf][data-si]').forEach(el => {
            const ev = el.tagName === 'TEXTAREA' ? 'input' : 'change';
            el.addEventListener(ev, () => {
                const sub = clip.subtitles[+el.dataset.si]; if (!sub) return;
                const key = el.dataset.sf;
                if (el.type === 'number') sub[key] = parseFloat(el.value) || 0;
                else if (el.type === 'range') {
                    sub[key] = parseFloat(el.value);
                    const valEl = el.nextElementSibling;
                    if (valEl?.classList.contains('ive-range-val')) {
                        valEl.textContent = key === 'bgOpacity'
                            ? Math.round(parseFloat(el.value) * 100) + '%'
                            : el.value;
                    }
                } else {
                    sub[key] = el.value;
                }
                S.dirty = true; renderPreview();
                if (['start', 'end'].includes(key)) renderTimeline();
            });
        });
    }

    function _renderPropsEffects(clip) {
        const efMap = Object.fromEntries((clip.effects || []).map(e => [e.type, e.value]));
        propsBody.innerHTML = `<div class="ive-form">${EFFECTS_DEF.map(ef => {
            const val = efMap[ef.key] ?? ef.def;
            if (ef.toggle) return `<label class="ive-label ive-toggle-row">${eh(ef.label)}<input class="ive-toggle" type="checkbox" data-ef="${ef.key}"${val ? ' checked' : ''}></label>`;
            return `<label class="ive-label"><span>${eh(ef.label)}</span><div class="ive-range-row"><input class="ive-range" type="range" data-ef="${ef.key}" min="${ef.min}" max="${ef.max}" step="${ef.step}" value="${val}"><span class="ive-range-val" data-efv="${ef.key}">${val}</span></div></label>`;
        }).join('')}<button class="btn btn-sm" id="pv-ef-all" style="margin-top:8px">Apply Effects to All</button><button class="btn btn-sm" id="pv-reset-ef" style="margin-top:4px">Сбросить всё</button></div>`;

        propsBody.querySelectorAll('[data-ef]').forEach(el => {
            const key = el.dataset.ef;
            el.addEventListener('input', () => {
                const v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value);
                const vEl = propsBody.querySelector(`[data-efv="${key}"]`);
                if (vEl) vEl.textContent = v;
                clip.effects = (clip.effects || []).filter(e => e.type !== key);
                if (v !== 0) clip.effects.push({ type: key, value: v });
                S.dirty = true; renderPreview();
            });
        });
        $('pv-ef-all').addEventListener('click', () => {
            S.clips.forEach(c => {
                if (c === clip) return;
                c.effects = JSON.parse(JSON.stringify(clip.effects || []));
            });
            S.dirty = true;
            toast(`Эффекты применены к ${S.clips.length - 1} клипам`, 'ok');
        });
        $('pv-reset-ef').addEventListener('click', () => { clip.effects = []; S.dirty = true; renderProps(); renderPreview(); });
    }

    // ── PIP Functions ─────────────────────────────────────────────────────────

    function _getPipEl(pip) {
        if (_pipEls.has(pip.id)) return _pipEls.get(pip.id);
        const wrapper = document.createElement('div');
        wrapper.className = 'ive-pip-el';
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        const video = document.createElement('video');
        video.muted = false;
        video.playsInline = true;
        wrapper.appendChild(img);
        wrapper.appendChild(video);
        // 8 resize handles
        for (const dir of ['nw','ne','sw','se','n','s','e','w']) {
            const rh = document.createElement('div');
            rh.className = `ive-pip-rh ive-pip-rh-${dir}`;
            rh.dataset.rhdir = dir;
            wrapper.appendChild(rh);
        }
        previewContent.appendChild(wrapper);
        const el = { wrapper, img, video };
        _pipEls.set(pip.id, el);
        _setupPipEvents(pip, el);
        return el;
    }

    function _positionPipEl(pip, el) {
        if (!el) return;
        const { wrapper } = el;
        wrapper.style.left    = (pip.x || 0) + '%';
        wrapper.style.top     = (pip.y || 0) + '%';
        wrapper.style.width   = (pip.w || 30) + '%';
        wrapper.style.height  = (pip.h || 20) + '%';
        wrapper.style.opacity = pip.opacity ?? 1;
        wrapper.style.filter  = buildCSSFilter(pip.effects || []);
        const isSelected = S.selPipIdx >= 0 && S.pipLayers[S.selPipIdx] === pip;
        wrapper.classList.toggle('selected', isSelected);
    }

    function _setupPipEvents(pip, el) {
        const { wrapper } = el;

        // Move: mousedown on wrapper (not on a resize handle)
        wrapper.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.target.dataset.rhdir) return; // Let resize handle it
            e.stopPropagation(); e.preventDefault();
            const rect = previewContent.getBoundingClientRect();
            const sx = e.clientX, sy = e.clientY;
            const pipIdx = S.pipLayers.indexOf(pip);
            // Preserve multi-selection if this pip is already part of it
            if (!S.selPipIdxs.has(pipIdx)) {
                S.selPipIdx = pipIdx;
                S.selPipIdxs = new Set([pipIdx]);
            } else {
                S.selPipIdx = pipIdx;
            }
            S.selIdx = -1; S.selAudioIdx = -1; S.selSubIdx = -1;
            renderTimeline(); renderProps();
            _positionPipEl(pip, el);
            // Capture initial positions of all selected PIPs for group drag
            const _dragPipData = [...S.selPipIdxs].map(pi2 => {
                const p2 = S.pipLayers[pi2] || {};
                return { pi: pi2, x0: p2.x || 0, y0: p2.y || 0 };
            });
            let moved = false;
            const onMove = ev => {
                const dx = ev.clientX - sx;
                const dy = ev.clientY - sy;
                if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                moved = true;
                _dragPipData.forEach(({ pi: pi2, x0: px0, y0: py0 }) => {
                    const p2 = S.pipLayers[pi2]; if (!p2) return;
                    p2.x = Math.max(0, Math.min(100, px0 + dx / rect.width * 100));
                    p2.y = Math.max(0, Math.min(100, py0 + dy / rect.height * 100));
                    const e2 = _pipEls.get(p2.id);
                    if (e2) _positionPipEl(p2, e2);
                });
                S.dirty = true;
                renderTimeline();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (moved) { _pushHistory(); renderProps(); }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Click (no drag) to select
        wrapper.addEventListener('click', e => {
            if (e.target.dataset.rhdir) return;
            const idx = S.pipLayers.indexOf(pip);
            if (idx < 0) return;
            S.selPipIdx = idx; S.selIdx = -1; S.selAudioIdx = -1; S.selSubIdx = -1;
            // Switch to slide tab
            S.activeTab = 'slide';
            document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
            document.querySelector('[data-ptab="slide"]')?.classList.add('active');
            renderTimeline(); renderProps(); renderPreview();
        });

        // Resize handles
        wrapper.querySelectorAll('.ive-pip-rh').forEach(handle => {
            handle.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const dir = handle.dataset.rhdir;
                const rect = previewContent.getBoundingClientRect();
                const sx = e.clientX, sy = e.clientY;
                const x0 = pip.x || 0, y0 = pip.y || 0;
                const w0 = pip.w || 30, h0 = pip.h || 20;
                let moved = false;
                const onMove = ev => {
                    moved = true;
                    const dx = (ev.clientX - sx) / rect.width * 100;
                    const dy = (ev.clientY - sy) / rect.height * 100;
                    let newX = x0, newY = y0, newW = w0, newH = h0;
                    // Width changes
                    if (dir.includes('e')) newW = w0 + dx;
                    if (dir.includes('w')) { newX = x0 + dx; newW = w0 - dx; }
                    // Height changes
                    if (dir.includes('s')) newH = h0 + dy;
                    if (dir.includes('n')) { newY = y0 + dy; newH = h0 - dy; }
                    // Proportional resize with Ctrl
                    if (ev.ctrlKey) {
                        if (dir === 'n' || dir === 's') {
                            newW = newH * (w0 / Math.max(1, h0));
                        } else if (dir === 'e' || dir === 'w') {
                            newH = newW * (Math.max(1, h0) / w0);
                        } else {
                            // Corner
                            const maxD = Math.max(Math.abs(dx), Math.abs(dy));
                            newW = w0 + maxD * Math.sign(dx || dy);
                            newH = newW * (Math.max(1, h0) / w0);
                        }
                    }
                    pip.x = Math.max(0, Math.min(100, newX));
                    pip.y = Math.max(0, Math.min(100, newY));
                    pip.w = Math.max(5, Math.min(100, newW));
                    pip.h = Math.max(5, Math.min(100, newH));
                    S.dirty = true;
                    _positionPipEl(pip, el);
                    renderTimeline();
                    renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
    }

    function _renderPipInPreview(currentTime) {
        const activeIds = new Set();
        for (const pip of S.pipLayers) {
            const start = pip.startTime || 0;
            const end   = pip.endTime ?? (start + 5);
            if (currentTime < start || currentTime >= end) continue;
            activeIds.add(pip.id);
            const el = _getPipEl(pip);
            _positionPipEl(pip, el);
            if (pip.type === 'image') {
                el.video.style.display = 'none';
                if (el.img.src !== pip.fileUrl) { el.img.src = pip.fileUrl; }
                el.img.style.display = 'block';
            } else {
                el.img.style.display = 'none';
                const pipUrl = pip.fileUrl || '';
                if (el.video.dataset.src !== pipUrl) {
                    el.video.src = pipUrl; el.video.dataset.src = pipUrl; el.video.load();
                }
                el.video.style.display = 'block';
                const vT = (currentTime - start) + (pip.trimIn || 0);
                const spd = pip.speed ?? 1;
                if (el.video.playbackRate !== spd) el.video.playbackRate = spd;
                el.video.volume = pip.volume ?? 0;
                if (!S.isPlaying) {
                    if (Math.abs(el.video.currentTime - vT) > 0.15) el.video.currentTime = vT;
                    if (!el.video.paused) el.video.pause();
                } else {
                    if (el.video.paused) el.video.play().catch(() => {});
                    if (Math.abs(el.video.currentTime - vT) > 0.3) el.video.currentTime = vT;
                }
            }
            el.wrapper.style.display = 'block';
        }
        // Hide inactive pip elements
        _pipEls.forEach((el, id) => {
            if (!activeIds.has(id)) {
                el.wrapper.style.display = 'none';
                if (el.video) el.video.pause();
            }
        });
    }

    function _renderPipTrack(total) {
        if (!pipTrackEl) return;
        const contentW = Math.max(total * S.pxPerSec, (tracksScroll.clientWidth || 500));
        pipTrackEl.style.width = contentW + 'px';
        pipTrackEl.innerHTML = '';
        if (!S.pipLayers.length) {
            pipTrackEl.innerHTML = '<div class="ive-tl-empty-abs" style="font-size:10px;opacity:.4">Нет PIP</div>';
            return;
        }
        S.pipLayers.forEach((pip, pi) => {
            const start = pip.startTime || 0;
            const end   = pip.endTime ?? (start + 5);
            const left  = start * S.pxPerSec;
            const w     = Math.max(16, (end - start) * S.pxPerSec);

            const item = document.createElement('div');
            const isMultiPipSel = S.selPipIdxs.size > 1 && S.selPipIdxs.has(pi);
            item.className = `ive-tl-pip-item${pi === S.selPipIdx ? ' sel' : ''}${isMultiPipSel ? ' multi-sel' : ''}`;
            item.style.left  = left + 'px';
            item.style.width = w + 'px';
            item.textContent = pip.original || pip.file;

            // Right resize handle
            const rh = document.createElement('div');
            rh.className = 'ive-tl-pip-resize';
            item.appendChild(rh);

            item.addEventListener('click', e => {
                if (e.target === rh) return;
                if (e.ctrlKey) {
                    if (S.selPipIdxs.has(pi)) {
                        S.selPipIdxs.delete(pi);
                        if (S.selPipIdx === pi) S.selPipIdx = [...S.selPipIdxs].at(-1) ?? -1;
                    } else {
                        S.selPipIdxs.add(pi);
                        S.selPipIdx = pi;
                    }
                    S.selIdx = -1; S.selIdxs = new Set();
                } else {
                    S.selPipIdx = pi; S.selPipIdxs = new Set([pi]);
                    S.selIdx = -1; S.selIdxs = new Set(); S.selAudioIdx = -1; S.selAudioIdxs = new Set(); S.selSubIdx = -1; S.selSubIdxs = new Set();
                }
                S.activeTab = 'slide';
                document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-ptab="slide"]')?.classList.add('active');
                renderTimeline(); renderProps(); renderPreview();
            });

            // Drag to move pip timing (and all selected PIPs together)
            item.addEventListener('mousedown', e => {
                if (e.button !== 0 || e.target === rh) return;
                if (e.ctrlKey) return; // Ctrl+click handled by click event
                e.preventDefault(); e.stopPropagation();
                // Preserve multi-selection if this pip is already selected
                if (!S.selPipIdxs.has(pi)) {
                    S.selPipIdx = pi; S.selPipIdxs = new Set([pi]);
                    S.selIdx = -1; S.selIdxs = new Set(); S.selAudioIdx = -1; S.selAudioIdxs = new Set(); S.selSubIdx = -1; S.selSubIdxs = new Set();
                } else {
                    S.selPipIdx = pi;
                }
                renderTimeline(); renderProps();
                const sx = e.clientX;
                const _dragPipTL = [...S.selPipIdxs].map(pi2 => {
                    const p2 = S.pipLayers[pi2] || {};
                    const st = p2.startTime || 0;
                    return { pi: pi2, start0: st, dur: (p2.endTime ?? (st + 5)) - st };
                });
                // Capture initial positions of other selected types for cross-type group drag
                const _dragInitAudio = [...S.selAudioIdxs].map(idx => ({ idx, startOffset: S.audioTracks[idx]?.startOffset || 0 }));
                const _dragInitSub = [...S.selSubIdxs].map(idx => {
                    const s = S.subtitles[idx] || {};
                    return { idx, start: s.start || 0, dur: (s.end || 3) - (s.start || 0) };
                });
                let moved = false;
                const onMove = ev => {
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    if (!moved && Math.abs(dx * S.pxPerSec) < 3) return;
                    moved = true;
                    _dragPipTL.forEach(({ pi: pi2, start0, dur: d }) => {
                        const p2 = S.pipLayers[pi2]; if (!p2) return;
                        p2.startTime = Math.max(0, start0 + dx);
                        p2.endTime   = p2.startTime + d;
                    });
                    _dragInitAudio.forEach(({ idx, startOffset }) => {
                        if (S.audioTracks[idx]) S.audioTracks[idx].startOffset = Math.max(0, Math.round((startOffset + dx) * 10) / 10);
                    });
                    _dragInitSub.forEach(({ idx, start, dur }) => {
                        const s = S.subtitles[idx]; if (!s) return;
                        const newStart = Math.max(0, Math.round((start + dx) * 10) / 10);
                        s.start = newStart; s.end = Math.round((newStart + dur) * 10) / 10;
                    });
                    S.dirty = true; _renderPipTrack(total);
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            // Resize end time
            rh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX;
                const end0 = pip.endTime ?? ((pip.startTime || 0) + 5);
                let moved = false;
                const onMove = ev => {
                    moved = true;
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    pip.endTime = Math.max((pip.startTime || 0) + 0.1, end0 + dx);
                    S.dirty = true; _renderPipTrack(total);
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (moved) _pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            pipTrackEl.appendChild(item);
        });
    }

    function _renderPropsPip(pip, idx) {
        const isVideo = pip.type === 'video';
        propsBody.innerHTML = `<div class="ive-form">
            <div style="font-size:10px;color:var(--text-dim);padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${eh(pip.original || pip.file)}">PIP: ${eh(pip.original || pip.file)}</div>
            <div class="ive-row2">
                <label class="ive-label">Нач.(с)<input class="ive-input" type="number" id="pip-start" min="0" step="0.1" value="${(pip.startTime || 0).toFixed(1)}"></label>
                <label class="ive-label">Кон.(с)<input class="ive-input" type="number" id="pip-end"   min="0" step="0.1" value="${(pip.endTime ?? ((pip.startTime||0)+5)).toFixed(1)}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">X%<input class="ive-input" type="number" id="pip-x" min="0" max="100" step="0.1" value="${(pip.x||0).toFixed(1)}"></label>
                <label class="ive-label">Y%<input class="ive-input" type="number" id="pip-y" min="0" max="100" step="0.1" value="${(pip.y||0).toFixed(1)}"></label>
            </div>
            <div class="ive-row2">
                <label class="ive-label">Ширина%<input class="ive-input" type="number" id="pip-w" min="5" max="100" step="0.1" value="${(pip.w||30).toFixed(1)}"></label>
                <label class="ive-label">Высота%<input class="ive-input" type="number" id="pip-h" min="5" max="100" step="0.1" value="${(pip.h||20).toFixed(1)}"></label>
            </div>
            <label class="ive-label">Прозрачность
                <div class="ive-range-row">
                    <input class="ive-range" type="range" id="pip-opacity" min="0" max="1" step="0.01" value="${pip.opacity??1}">
                    <span class="ive-range-val" id="pip-opacity-val">${Math.round((pip.opacity??1)*100)}%</span>
                </div>
            </label>
            ${isVideo ? `
            <label class="ive-label">Громкость
                <div class="ive-range-row">
                    <input class="ive-range" type="range" id="pip-volume" min="0" max="1" step="0.01" value="${pip.volume??0}">
                    <span class="ive-range-val" id="pip-volume-val">${Math.round((pip.volume??0)*100)}%</span>
                </div>
            </label>
            <label class="ive-label">Скорость
                <select class="ive-select" id="pip-speed">
                    <option value="0.25"${(pip.speed??1)===0.25?' selected':''}>0.25×</option>
                    <option value="0.5"${(pip.speed??1)===0.5?' selected':''}>0.5×</option>
                    <option value="0.75"${(pip.speed??1)===0.75?' selected':''}>0.75×</option>
                    <option value="1"${(!pip.speed||pip.speed===1)?' selected':''}>1× (норма)</option>
                    <option value="1.5"${(pip.speed??1)===1.5?' selected':''}>1.5×</option>
                    <option value="2"${(pip.speed??1)===2?' selected':''}>2×</option>
                </select>
            </label>
            <label class="ive-label">Вход (с)<input class="ive-input" type="number" id="pip-trimin" min="0" step="0.1" value="${pip.trimIn||0}"></label>
            ` : ''}
            <button class="btn btn-sm danger" id="pip-delete" style="margin-top:8px">Удалить PIP</button>
        </div>`;

        const wire = (id, key, parse, extra) => {
            const el = $(`pip-${id}`); if (!el) return;
            el.addEventListener('change', () => {
                pip[key] = parse(el.value);
                S.dirty = true;
                _positionPipEl(pip, _pipEls.get(pip.id));
                renderPreview(); renderTimeline();
                if (extra) extra();
            });
            if (el.type === 'range') {
                el.addEventListener('input', () => {
                    pip[key] = parse(el.value);
                    S.dirty = true;
                    _positionPipEl(pip, _pipEls.get(pip.id));
                    renderPreview();
                    const valEl = $(`pip-${id}-val`);
                    if (valEl) valEl.textContent = Math.round(parseFloat(el.value)*100) + '%';
                });
            }
        };
        wire('start',   'startTime', v => Math.max(0, parseFloat(v)||0));
        wire('end',     'endTime',   v => Math.max(0, parseFloat(v)||0));
        wire('x',       'x',         v => Math.max(0, Math.min(100, parseFloat(v)||0)));
        wire('y',       'y',         v => Math.max(0, Math.min(100, parseFloat(v)||0)));
        wire('w',       'w',         v => Math.max(5, Math.min(100, parseFloat(v)||30)));
        wire('h',       'h',         v => Math.max(5, Math.min(100, parseFloat(v)||20)));
        wire('opacity', 'opacity',   v => Math.max(0, Math.min(1, parseFloat(v) || 0)));
        if (isVideo) {
            wire('volume',  'volume',   v => Math.max(0, Math.min(1, parseFloat(v) || 0)));
            wire('speed',   'speed',    v => parseFloat(v)||1);
            wire('trimin',  'trimIn',   v => Math.max(0, parseFloat(v)||0));
        }
        $('pip-delete').addEventListener('click', () => {
            const el = _pipEls.get(pip.id);
            if (el?.wrapper?.parentNode) el.wrapper.parentNode.removeChild(el.wrapper);
            _pipEls.delete(pip.id);
            S.pipLayers.splice(idx, 1);
            S.selPipIdx = -1;
            S.dirty = true;
            renderAll();
        });
    }

    function _renderPropsMulti() {
        const count = S.selIdxs.size;
        propsBody.innerHTML = `<div class="ive-form">
            <div style="color:var(--accent);font-size:12px;margin-bottom:8px">Выбрано: ${count} клипа</div>
            <label class="ive-label">Длительность (с)
                <input class="ive-input" type="number" id="multi-dur" min="0.5" max="300" step="0.5" placeholder="— без изменений —">
            </label>
            <label class="ive-label">Переход
                <select class="ive-select" id="multi-trans">
                    <option value="">— без изменений —</option>
                    ${TRANSITIONS.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                </select>
            </label>
            <label class="ive-label">Скорость
                <select class="ive-select" id="multi-speed">
                    <option value="">— без изменений —</option>
                    <option value="0.25">0.25×</option>
                    <option value="0.5">0.5×</option>
                    <option value="0.75">0.75×</option>
                    <option value="1">1× (норма)</option>
                    <option value="1.5">1.5×</option>
                    <option value="2">2×</option>
                    <option value="4">4×</option>
                </select>
            </label>
            <button class="btn btn-sm" id="multi-apply" style="margin-top:8px">Применить</button>
            <button class="btn btn-sm danger" id="multi-delete" style="margin-top:4px">Удалить выбранные</button>
        </div>`;

        $('multi-apply').addEventListener('click', () => {
            const dur   = parseFloat($('multi-dur').value);
            const trans = $('multi-trans').value;
            const spd   = parseFloat($('multi-speed').value);
            [...S.selIdxs].forEach(i => {
                const c = S.clips[i]; if (!c) return;
                if (isFinite(dur) && dur >= 0.5) c.duration = dur;
                if (trans)          { c.transition = c.transition || {}; c.transition.type = trans; }
                if (isFinite(spd))  c.speed = spd;
            });
            S.dirty = true;
            toast('Применено к ' + S.selIdxs.size + ' клипам', 'ok');
            renderAll();
        });
        $('multi-delete').addEventListener('click', () => {
            const sorted = [...S.selIdxs].sort((a, b) => b - a);
            sorted.forEach(i => S.clips.splice(i, 1));
            S.selIdx = S.clips.length ? 0 : -1;
            S.selIdxs = new Set(S.selIdx >= 0 ? [S.selIdx] : []);
            S.dirty = true;
            renderAll();
        });
    }

    function _renderPropsMultiSub() {
        const count = S.selSubIdxs.size;
        propsBody.innerHTML = `<div class="ive-form">
            <div style="color:var(--accent);font-size:12px;margin-bottom:8px">Выбрано субтитров: ${count}</div>
            <button class="btn btn-sm danger" id="multi-sub-delete">Удалить выбранные</button>
        </div>`;
        $('multi-sub-delete')?.addEventListener('click', () => {
            const sorted = [...S.selSubIdxs].sort((a, b) => b - a);
            sorted.forEach(i => { if (S.subtitles[i] !== undefined) S.subtitles.splice(i, 1); });
            S.selSubIdx = -1; S.selSubIdxs = new Set();
            S.dirty = true; renderAll();
        });
    }

    function _renderPropsMultiPip() {
        const count = S.selPipIdxs.size;
        propsBody.innerHTML = `<div class="ive-form">
            <div style="color:var(--accent);font-size:12px;margin-bottom:8px">Выбрано PIP-слоёв: ${count}</div>
            <button class="btn btn-sm danger" id="multi-pip-delete">Удалить выбранные</button>
        </div>`;
        $('multi-pip-delete')?.addEventListener('click', () => {
            const sorted = [...S.selPipIdxs].sort((a, b) => b - a);
            sorted.forEach(i => {
                const pip = S.pipLayers[i]; if (!pip) return;
                const el = _pipEls.get(pip.id);
                if (el?.wrapper) el.wrapper.remove(); _pipEls.delete(pip.id);
                S.pipLayers.splice(i, 1);
            });
            S.selPipIdx = -1; S.selPipIdxs = new Set();
            S.dirty = true; renderAll();
        });
    }

    function _renderPropsMultiAudio() {
        const count = S.selAudioIdxs.size;
        propsBody.innerHTML = `<div class="ive-form">
            <div style="color:var(--accent);font-size:12px;margin-bottom:8px">Выбрано аудиодорожек: ${count}</div>
            <label class="ive-label">Громкость
                <div class="ive-range-row">
                    <input class="ive-range" type="range" id="multi-audio-vol" min="0" max="2" step="0.01" value="1">
                    <span class="ive-range-val" id="multi-audio-vol-val">100%</span>
                </div>
            </label>
            <button class="btn btn-sm" id="multi-audio-apply" style="margin-top:8px">Применить громкость</button>
            <button class="btn btn-sm danger" id="multi-audio-delete" style="margin-top:4px">Удалить выбранные</button>
        </div>`;
        const volEl = $('multi-audio-vol');
        const volVal = $('multi-audio-vol-val');
        volEl?.addEventListener('input', () => { if (volVal) volVal.textContent = Math.round(parseFloat(volEl.value) * 100) + '%'; });
        $('multi-audio-apply')?.addEventListener('click', () => {
            const vol = parseFloat($('multi-audio-vol').value);
            [...S.selAudioIdxs].forEach(i => { if (S.audioTracks[i]) S.audioTracks[i].volume = vol; });
            S.dirty = true;
            toast('Громкость применена к ' + S.selAudioIdxs.size + ' дорожкам', 'ok');
            renderAll();
        });
        $('multi-audio-delete')?.addEventListener('click', () => {
            const sorted = [...S.selAudioIdxs].sort((a, b) => b - a);
            sorted.forEach(i => {
                const track = S.audioTracks[i]; if (!track) return;
                const el = _audioEls.get(track.id);
                if (el) { el.pause(); _audioEls.delete(track.id); }
                S.audioTracks.splice(i, 1);
            });
            S.selAudioIdx = -1; S.selAudioIdxs = new Set();
            S.dirty = true; renderAll();
        });
    }

    // ── PIP Upload ────────────────────────────────────────────────────────────
    addPipBtn?.addEventListener('click', () => pipInput.click());
    pipInput?.addEventListener('change', async () => {
        const f = pipInput.files[0]; if (!f) return;
        pipInput.value = '';
        const isVideo = /\.(mp4|mov|mkv|webm|avi)$/i.test(f.name);
        const fd = new FormData(); fd.append('file', f);
        const endpoint = isVideo ? '/api/imgvid/clips' : '/api/imgvid/images';
        try {
            const r = await fetch(endpoint, { method: 'POST', body: fd });
            const d = await r.json();
            if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
            const pip = {
                id: uid(), file: d.name, fileUrl: d.url, type: isVideo ? 'video' : 'image',
                original: d.original, startTime: S.currentTime, endTime: S.currentTime + 5,
                x: 5, y: 5, w: 30, h: 20, opacity: 1, volume: 0, speed: 1, trimIn: 0, effects: []
            };
            S.pipLayers.push(pip);
            _pushHistory();
            S.selPipIdx = S.pipLayers.length - 1;
            S.dirty = true;
            log('PIP добавлен: ' + d.original, 'done');
            renderAll(); renderProps();
            toast('PIP слой добавлен', 'ok');
        } catch (e) { toast(e.message, 'err'); }
    });

    // ── Projects list ─────────────────────────────────────────────────────────
    async function loadProjectsList() {
        const listEl = $('ive-projects-list');
        try {
            const r     = await fetch('/api/imgvid/projects');
            const data  = await r.json();
            const projs = data.projects || [];
            if (!projs.length) { listEl.innerHTML = '<div class="ive-empty">Нет проектов</div>'; return; }
            listEl.innerHTML = projs.map(p => `
            <div class="ive-proj-row${p.id === S.projectId ? ' active' : ''}" data-pid="${p.id}">
                <div class="ive-proj-name">${eh(p.name)}</div>
                <div class="ive-proj-meta">${p.slide_count} · ${p.total_duration}с</div>
                <div class="ive-proj-btns">
                    <button class="hist-btn accent" data-pact="open">${ICONS.edit}</button>
                    <button class="hist-btn danger"  data-pact="del">${ICONS.trash}</button>
                </div>
            </div>`).join('');
        } catch { listEl.innerHTML = '<div class="ive-empty">Ошибка</div>'; }
    }

    // ── Template Apply ────────────────────────────────────────────────────────

    // Build a dropdown+upload widget for a single slot.
    // existingItems: array of {id, label, url?}
    // Drag-and-drop file upload slot for template apply modal.
    // Returns element with .getSelection() → {type:'new', file:File} | {type:'skip'}
    function _makeDndSlot(accept, icon, hintLabel) {
        let selectedFile = null;

        const wrap = document.createElement('div');
        wrap.className = 'tmpl-dnd-slot';

        const fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = accept;
        fileInput.style.display = 'none';
        wrap.appendChild(fileInput);

        function _clearContent() {
            Array.from(wrap.children).forEach(c => { if (c !== fileInput) c.remove(); });
        }

        function _renderEmpty() {
            selectedFile = null;
            wrap.classList.remove('has-file', 'drag-over');
            _clearContent();
            const zone = document.createElement('div');
            zone.className = 'tmpl-dnd-zone';
            const iconEl = document.createElement('div');
            iconEl.className = 'tmpl-dnd-icon'; iconEl.textContent = icon;
            const hint = document.createElement('div');
            hint.className = 'tmpl-dnd-hint'; hint.textContent = `Перетащите или выберите ${hintLabel}`;
            const pickBtn = document.createElement('button');
            pickBtn.className = 'btn btn-sm'; pickBtn.type = 'button';
            pickBtn.textContent = 'Выбрать';
            pickBtn.onclick = e => { e.stopPropagation(); fileInput.click(); };
            zone.append(iconEl, hint, pickBtn);
            wrap.appendChild(zone);
        }

        function _renderFile(file) {
            selectedFile = file;
            _clearContent();
            wrap.classList.add('has-file'); wrap.classList.remove('drag-over');
            const isImg = file.type.startsWith('image/');
            const isVid = file.type.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|m4v|wmv|flv)$/i.test(file.name);
            const isAud = !isVid && (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name));

            if (isImg || isVid) {
                const thumb = document.createElement(isVid ? 'video' : 'img');
                thumb.className = 'tmpl-dnd-thumb';
                if (isVid) { thumb.muted = true; thumb.preload = 'metadata'; }
                thumb.src = URL.createObjectURL(file);
                wrap.appendChild(thumb);
            }

            const info = document.createElement('div');
            info.className = 'tmpl-dnd-file-info';
            const fname = document.createElement('div');
            fname.className = 'tmpl-dnd-fname'; fname.textContent = file.name;
            info.appendChild(fname);

            if (isAud || isVid) {
                const durEl = document.createElement('div');
                durEl.className = 'tmpl-dnd-dur'; durEl.textContent = '…';
                info.appendChild(durEl);
                const tmp = document.createElement(isVid ? 'video' : 'audio');
                tmp.preload = 'metadata';
                tmp.onloadedmetadata = () => { durEl.textContent = `${tmp.duration.toFixed(1)} с`; };
                tmp.src = URL.createObjectURL(file);
            }

            const replBtn = document.createElement('button');
            replBtn.className = 'btn btn-sm'; replBtn.type = 'button';
            replBtn.textContent = 'Заменить'; replBtn.style.flexShrink = '0';
            replBtn.onclick = e => { e.stopPropagation(); fileInput.value = ''; fileInput.click(); };
            wrap.appendChild(info);
            wrap.appendChild(replBtn);
        }

        wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag-over'); });
        wrap.addEventListener('dragleave', e => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drag-over'); });
        wrap.addEventListener('drop', e => {
            e.preventDefault(); wrap.classList.remove('drag-over');
            const f = e.dataTransfer.files?.[0]; if (f) _renderFile(f);
        });
        fileInput.onchange = () => { const f = fileInput.files?.[0]; if (f) _renderFile(f); };

        _renderEmpty();
        wrap.getSelection = () => selectedFile ? { type: 'new', file: selectedFile } : { type: 'skip' };
        return wrap;
    }

    // One shared drop zone for all slides + per-slot row list below.
    // Returns element with .getSelections() → [{type:'new',file}|{type:'skip'}, ...]
    function _makeSlidesDndArea(slides) {
        const count = slides.length;
        const assigned = new Array(count).fill(null);

        const container = document.createElement('div');

        // ── Top drop zone (accepts multiple files) ──────────────────────────
        const dropZone = document.createElement('div');
        dropZone.className = 'tmpl-dnd-slot';
        const multiInput = document.createElement('input');
        multiInput.type = 'file'; multiInput.multiple = true;
        multiInput.accept = 'image/*,video/*'; multiInput.style.display = 'none';
        dropZone.appendChild(multiInput);
        const zone = document.createElement('div');
        zone.className = 'tmpl-dnd-zone';
        const zIcon = document.createElement('div');
        zIcon.className = 'tmpl-dnd-icon'; zIcon.textContent = '📂';
        const zHint = document.createElement('div');
        zHint.className = 'tmpl-dnd-hint';
        zHint.textContent = `Перетащите сюда до ${count} файл${count===1?'':'ов'} для слайдов`;
        const zBtn = document.createElement('button');
        zBtn.className = 'btn btn-sm'; zBtn.type = 'button'; zBtn.textContent = 'Выбрать файлы';
        zBtn.onclick = e => { e.stopPropagation(); multiInput.click(); };
        zone.append(zIcon, zHint, zBtn);
        dropZone.appendChild(zone);
        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
        dropZone.addEventListener('drop', e => {
            e.preventDefault(); dropZone.classList.remove('drag-over');
            _assignFiles(Array.from(e.dataTransfer.files));
        });
        multiInput.onchange = () => _assignFiles(Array.from(multiInput.files || []));
        container.appendChild(dropZone);

        // ── Per-slide assignment list ────────────────────────────────────────
        const listEl = document.createElement('div');
        listEl.className = 'tmpl-slide-list';
        container.appendChild(listEl);

        function _assignFiles(files) {
            for (let i = 0; i < Math.min(files.length, count); i++) assigned[i] = files[i];
            _renderList();
        }

        function _renderList() {
            listEl.innerHTML = '';
            slides.forEach((slide, i) => {
                const file = assigned[i];
                const row = document.createElement('div');
                row.className = 'tmpl-slide-row';

                const lbl = document.createElement('div');
                lbl.className = 'tmpl-slide-row-lbl';
                lbl.textContent = `${i + 1}. ${slide.type === 'video' ? '🎬' : '🖼'}`;
                row.appendChild(lbl);

                if (file) {
                    const isVid = file.type.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|m4v|wmv|flv)$/i.test(file.name);
                    const isImg = !isVid && file.type.startsWith('image/');
                    if (isImg || isVid) {
                        const thumb = document.createElement(isVid ? 'video' : 'img');
                        thumb.className = 'tmpl-dnd-thumb';
                        if (isVid) { thumb.muted = true; thumb.preload = 'metadata'; }
                        thumb.src = URL.createObjectURL(file);
                        row.appendChild(thumb);
                    }
                    const info = document.createElement('div');
                    info.className = 'tmpl-dnd-file-info';
                    const fn = document.createElement('div');
                    fn.className = 'tmpl-dnd-fname'; fn.textContent = file.name;
                    info.appendChild(fn);
                    if (isVid) {
                        const durEl = document.createElement('div');
                        durEl.className = 'tmpl-dnd-dur'; durEl.textContent = '…';
                        info.appendChild(durEl);
                        const tmp = document.createElement('video');
                        tmp.preload = 'metadata';
                        tmp.onloadedmetadata = () => { durEl.textContent = `${tmp.duration.toFixed(1)} с`; };
                        tmp.src = URL.createObjectURL(file);
                    }
                    row.appendChild(info);
                    const clrBtn = document.createElement('button');
                    clrBtn.className = 'btn btn-sm'; clrBtn.type = 'button'; clrBtn.textContent = '×';
                    clrBtn.title = 'Убрать файл'; clrBtn.style.flexShrink = '0';
                    clrBtn.onclick = () => { assigned[i] = null; _renderList(); };
                    row.appendChild(clrBtn);
                } else {
                    const ph = document.createElement('div');
                    ph.className = 'tmpl-slide-row-empty'; ph.textContent = 'из шаблона';
                    row.appendChild(ph);
                    const fi = document.createElement('input');
                    fi.type = 'file'; fi.style.display = 'none';
                    fi.accept = slide.type === 'video' ? 'video/*' : 'image/*,video/*';
                    fi.onchange = () => { if (fi.files?.[0]) { assigned[i] = fi.files[0]; _renderList(); } };
                    row.appendChild(fi);
                    const pb = document.createElement('button');
                    pb.className = 'btn btn-sm'; pb.type = 'button'; pb.textContent = 'Выбрать';
                    pb.style.flexShrink = '0'; pb.onclick = () => fi.click();
                    row.appendChild(pb);
                }
                listEl.appendChild(row);
            });
        }
        _renderList();

        container.getSelections = () => assigned.map(f => f ? { type: 'new', file: f } : { type: 'skip' });
        return container;
    }

    function _tmplApplyModal(tmpl, { hasSlides, hasAudio, hasPip, hasSubs }) {
        return new Promise((resolve) => {
            const modal = document.getElementById('ive-tmpl-apply-modal');
            if (!modal) { resolve(null); return; }

            document.getElementById('tmpl-modal-name').textContent =
                tmpl.name.replace(/ \(шаблон\)$/, '');

            // ── Slides ──────────────────────────────────────────────────────
            const slotsSection = document.getElementById('tmpl-slots-section');
            slotsSection.innerHTML = '';
            let slidesDndArea = null;
            if (hasSlides) {
                const header = document.createElement('div');
                header.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:8px';
                header.textContent = `Медиаслайды (${(tmpl.slides||[]).length})`;
                slotsSection.appendChild(header);
                slidesDndArea = _makeSlidesDndArea(tmpl.slides || []);
                slotsSection.appendChild(slidesDndArea);
            }

            // ── Subtitles info ───────────────────────────────────────────────
            document.getElementById('tmpl-sub-section').style.display = hasSubs ? '' : 'none';

            // ── Audio ────────────────────────────────────────────────────────
            document.getElementById('tmpl-audio-section').style.display = hasAudio ? '' : 'none';
            const audioSlot = document.getElementById('tmpl-audio-slot');
            audioSlot.innerHTML = '';
            let audioWidget = null;
            if (hasAudio) {
                audioWidget = _makeDndSlot('audio/*', '🎵', 'аудиофайл');
                audioSlot.appendChild(audioWidget);
            }

            // ── PIP ──────────────────────────────────────────────────────────
            document.getElementById('tmpl-pip-section').style.display = hasPip ? '' : 'none';
            const pipSlot = document.getElementById('tmpl-pip-slot');
            pipSlot.innerHTML = '';
            let pipWidget = null;
            if (hasPip) {
                pipWidget = _makeDndSlot('image/*,video/*', '📽', 'PIP файл');
                pipSlot.appendChild(pipWidget);
            }

            const close = (val) => {
                modal.hidden = true;
                document.removeEventListener('keydown', onKey);
                resolve(val);
            };
            const onKey = (e) => { if (e.key === 'Escape') close(null); };
            document.addEventListener('keydown', onKey);

            document.getElementById('tmpl-cancel-btn').onclick = () => close(null);
            document.getElementById('tmpl-apply-btn').onclick  = () => close({
                slideSelections: slidesDndArea ? slidesDndArea.getSelections() : [],
                audioSelection:  audioWidget ? audioWidget.getSelection() : { type: 'skip' },
                pipSelection:    pipWidget   ? pipWidget.getSelection()   : { type: 'skip' },
            });

            modal.hidden = false;
        });
    }

    async function _applyTemplate(tid) {
        let tmpl;
        try {
            const r = await fetch(`/api/imgvid/templates/${tid}`);
            if (!r.ok) { toast('Ошибка загрузки шаблона', 'err'); return; }
            tmpl = await r.json();
        } catch (err) { toast(err.message, 'err'); return; }

        if (S.dirty && !confirm('Несохранённые изменения. Применить шаблон?')) return;

        const hasSlides = (tmpl.slides    || []).length > 0;
        const hasAudio  = (tmpl.audio     || []).length > 0;
        const hasPip    = (tmpl.pip       || []).length > 0;
        const hasSubs   = (tmpl.subtitles || []).length > 0;

        const result = await _tmplApplyModal(tmpl, { hasSlides, hasAudio, hasPip, hasSubs });
        if (!result) return;

        const { slideSelections, audioSelection, pipSelection } = result;
        _stopPlayback();

        const applyBtn = document.getElementById('tmpl-apply-btn');
        if (applyBtn) applyBtn.disabled = true;
        toast('Загрузка файлов…', 'info');

        // Helper: upload a File and get back {name, url, thumb_url?, original, duration?}
        async function _uploadFile(file, isVid) {
            const fd = new FormData(); fd.append('file', file);
            const r = await fetch(isVid ? '/api/imgvid/clips' : '/api/imgvid/images', { method: 'POST', body: fd });
            const d = await r.json();
            if (!r.ok) throw new Error(d.detail || 'Ошибка загрузки');
            return d;
        }

        try {
            // ── Slides ──────────────────────────────────────────────────────────
            const newClips = [];
            const tmplSlides = tmpl.slides || [];
            const anySlideSelected = slideSelections.some(s => s.type !== 'skip');

            if (anySlideSelected) {
                for (let i = 0; i < slideSelections.length; i++) {
                    const sel       = slideSelections[i];
                    const tmplSlide = tmplSlides[i] || {};

                    if (sel.type === 'skip') {
                        // Keep original template slide
                        newClips.push({ ...tmplSlide, id: uid(), subtitles: [] });
                        continue;
                    }

                    let fileData;
                    let isVid;
                    if (sel.type === 'existing') {
                        const existing = S.clips.find(c => c.id === sel.id);
                        if (!existing) { continue; }
                        // Use existing clip data directly (no re-upload)
                        const base = { ...tmplSlide, id: uid(), subtitles: [],
                            type: existing.type, file: existing.file,
                            fileUrl: existing.fileUrl, thumbUrl: existing.thumbUrl,
                            original: existing.original };
                        base.transition  = base.transition  || { type: 'none', duration: 0.5 };
                        base.effects     = base.effects     || [];
                        base.startEffect = base.startEffect || { type: 'none', duration: 1.0 };
                        base.endEffect   = base.endEffect   || { type: 'none', duration: 1.0 };
                        if (existing.type === 'video') {
                            base.duration = tmplSlide.duration || existing.duration || 5;
                            delete base.imgScale; delete base.imgOffsetX; delete base.imgOffsetY; delete base.crop;
                        } else {
                            base.duration = tmplSlide.duration || 3;
                            delete base.trimIn; delete base.muteAudio;
                            if (base.imgScale   === undefined) base.imgScale   = 100;
                            if (base.imgOffsetX === undefined) base.imgOffsetX = 0;
                            if (base.imgOffsetY === undefined) base.imgOffsetY = 0;
                        }
                        newClips.push(base);
                        continue;
                    }

                    // type === 'new'
                    if (!sel.file) continue;
                    isVid = sel.file.type.startsWith('video/') ||
                        /\.(mp4|mov|avi|mkv|webm|m4v|wmv|flv)$/i.test(sel.file.name);
                    try { fileData = await _uploadFile(sel.file, isVid); }
                    catch (e) { toast(e.message, 'err'); continue; }

                    const base = { ...tmplSlide, id: uid(), subtitles: [] };
                    base.type      = isVid ? 'video' : 'image';
                    base.file      = fileData.name;
                    base.fileUrl   = fileData.url;
                    base.thumbUrl  = isVid ? (fileData.thumb_url || '') : fileData.url;
                    base.original  = fileData.original;
                    base.transition  = base.transition  || { type: 'none', duration: 0.5 };
                    base.effects     = base.effects     || [];
                    base.startEffect = base.startEffect || { type: 'none', duration: 1.0 };
                    base.endEffect   = base.endEffect   || { type: 'none', duration: 1.0 };
                    if (isVid) {
                        base.duration = tmplSlide.duration || fileData.duration || 5;
                        delete base.imgScale; delete base.imgOffsetX; delete base.imgOffsetY; delete base.crop;
                    } else {
                        base.duration = tmplSlide.duration || 3;
                        delete base.trimIn; delete base.muteAudio;
                        if (base.imgScale   === undefined) base.imgScale   = 100;
                        if (base.imgOffsetX === undefined) base.imgOffsetX = 0;
                        if (base.imgOffsetY === undefined) base.imgOffsetY = 0;
                    }
                    newClips.push(base);
                }
            } else {
                // All skipped or no slides in template — use template slides as-is
                tmplSlides.forEach(s => newClips.push({ ...s, id: uid(), subtitles: [] }));
            }

            // ── Audio ────────────────────────────────────────────────────────────
            let newAudio = [];
            if (hasAudio) {
                const aSel = audioSelection || { type: 'skip' };
                if (aSel.type === 'existing') {
                    // Reuse existing track: apply template processing settings to it
                    const existing = S.audioTracks.find(t => t.id === aSel.id);
                    if (existing) {
                        const tmplA = tmpl.audio[0] || {};
                        // Copy processing settings from template, keep new file data
                        newAudio = [{ ...tmplA, id: uid(),
                            file: existing.file, fileUrl: existing.fileUrl, original: existing.original,
                            originalDuration: existing.originalDuration,
                            duration: existing.duration }];
                    }
                } else if (aSel.type === 'new' && aSel.file) {
                    const fd = new FormData(); fd.append('file', aSel.file);
                    const r = await fetch('/api/imgvid/audio', { method: 'POST', body: fd });
                    const d = await r.json();
                    if (r.ok) {
                        const tmplA = tmpl.audio[0] || {};
                        // Spread template processing settings but reset file-specific duration
                        const track = { ...tmplA, id: uid(),
                            file: d.name, fileUrl: d.url, original: d.original,
                            duration: undefined, originalDuration: undefined };
                        newAudio = [track];
                        // Probe actual duration of new file asynchronously
                        _probeAudioDuration(d.url).then(dur => {
                            if (dur > 0) {
                                track.originalDuration = dur;
                                track.duration = dur;
                                if ((track.trimIn || 0) >= dur) track.trimIn = 0;
                                renderTimeline();
                            }
                        });
                    }
                } else {
                    // 'skip' — preserve template audio tracks
                    newAudio = (tmpl.audio || []).map(a => ({ ...a, id: uid() }));
                }
            }

            // ── PIP ──────────────────────────────────────────────────────────────
            let newPip = [];
            if (hasPip) {
                const pSel = pipSelection || { type: 'skip' };
                if (pSel.type === 'existing') {
                    const existing = S.pipLayers.find(p => p.id === pSel.id);
                    if (existing) {
                        const tmplP = tmpl.pip[0] || {};
                        newPip = [{ ...tmplP, id: uid(), type: existing.type,
                            file: existing.file, fileUrl: existing.fileUrl,
                            thumbUrl: existing.thumbUrl, original: existing.original }];
                    }
                } else if (pSel.type === 'new' && pSel.file) {
                    const isVid = pSel.file.type.startsWith('video/') ||
                        /\.(mp4|mov|avi|mkv|webm|m4v|wmv|flv)$/i.test(pSel.file.name);
                    try {
                        const d = await _uploadFile(pSel.file, isVid);
                        const tmplP = tmpl.pip[0] || {};
                        newPip = [{ ...tmplP, id: uid(), type: isVid ? 'video' : 'image',
                            file: d.name, fileUrl: d.url,
                            thumbUrl: isVid ? (d.thumb_url || '') : d.url, original: d.original }];
                    } catch (e) { toast(e.message, 'err'); }
                } else {
                    // 'skip' — preserve template PIP layers
                    newPip = (tmpl.pip || []).map(p => ({ ...p, id: uid() }));
                }
            }

            // ── Subtitles ────────────────────────────────────────────────────────
            let newSubs = [];
            if (hasSubs) {
                const tmplSub = { ...(tmpl.subtitles[0] || {}) };
                const projDur = _totalDurFn(newClips);
                newSubs = [{
                    ...tmplSub,
                    id: uid(),
                    text:  tmplSub.text  || '',
                    start: tmplSub.start || 0,
                    end:   Math.min(tmplSub.end || 3, projDur || 3),
                }];
            }

            // ── Apply to state ───────────────────────────────────────────────────
            S.projectId   = null;
            S.projectName = tmpl.name.replace(/ \(шаблон\)$/, '');
            S.isTemplateMode = false; S.editingTemplateId = null;
            S.clips       = newClips;
            S.audioTracks = newAudio;
            S.subtitles   = newSubs;
            _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
            _pipEls.clear();
            S.pipLayers   = newPip;
            S.selPipIdx   = -1; S.selIdxs = new Set();
            S.selIdx      = S.clips.length ? 0 : -1;
            S.dirty       = true;
            if ($('ive-project-name')) $('ive-project-name').value = S.projectName;
            _applyExportSettings(tmpl.export_settings);
            _updateSaveBtn();
            renderAll();
            log('Шаблон применён: ' + S.projectName, 'done');
            toast('Шаблон применён: ' + S.projectName, 'ok');

        } catch (err) {
            toast(err.message, 'err');
        } finally {
            if (applyBtn) applyBtn.disabled = false;
        }
    }

    function _fmtDate(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
        } catch { return ''; }
    }

    async function loadTemplatesList() {
        const listEl = $('ive-templates-list');
        if (!listEl) return;
        try {
            const r = await fetch('/api/imgvid/templates');
            const data = await r.json();
            const tmpls = data.templates || [];
            if (!tmpls.length) { listEl.innerHTML = '<div class="ive-empty">Нет шаблонов</div>'; return; }
            listEl.innerHTML = tmpls.map(t => `
            <div class="ive-proj-row${S.isTemplateMode && S.editingTemplateId === t.id ? ' active' : ''}" data-tid="${t.id}">
                <div class="ive-proj-name">${eh(t.name)}</div>
                <div class="ive-proj-meta">${t.slide_count} сл. · ${t.total_duration}с · ${_fmtDate(t.updated_at)}</div>
                <div class="ive-proj-btns">
                    <button class="hist-btn accent" data-tact="use" title="Применить шаблон">${ICONS.edit}</button>
                    <button class="hist-btn" data-tact="edit" title="Редактировать шаблон">${ICONS.open}</button>
                    <button class="hist-btn" data-tact="rename" title="Переименовать">${ICONS.pencil}</button>
                    <button class="hist-btn" data-tact="dup" title="Дублировать">${ICONS.copy}</button>
                    <button class="hist-btn danger" data-tact="del" title="Удалить">${ICONS.trash}</button>
                </div>
            </div>`).join('');
        } catch { if (listEl) listEl.innerHTML = '<div class="ive-empty">Ошибка</div>'; }
    }

    $('ive-projects-list').addEventListener('click', async e => {
        const row = e.target.closest('.ive-proj-row'); if (!row) return;
        const pid = row.dataset.pid;
        const act = e.target.closest('[data-pact]')?.dataset.pact;
        if (act === 'del') {
            const ok = await openConfirm({ title: 'Удалить', message: 'Удалить проект?', confirmLabel: 'Удалить' });
            if (!ok) return;
            await fetch(`/api/imgvid/projects/${pid}`, { method: 'DELETE' });
            log('Проект удалён', 'done');
            if (S.projectId === pid) _resetState();
            renderAll(); await loadProjectsList(); return;
        }
        if (S.dirty && !confirm('Несохранённые изменения. Открыть другой проект?')) return;
        try {
            const r = await fetch(`/api/imgvid/projects/${pid}`);
            const d = await r.json();
            _stopPlayback();
            S.projectId = d.id; S.projectName = d.name;
            S.isTemplateMode = false; S.editingTemplateId = null;
            S.clips = d.slides || []; S.audioTracks = d.audio || [];
            // Load independent subtitles
            S.subtitles = d.subtitles || [];
            // Migrate old per-clip subtitles to independent track if no top-level subs exist
            if (!S.subtitles.length) {
                let cursor = 0;
                S.clips.forEach(clip => {
                    const dur = clip.duration || 3;
                    (clip.subtitles || []).forEach(sub => {
                        S.subtitles.push({
                            ...sub,
                            id: sub.id || uid(),
                            start: Math.round((cursor + (sub.start || 0)) * 100) / 100,
                            end:   Math.round((cursor + (sub.end   || dur)) * 100) / 100,
                        });
                    });
                    // Clear per-clip subs after migration
                    clip.subtitles = [];
                    cursor += dur;
                });
            }
            // Load PIP layers
            _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
            _pipEls.clear();
            S.pipLayers = d.pip || d.pipLayers || [];
            S.selPipIdx = -1; S.selIdxs = new Set();
            S.selIdx = S.clips.length ? 0 : -1; S.dirty = false;
            if ($('ive-project-name')) $('ive-project-name').value = S.projectName;
            _applyExportSettings(d.export_settings);
            _updateSaveBtn();
            renderAll(); await loadProjectsList();
            toast('Проект загружен', 'ok');
        } catch (err) { toast(err.message, 'err'); }
    });

    $('ive-templates-list')?.addEventListener('click', async e => {
        const row = e.target.closest('.ive-proj-row'); if (!row) return;
        const tid = row.dataset.tid;
        const act = e.target.closest('[data-tact]')?.dataset.tact;
        if (act === 'del') {
            const ok = await openConfirm({ title: 'Удалить', message: 'Удалить шаблон?', confirmLabel: 'Удалить' });
            if (!ok) return;
            await fetch(`/api/imgvid/templates/${tid}`, { method: 'DELETE' });
            log('Шаблон удалён', 'done');
            if (S.editingTemplateId === tid) { S.isTemplateMode = false; S.editingTemplateId = null; _updateSaveBtn(); }
            await loadTemplatesList();
            events.dispatchEvent(new CustomEvent('imgvid-template-changed'));
            return;
        }
        if (act === 'use') {
            await _applyTemplate(tid); return;
        }
        if (act === 'edit') {
            await _editTemplate(tid); return;
        }
        if (act === 'rename') {
            const tmplName = row.querySelector('.ive-proj-name')?.textContent || '';
            const newName = await openPrompt({ title: 'Переименовать шаблон', initial: tmplName, confirmLabel: 'Сохранить' });
            if (newName === null || !newName.trim()) return;
            try {
                const r = await fetch(`/api/imgvid/templates/${tid}/rename`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName.trim() }),
                });
                const d = await r.json();
                if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
                toast('Шаблон переименован: ' + d.name, 'ok');
                await loadTemplatesList();
            } catch (err) { toast(err.message, 'err'); }
            return;
        }
        if (act === 'dup') {
            try {
                const r = await fetch(`/api/imgvid/templates/${tid}/duplicate`, { method: 'POST' });
                const d = await r.json();
                if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
                toast('Шаблон продублирован: ' + d.name, 'ok');
                await loadTemplatesList();
            } catch (err) { toast(err.message, 'err'); }
            return;
        }
    });

    // ── Save ──────────────────────────────────────────────────────────────────
    function _updateSaveBtn() {
        if (saveBtn) saveBtn.textContent = S.isTemplateMode ? 'Сохранить шаблон' : 'Сохранить';
    }

    async function _editTemplate(tid) {
        if (S.dirty && !confirm('Несохранённые изменения. Открыть шаблон для редактирования?')) return;
        try {
            const r = await fetch(`/api/imgvid/templates/${tid}`);
            if (!r.ok) { toast('Шаблон не найден', 'err'); return; }
            const d = await r.json();
            _stopPlayback();
            S.projectId = null;
            S.isTemplateMode = true;
            S.editingTemplateId = tid;
            S.projectName = d.name;
            S.clips = d.slides || [];
            S.audioTracks = d.audio || [];
            S.subtitles = d.subtitles || [];
            _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
            _pipEls.clear();
            S.pipLayers = d.pip || d.pipLayers || [];
            S.selPipIdx = -1; S.selIdxs = new Set();
            S.selIdx = S.clips.length ? 0 : -1; S.dirty = false;
            if ($('ive-project-name')) $('ive-project-name').value = S.projectName;
            _applyExportSettings(d.export_settings);
            _updateSaveBtn();
            renderAll();
            await loadTemplatesList();
            toast('Шаблон открыт для редактирования', 'ok');
        } catch (err) { toast(err.message, 'err'); }
    }

    async function _saveProject() {
        if (S.isTemplateMode && S.editingTemplateId) {
            // Save back to template
            const body = { name: S.projectName, slides: S.clips, audio: S.audioTracks, subtitles: S.subtitles, pip: S.pipLayers, export_settings: _getExportSettings() };
            try {
                const r = await fetch(`/api/imgvid/templates/${S.editingTemplateId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const d = await r.json();
                if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
                S.dirty = false;
                toast('Шаблон сохранён', 'ok'); log('Шаблон сохранён: ' + S.projectName, 'done');
                await loadTemplatesList();
                events.dispatchEvent(new CustomEvent('imgvid-template-changed'));
            } catch (err) { toast(err.message, 'err'); }
            return;
        }
        const body = { id: S.projectId, name: S.projectName, slides: S.clips, audio: S.audioTracks, subtitles: S.subtitles, pip: S.pipLayers, export_settings: _getExportSettings() };
        try {
            const r = await fetch(S.projectId ? `/api/imgvid/projects/${S.projectId}` : '/api/imgvid/projects', {
                method: S.projectId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const d = await r.json();
            if (!r.ok) { toast(d.detail || 'Ошибка', 'err'); return; }
            S.projectId = d.id; S.dirty = false;
            toast('Проект сохранён', 'ok'); log('Проект сохранён: ' + S.projectName, 'done');
            await loadProjectsList();
        } catch (err) { toast(err.message, 'err'); }
    }

    // ── Export ────────────────────────────────────────────────────────────────
    // → imgvid/export.js (startExport)
    async function _startExport() {
        if (!S.clips.length) { toast('Нет клипов для экспорта', 'warn'); return; }

        const fmtVal = $('ive-exp-format').value;
        const isAudioOnly = fmtVal.startsWith('audio:');
        const audioFmt    = isAudioOnly ? fmtVal.slice(6) : '';

        exportBtn.disabled = true;
        exportProg.hidden  = false;
        exportStatus.textContent = 'Подготовка…';
        exportStatus.className   = 'status busy';
        progFill.style.width = '2%';
        progPct.textContent  = '0%';

        const projectPayload = JSON.stringify({ slides: S.clips, audio: S.audioTracks, subtitles: S.subtitles, pip: S.pipLayers });

        if (isAudioOnly) {
            if (!S.audioTracks.length) { exportBtn.disabled = false; toast('Нет аудиодорожек для экспорта', 'warn'); return; }
            const fd = new FormData();
            fd.append('project_json', projectPayload);
            fd.append('audio_format', audioFmt);
            try {
                await synthesizeStream('/api/imgvid/export-audio', { method: 'POST', body: fd }, {
                    progress(val, desc) {
                        if (val !== null && isFinite(val)) {
                            const pct = Math.round(val * 100);
                            progFill.style.width = pct + '%'; progPct.textContent = pct + '%';
                        }
                        exportStatus.textContent = typeof desc === 'string' && desc.length < 80 ? (desc || 'Обработка…') : 'Обработка…';
                    },
                    done(payload) {
                        exportBtn.disabled = false;
                        progFill.style.width = '100%'; progPct.textContent = '100%';
                        exportStatus.textContent = '✓ Готово'; exportStatus.className = 'status ok';
                        toast('Аудио экспортировано!', 'ok'); log('Аудио экспортировано: ' + payload.filename, 'done');
                        const url = payload.audio_url || payload.video_url;
                        const a = Object.assign(document.createElement('a'), { href: url, download: payload.filename });
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(() => { exportProg.hidden = true; }, 5000);
                    },
                    error(msg) {
                        exportBtn.disabled = false;
                        exportStatus.textContent = msg; exportStatus.className = 'status err';
                        toast(msg, 'err'); log(msg, 'err');
                    },
                });
            } catch (err) { exportBtn.disabled = false; toast(err.message, 'err'); }
            return;
        }

        const fd = new FormData();
        fd.append('project_json',  projectPayload);
        fd.append('output_format', fmtVal);
        fd.append('codec',         $('ive-exp-codec')?.value || '');
        fd.append('resolution',    _getResolution());
        fd.append('fps',           $('ive-exp-fps').value);
        fd.append('quality',       $('ive-exp-quality').value);
        try {
            await synthesizeStream('/api/imgvid/export', { method: 'POST', body: fd }, {
                progress(val, desc) {
                    if (val !== null && isFinite(val)) {
                        const pct = Math.round(val * 100);
                        progFill.style.width = pct + '%'; progPct.textContent = pct + '%';
                    }
                    exportStatus.textContent = typeof desc === 'string' && desc.length < 80 ? (desc || 'Обработка…') : 'Обработка…';
                },
                done(payload) {
                    exportBtn.disabled   = false;
                    progFill.style.width = '100%'; progPct.textContent = '100%';
                    exportStatus.textContent = '✓ Готово'; exportStatus.className = 'status ok';
                    toast('Экспорт завершён!', 'ok'); log('Видео экспортировано: ' + payload.filename, 'done');
                    const a = Object.assign(document.createElement('a'), { href: payload.video_url, download: payload.filename });
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(() => { exportProg.hidden = true; }, 5000);
                },
                error(msg) {
                    exportBtn.disabled = false;
                    exportStatus.textContent = msg; exportStatus.className = 'status err';
                    toast(msg, 'err'); log(msg, 'err');
                },
            });
        } catch (err) { exportBtn.disabled = false; toast(err.message, 'err'); }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _selectClip(idx, opts = {}) {
        const { ctrl, shift } = opts;
        S.selAudioIdx = -1; S.selPipIdx = -1;
        if (ctrl) {
            // Toggle idx in selIdxs
            if (S.selIdxs.has(idx)) {
                S.selIdxs.delete(idx);
                if (S.selIdx === idx) {
                    const remaining = [...S.selIdxs];
                    S.selIdx = remaining.length ? remaining[remaining.length - 1] : -1;
                }
            } else {
                S.selIdxs.add(idx);
                S.selIdx = idx;
            }
        } else if (shift && S.selIdx >= 0) {
            // Select range between S.selIdx and idx
            const lo = Math.min(S.selIdx, idx);
            const hi = Math.max(S.selIdx, idx);
            for (let i = lo; i <= hi; i++) S.selIdxs.add(i);
            S.selIdx = idx;
        } else {
            // Normal click
            S.selIdx = idx;
            S.selIdxs = new Set([idx]);
            // Seek to clip start
            let cursor = 0;
            for (let i = 0; i < idx; i++) cursor += (S.clips[i].duration || 3);
            _seek(cursor);
        }
        renderMediaList(); _renderVideoTrack(totalDur()); renderProps();
    }

    // ── Undo/Redo ─────────────────────────────────────────────────────────────

    function _pushHistory() {
        _historyStack.length = _historyIdx + 1;
        _historyStack.push({
            clips:       JSON.parse(JSON.stringify(S.clips)),
            audioTracks: JSON.parse(JSON.stringify(S.audioTracks)),
            subtitles:   JSON.parse(JSON.stringify(S.subtitles)),
            pipLayers:   JSON.parse(JSON.stringify(S.pipLayers)),
        });
        if (_historyStack.length > 50) { _historyStack.shift(); _historyIdx = 49; }
        else { _historyIdx = _historyStack.length - 1; }
    }

    function _restoreSnapshot(snap) {
        S.clips       = JSON.parse(JSON.stringify(snap.clips));
        S.audioTracks = JSON.parse(JSON.stringify(snap.audioTracks));
        S.subtitles   = JSON.parse(JSON.stringify(snap.subtitles));
        S.pipLayers   = JSON.parse(JSON.stringify(snap.pipLayers));
        // Remove DOM wrappers for PIPs that no longer exist
        const validIds = new Set(S.pipLayers.map(p => p.id));
        for (const [id, el] of [..._pipEls]) {
            if (!validIds.has(id)) { el.wrapper?.remove(); _pipEls.delete(id); }
        }
        _clearAllSelections();
        S.dirty = true;
        renderAll();
    }

    function _undo() {
        if (_historyIdx <= 0) { toast('Нечего отменять', 'info'); return; }
        _historyIdx--;
        _restoreSnapshot(_historyStack[_historyIdx]);
        toast('Отменено', 'ok');
    }

    function _redo() {
        if (_historyIdx >= _historyStack.length - 1) { toast('Нечего повторять', 'info'); return; }
        _historyIdx++;
        _restoreSnapshot(_historyStack[_historyIdx]);
        toast('Повторено', 'ok');
    }

    function _deleteSelectedClip() {
        let deleted = false;
        // Delete selected clips (all in selIdxs)
        if (S.selIdxs.size > 0) {
            const sorted = [...S.selIdxs].sort((a, b) => b - a);
            sorted.forEach(i => { if (i < S.clips.length) S.clips.splice(i, 1); });
            S.selIdx = S.clips.length ? 0 : -1;
            S.selIdxs = new Set(S.selIdx >= 0 ? [S.selIdx] : []);
            deleted = true;
        }
        // Delete selected subtitles
        if (S.selSubIdxs.size > 0) {
            const sorted = [...S.selSubIdxs].sort((a, b) => b - a);
            sorted.forEach(i => { if (i < S.subtitles.length) S.subtitles.splice(i, 1); });
            S.selSubIdx = -1; S.selSubIdxs = new Set(); deleted = true;
        } else if (!deleted && S.selSubIdx >= 0 && S.selSubIdx < S.subtitles.length) {
            S.subtitles.splice(S.selSubIdx, 1);
            S.selSubIdx = -1; deleted = true;
        }
        // Delete selected PIPs
        if (S.selPipIdxs.size > 0) {
            const sorted = [...S.selPipIdxs].sort((a, b) => b - a);
            sorted.forEach(i => {
                const pip = S.pipLayers[i]; if (!pip) return;
                const el = _pipEls.get(pip.id);
                if (el?.wrapper) el.wrapper.remove(); _pipEls.delete(pip.id);
                S.pipLayers.splice(i, 1);
            });
            S.selPipIdx = -1; S.selPipIdxs = new Set(); deleted = true;
        } else if (!deleted && S.selPipIdx >= 0 && S.selPipIdx < S.pipLayers.length) {
            const pip = S.pipLayers[S.selPipIdx];
            const el = _pipEls.get(pip?.id);
            if (el?.wrapper) el.wrapper.remove(); if (pip) _pipEls.delete(pip.id);
            S.pipLayers.splice(S.selPipIdx, 1);
            S.selPipIdx = -1; deleted = true;
        }
        // Delete selected audio tracks
        if (S.selAudioIdxs.size > 0) {
            const sorted = [...S.selAudioIdxs].sort((a, b) => b - a);
            sorted.forEach(i => {
                const track = S.audioTracks[i]; if (!track) return;
                const el = _audioEls.get(track.id);
                if (el) { el.pause(); _audioEls.delete(track.id); }
                S.audioTracks.splice(i, 1);
            });
            S.selAudioIdx = -1; S.selAudioIdxs = new Set(); deleted = true;
        } else if (!deleted && S.selAudioIdx >= 0 && S.selAudioIdx < S.audioTracks.length) {
            const track = S.audioTracks[S.selAudioIdx];
            const el = _audioEls.get(track?.id);
            if (el) { el.pause(); _audioEls.delete(track.id); }
            S.audioTracks.splice(S.selAudioIdx, 1);
            S.selAudioIdx = -1; deleted = true;
        }
        if (deleted) { _pushHistory(); S.dirty = true; renderAll(); }
    }

    function _clearAllSelections() {
        S.selIdx = -1; S.selIdxs = new Set();
        S.selSubIdx = -1; S.selSubIdxs = new Set();
        S.selPipIdx = -1; S.selPipIdxs = new Set();
        S.selAudioIdx = -1; S.selAudioIdxs = new Set();
        renderTimeline(); renderProps();
    }

    function _selectAll() {
        const total = S.clips.length + S.audioTracks.length + S.subtitles.length + S.pipLayers.length;
        if (!total) return;
        S.selIdxs = new Set(S.clips.map((_, i) => i));
        S.selIdx = S.clips.length ? 0 : -1;
        S.selAudioIdxs = new Set(S.audioTracks.map((_, i) => i));
        S.selAudioIdx = S.audioTracks.length ? 0 : -1;
        S.selSubIdxs = new Set(S.subtitles.map((_, i) => i));
        S.selSubIdx = S.subtitles.length ? 0 : -1;
        S.selPipIdxs = new Set(S.pipLayers.map((_, i) => i));
        S.selPipIdx = S.pipLayers.length ? 0 : -1;
        renderTimeline(); renderProps();
    }

    let _clipboard = null;

    function _copySelected() {
        const data = {};
        let count = 0;
        if (S.selIdxs.size > 0 || S.selIdx >= 0) {
            const idxs = S.selIdxs.size > 0 ? [...S.selIdxs].sort((a,b)=>a-b) : [S.selIdx];
            data.clips = idxs.filter(i => i >= 0 && i < S.clips.length).map(i => JSON.parse(JSON.stringify(S.clips[i])));
            count += data.clips.length;
        }
        if (S.selAudioIdxs.size > 0 || S.selAudioIdx >= 0) {
            const idxs = S.selAudioIdxs.size > 0 ? [...S.selAudioIdxs].sort((a,b)=>a-b) : [S.selAudioIdx];
            data.audio = idxs.filter(i => i >= 0 && i < S.audioTracks.length).map(i => JSON.parse(JSON.stringify(S.audioTracks[i])));
            count += data.audio.length;
        }
        if (S.selSubIdxs.size > 0 || S.selSubIdx >= 0) {
            const idxs = S.selSubIdxs.size > 0 ? [...S.selSubIdxs].sort((a,b)=>a-b) : [S.selSubIdx];
            data.subs = idxs.filter(i => i >= 0 && i < S.subtitles.length).map(i => JSON.parse(JSON.stringify(S.subtitles[i])));
            count += data.subs.length;
        }
        if (S.selPipIdxs.size > 0 || S.selPipIdx >= 0) {
            const idxs = S.selPipIdxs.size > 0 ? [...S.selPipIdxs].sort((a,b)=>a-b) : [S.selPipIdx];
            data.pip = idxs.filter(i => i >= 0 && i < S.pipLayers.length).map(i => JSON.parse(JSON.stringify(S.pipLayers[i])));
            count += data.pip.length;
        }
        if (count === 0) { toast('Ничего не выбрано', 'info'); return; }
        _clipboard = data;
        toast('Скопировано объектов: ' + count, 'ok');
    }

    function _pasteSelected() {
        if (!_clipboard) { toast('Буфер обмена пуст', 'info'); return; }
        let count = 0;
        if (_clipboard.clips?.length) {
            const newClips = _clipboard.clips.map(c => ({ ...c, id: uid() }));
            const insertAt = S.selIdxs.size > 0 ? Math.max(...S.selIdxs) + 1 : (S.selIdx >= 0 ? S.selIdx + 1 : S.clips.length);
            S.clips.splice(insertAt, 0, ...newClips);
            S.selIdxs = new Set(newClips.map((_, j) => insertAt + j));
            S.selIdx = insertAt + newClips.length - 1;
            count += newClips.length;
        }
        if (_clipboard.audio?.length) {
            const newAudio = _clipboard.audio.map(a => {
                const dur = a.duration ?? a.originalDuration ?? 10;
                return { ...a, id: uid(), startOffset: (a.startOffset || 0) + dur };
            });
            newAudio.forEach(a => S.audioTracks.push(a));
            S.selAudioIdxs = new Set(newAudio.map((_, j) => S.audioTracks.length - newAudio.length + j));
            S.selAudioIdx = S.audioTracks.length - 1;
            count += newAudio.length;
        }
        if (_clipboard.subs?.length) {
            const newSubs = _clipboard.subs.map(s => ({ ...s, id: uid(), start: s.start + 0.5, end: s.end + 0.5 }));
            const insertAt = S.selSubIdxs.size > 0 ? Math.max(...S.selSubIdxs) + 1 : (S.selSubIdx >= 0 ? S.selSubIdx + 1 : S.subtitles.length);
            S.subtitles.splice(insertAt, 0, ...newSubs);
            S.selSubIdxs = new Set(newSubs.map((_, j) => insertAt + j));
            S.selSubIdx = insertAt + newSubs.length - 1;
            count += newSubs.length;
        }
        if (_clipboard.pip?.length) {
            const newPip = _clipboard.pip.map(p => ({ ...p, id: uid(), x: Math.min(90, (p.x || 0) + 2), y: Math.min(90, (p.y || 0) + 2) }));
            newPip.forEach(p => S.pipLayers.push(p));
            S.selPipIdxs = new Set(newPip.map((_, j) => S.pipLayers.length - newPip.length + j));
            S.selPipIdx = S.pipLayers.length - 1;
            count += newPip.length;
        }
        if (count > 0) { _pushHistory(); S.dirty = true; renderAll(); toast('Вставлено объектов: ' + count, 'ok'); }
    }

    function _resetState() {
        S.projectId = null; S.projectName = 'Новый проект';
        S.clips = []; S.audioTracks = []; S.subtitles = [];
        S.selIdx = -1; S.selAudioIdx = -1; S.selSubIdx = -1;
        S.selPipIdx = -1; S.selIdxs = new Set();
        S.selSubIdxs = new Set(); S.selPipIdxs = new Set(); S.selAudioIdxs = new Set();
        S.pipLayers = [];
        S.isTemplateMode = false; S.editingTemplateId = null;
        S.dirty = false; S.currentTime = 0;
        _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
        _pipEls.clear();
        _updateSaveBtn();
    }

    // → imgvid/export.js (getExportSettings)
    function _getExportSettings() {
        return {
            format:     $('ive-exp-format')?.value  || 'mp4',
            codec:      $('ive-exp-codec')?.value   || '',
            resolution: _getResolution(),
            fps:        $('ive-exp-fps')?.value      || '30',
            quality:    $('ive-exp-quality')?.value  || 'medium',
        };
    }

    // → imgvid/export.js (applyExportSettings)
    function _applyExportSettings(s) {
        if (!s) return;
        const fmtEl   = $('ive-exp-format');
        const codecEl = $('ive-exp-codec');
        const fpsEl   = $('ive-exp-fps');
        const qualEl  = $('ive-exp-quality');
        if (s.format  && fmtEl)   fmtEl.value   = s.format;
        if (s.codec   && codecEl) codecEl.value = s.codec;
        if (s.fps     && fpsEl)   fpsEl.value   = String(s.fps);
        if (s.quality && qualEl)  qualEl.value  = s.quality;
        if (s.resolution && resEl) {
            const knownVals = [...resEl.options].map(o => o.value).filter(v => v !== 'custom');
            if (knownVals.includes(s.resolution)) {
                resEl.value = s.resolution;
            } else {
                resEl.value = 'custom';
                const [w, h] = s.resolution.split('x').map(Number);
                if (resWEl && w) resWEl.value = w;
                if (resHEl && h) resHEl.value = h;
            }
            _updateCustomResVis();
        }
        _updatePreviewSize();
    }
}
