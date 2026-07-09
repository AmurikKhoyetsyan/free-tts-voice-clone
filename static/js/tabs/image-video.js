import { log }             from '../logger.js';
import { toast }           from '../toast.js';
import { synthesizeStream } from '../api.js';
import { openConfirm }     from '../modal.js';
import { ICONS }           from '../icons.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const TRANSITIONS = [
    { value: 'none', label: 'Нет' }, { value: 'fade', label: 'Fade' },
    { value: 'crossfade', label: 'Cross Fade' }, { value: 'dissolve', label: 'Dissolve' },
    { value: 'fadeblack', label: 'Fade Black' }, { value: 'fadewhite', label: 'Fade White' },
    { value: 'slideleft', label: 'Slide Left' }, { value: 'slideright', label: 'Slide Right' },
    { value: 'slideup', label: 'Slide Up' }, { value: 'slidedown', label: 'Slide Down' },
    { value: 'wipeleft', label: 'Wipe Left' }, { value: 'wiperight', label: 'Wipe Right' },
    { value: 'wipeup', label: 'Wipe Up' }, { value: 'wipedown', label: 'Wipe Down' },
    { value: 'zoomin', label: 'Zoom In' }, { value: 'pixelize', label: 'Pixelize' },
    { value: 'hblur', label: 'Blur' }, { value: 'circlecrop', label: 'Circle' },
    { value: 'radial', label: 'Radial' }, { value: 'fadegrays', label: 'Fade Grays' },
    { value: 'hlslice', label: 'H Slice' }, { value: 'vuslice', label: 'V Slice' },
];

const EFFECTS_DEF = [
    { key: 'brightness', label: 'Яркость',   min: -100, max: 100, step: 1,   def: 0 },
    { key: 'contrast',   label: 'Контраст',  min: -100, max: 100, step: 1,   def: 0 },
    { key: 'saturation', label: 'Насыщение', min: -100, max: 100, step: 1,   def: 0 },
    { key: 'blur',       label: 'Размытие',  min: 0,    max: 20,  step: 0.5, def: 0 },
    { key: 'sharpen',    label: 'Резкость',  min: 0,    max: 50,  step: 1,   def: 0 },
    { key: 'filmgrain',  label: 'Зернист.',  min: 0,    max: 50,  step: 1,   def: 0 },
    { key: 'grayscale',  label: 'Ч/Б',       toggle: true, def: 0 },
    { key: 'sepia',      label: 'Сепия',     toggle: true, def: 0 },
    { key: 'vignette',   label: 'Виньетка',  toggle: true, def: 0 },
    { key: 'invert',     label: 'Инверсия',  toggle: true, def: 0 },
];

const FONTS = ['Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Impact', 'Trebuchet MS'];
const ANIMS = ['none', 'fade-in', 'fade-out', 'slide-up', 'slide-down', 'typewriter', 'zoom-in'];

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
    projectId: null, projectName: 'Новый проект',
    clips: [], audioTracks: [], subtitles: [],
    selIdx: -1, selAudioIdx: -1, selSubIdx: -1, activeTab: 'slide', dirty: false,
    // Playback
    currentTime: 0, isPlaying: false,
    _playStartReal: 0, _playStartProject: 0, _rafId: null, _syncTick: 0,
    // Timeline
    pxPerSec: 80,
    // Preview zoom
    previewMode: 'fit',   // 'fit' | 'original' | 'custom'
    previewZoom: 1.0,     // actual CSS scale factor
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function uid()     { return Math.random().toString(36).slice(2, 10); }
function eh(s)     { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmt(s)    { const m = Math.floor(s / 60), ss = Math.floor(s % 60), t = Math.floor((s % 1) * 10); return `${m}:${ss.toString().padStart(2,'0')}.${t}`; }
function fmtShort(s) { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${m}:${ss.toString().padStart(2,'0')}`; }
function totalDur(){ return S.clips.reduce((a, c) => a + (c.duration || 3), 0); }

function _getSnapTargets(excludeIdx, type) {
    const targets = [];
    // Clip boundaries
    let cur = 0;
    S.clips.forEach(c => {
        targets.push(cur);
        cur += c.duration || 3;
        targets.push(cur);
    });
    // Audio track boundaries
    S.audioTracks.forEach(a => {
        targets.push(a.startOffset || 0);
        if (a.duration !== undefined) targets.push((a.startOffset || 0) + a.duration);
    });
    // Subtitle boundaries (excluding current)
    S.subtitles.forEach((s, i) => {
        if (type === 'sub' && i === excludeIdx) return;
        targets.push(s.start || 0);
        targets.push(s.end || 3);
    });
    // Playhead
    targets.push(S.currentTime);
    return targets;
}

function _snap(t, targets, threshold = 0.15) {
    let best = t, bestDist = threshold;
    for (const target of targets) {
        const dist = Math.abs(t - target);
        if (dist < bestDist) { best = target; bestDist = dist; }
    }
    return best;
}

function clipAtTime(t) {
    let cur = 0;
    for (let i = 0; i < S.clips.length; i++) {
        const d = S.clips[i].duration || 3;
        if (t < cur + d || i === S.clips.length - 1)
            return { clip: S.clips[i], idx: i, local: Math.max(0, t - cur), start: cur };
        cur += d;
    }
    return null;
}

function buildCSSFilter(effects) {
    if (!effects?.length) return '';
    const m = Object.fromEntries(effects.map(e => [e.type, e.value]));
    const p = [];
    if (m.brightness !== undefined) p.push(`brightness(${1 + m.brightness / 100})`);
    if (m.contrast   !== undefined) p.push(`contrast(${1 + m.contrast / 100})`);
    if (m.saturation !== undefined) p.push(`saturate(${Math.max(0, 1 + m.saturation / 100)})`);
    if (m.blur !== undefined && m.blur > 0) p.push(`blur(${m.blur}px)`);
    if (m.grayscale) p.push('grayscale(1)');
    if (m.sepia)     p.push('sepia(0.8)');
    if (m.invert)    p.push('invert(1)');
    return p.join(' ');
}

function hexToRgba(hex, a) {
    const h = (hex || '#000000').replace('#', '');
    const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${a})`;
}

// ── Waveform cache (high-resolution: 4000 samples, resampled per draw) ────────
const _waveCache = new Map();
const _WAVE_RES  = 4000;

async function drawWaveform(canvas, url) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    let hiPeaks = _waveCache.get(url);
    if (!hiPeaks) {
        try {
            const buf = await (await fetch(url)).arrayBuffer();
            const ac  = new (window.AudioContext || window.webkitAudioContext)();
            const dec = await ac.decodeAudioData(buf);
            ac.close();
            const data  = dec.getChannelData(0);
            const block = Math.max(1, Math.floor(data.length / _WAVE_RES));
            hiPeaks = new Float32Array(_WAVE_RES);
            for (let i = 0; i < _WAVE_RES; i++) {
                let mx = 0;
                for (let j = 0; j < block; j++) mx = Math.max(mx, Math.abs(data[i * block + j] || 0));
                hiPeaks[i] = mx;
            }
            _waveCache.set(url, hiPeaks);
        } catch { return; }
    }

    ctx.fillStyle = 'rgba(74,158,255,0.08)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(74,158,255,0.75)';
    ctx.lineWidth = 1;
    const mid = h / 2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
        const fi  = (x / (w - 1 || 1)) * (_WAVE_RES - 1);
        const lo  = Math.floor(fi), hi2 = Math.min(lo + 1, _WAVE_RES - 1);
        const t   = fi - lo;
        const amp = ((hiPeaks[lo] || 0) * (1 - t) + (hiPeaks[hi2] || 0) * t) * mid * 0.88;
        ctx.moveTo(x + 0.5, mid - amp);
        ctx.lineTo(x + 0.5, mid + amp);
    }
    ctx.stroke();
}

async function _probeAudioDuration(url) {
    try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ac  = new (window.AudioContext || window.webkitAudioContext)();
        const dec = await ac.decodeAudioData(buf);
        ac.close();
        return dec.duration;
    } catch { return 0; }
}

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
    const subOverlay    = $('ive-sub-overlay');
    // Transport
    const goStart       = $('ive-go-start');
    const rewindBtn     = $('ive-rewind-btn');
    const playBtn       = $('ive-play-btn');
    const pauseBtn      = $('ive-pause-btn');
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
    // Timeline
    const totalDurEl    = $('ive-total-dur');
    const videoTrackEl  = $('ive-video-track');
    const audioTrackEl  = $('ive-audio-track');
    const subTrackEl    = $('ive-subtitle-track');
    const tracksScroll  = $('ive-tracks-scroll');
    const tracksInner   = $('ive-tracks-inner');
    const playheadEl    = $('ive-playhead');
    const timeRulerEl   = $('ive-time-ruler');
    const audioLblEl    = $('ive-audio-lbl');
    const propsBody     = $('ive-props-body');

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
    goStart.addEventListener('click',   () => _seek(0));
    rewindBtn.addEventListener('click', () => _seek(S.currentTime - 5));
    playBtn.addEventListener('click',   () => { if (!S.isPlaying) _startPlayback(); });
    pauseBtn.addEventListener('click',  () => { if (S.isPlaying)  _pausePlayback(); });
    stopBtn.addEventListener('click',   () => { _stopPlayback(); _seek(0); });
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
        if (S.previewMode === 'custom') _applyZoom('custom', parseFloat(zoomPct.value) || 100);
    });

    // Ctrl+Scroll on preview = zoom
    previewInner.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const factor  = e.deltaY < 0 ? 1.1 : 0.9;
        const newPct  = Math.round(Math.max(10, Math.min(800, (S.previewZoom * 100) * factor)));
        _applyZoom('custom', newPct);
        zoomMode.value = 'custom';
    }, { passive: false });

    // ── Subtitle overlay drag (move subtitle position with mouse) ─────────────
    let _subDragging = false, _subDx0 = 0, _subDy0 = 0, _subX0 = 0, _subY0 = 0;

    subOverlay.addEventListener('mousedown', e => {
        const sub = subOverlay._activeSub;
        if (!sub) return;
        e.stopPropagation(); e.preventDefault();
        _subDragging = true;
        _subDx0 = e.clientX; _subDy0 = e.clientY;
        _subX0 = sub.x ?? 50; _subY0 = sub.y ?? 88;
        subOverlay.style.cursor = 'grabbing';
    });

    previewContent.addEventListener('mousemove', e => {
        if (!_subDragging) return;
        const sub = subOverlay._activeSub;
        if (!sub) return;
        const rect = previewContent.getBoundingClientRect();
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
        if (_subDragging) { _subDragging = false; subOverlay.style.cursor = 'grab'; }
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
        if (e.target.closest('.ive-tl-clip') || e.target.closest('.ive-tl-audio-item') || e.target.closest('.ive-tl-sub-item')) return;
        const rect = tracksInner.getBoundingClientRect();
        _seek(Math.max(0, (e.clientX - rect.left) / S.pxPerSec));
    });
    tracksScroll.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        S.pxPerSec = Math.max(20, Math.min(500, S.pxPerSec * (e.deltaY < 0 ? 1.15 : 0.87)));
        renderTimeline();
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
            case 'Delete': case 'Backspace':
                if (S.selIdx >= 0) { e.preventDefault(); _deleteSelectedClip(); }             break;
        }
    });

    // ── Boot ──────────────────────────────────────────────────────────────────
    // Populate transport buttons with SVG icons
    goStart.innerHTML   = ICONS.tbGoStart;
    rewindBtn.innerHTML = ICONS.skipBack;
    playBtn.innerHTML   = ICONS.play;
    pauseBtn.innerHTML  = ICONS.pause;
    stopBtn.innerHTML   = ICONS.tbStop;
    fwdBtn.innerHTML    = ICONS.skipFwd;
    goEnd.innerHTML     = ICONS.tbGoEnd;

    await loadProjectsList();
    renderAll();

    // Size the preview content to match the selected export resolution aspect ratio
    _updatePreviewSize();
    resEl?.addEventListener('change', _updatePreviewSize);
    new ResizeObserver(_updatePreviewSize).observe(previewInner);

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
                S.clips.push({ id: uid(), type: 'image', file: d.name, fileUrl: d.url, thumbUrl: d.url, original: d.original, duration: dur, transition: { type: 'fade', duration: 0.5 }, effects: [], subtitles: [] });
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
                S.clips.push({ id: uid(), type: 'video', file: d.name, fileUrl: d.url, thumbUrl: d.thumb_url || '', original: d.original, duration: d.duration || 5, transition: { type: 'fade', duration: 0.5 }, effects: [], subtitles: [] });
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
            S.dirty = true; log('Аудио добавлено: ' + d.original, 'done');
            renderMediaList(); renderTimeline();
            // Probe original duration asynchronously via Web Audio
            _probeAudioDuration(d.url).then(dur => { if (dur > 0) { track.originalDuration = dur; } });
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
        playBtn.classList.add('playing');
        pauseBtn.classList.add('playing');
        _syncAudio(S.currentTime, true);
        S._rafId = requestAnimationFrame(_tick);
    }

    function _pausePlayback() {
        S.isPlaying = false;
        playBtn.classList.remove('playing');
        pauseBtn.classList.remove('playing');
        if (S._rafId) { cancelAnimationFrame(S._rafId); S._rafId = null; }
        _pauseAllAudio();
        previewVideo.pause();
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
    function _applyZoom(mode, pct) {
        S.previewMode = mode;
        if (mode === 'fit') {
            S.previewZoom = 1;
            previewContent.style.transform = '';
            zoomDisplay.textContent = 'Fit';
            zoomPct.style.display = 'none'; zoomSign.style.display = 'none';
            _updatePreviewSize();
        } else if (mode === 'original') {
            S.previewZoom = 1;
            previewContent.style.transform = '';
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

    function _updatePreviewSize() {
        const resVal = resEl ? resEl.value : '1920x1080';
        const parts  = resVal.split('x').map(Number);
        const resW   = parts[0] || 1920;
        const resH   = parts[1] || 1080;

        if (S.previewMode === 'original') {
            previewContent.style.width  = resW + 'px';
            previewContent.style.height = resH + 'px';
        } else {
            const cW    = previewInner.clientWidth  || 640;
            const cH    = previewInner.clientHeight || 360;
            const scale = Math.min(cW / resW, cH / resH);
            previewContent.style.width  = Math.floor(resW * scale) + 'px';
            previewContent.style.height = Math.floor(resH * scale) + 'px';
        }
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
                    S.dirty = true; renderAll(); return;
                }
                if (row.dataset.mk === 'clip') _selectClip(+row.dataset.mi);
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
            div.className = `ive-tl-clip${i === S.selIdx ? ' sel' : ''}`;
            div.dataset.cidx = i;
            div.style.left  = (cursor * S.pxPerSec) + 'px';
            div.style.width = w + 'px';

            const thumbHtml = clip.thumbUrl
                ? `<img class="ive-tl-clip-thumb" src="${clip.thumbUrl}" draggable="false">`
                : `<div class="ive-tl-clip-thumb" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:18px">▶</div>`;

            div.innerHTML = `${thumbHtml}
                <div class="ive-tl-clip-label">${eh(clip.original || clip.file)}</div>
                ${clip.type === 'video' ? '<div class="ive-tl-clip-badge">▶</div><div class="ive-tl-clip-resize-left"></div>' : ''}
                <div class="ive-tl-clip-resize" data-ridx="${i}"></div>`;

            // Transition badge on right edge
            const trans = clip.transition;
            if (trans?.type && trans.type !== 'none') {
                const tdurPx = Math.max(4, Math.min((trans.duration || 0.5) * S.pxPerSec, dur * S.pxPerSec * 0.4));
                const badge = document.createElement('div');
                badge.className = 'ive-tl-trans-badge';
                badge.style.width = tdurPx + 'px';
                badge.title = `${trans.type} (${trans.duration || 0.5}s)`;
                div.appendChild(badge);
            }

            div.addEventListener('click', e => {
                if (e.target.closest('.ive-tl-clip-resize') || e.target.closest('.ive-tl-clip-resize-left')) return;
                _selectClip(i);
            });
            // Mouse-based drag to reorder clips
            div.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                if (e.target.closest('.ive-tl-clip-resize') || e.target.closest('.ive-tl-clip-resize-left')) return;
                e.preventDefault(); e.stopPropagation();
                _selectClip(i);
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
                        S.selIdx = finalIdx; S.dirty = true; renderAll();
                    }
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            div.querySelector('.ive-tl-clip-resize').addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, sd = clip.duration;
                const onMove = ev => {
                    clip.duration = Math.max(0.5, Math.round((sd + (ev.clientX - sx) / S.pxPerSec) * 10) / 10);
                    S.dirty = true; renderTimeline(); renderMediaList(); if (i === S.selIdx) renderProps();
                };
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            // Left trim handle — video only (shifts in-point, preserves out-point)
            if (clip.type === 'video') {
                div.querySelector('.ive-tl-clip-resize-left')?.addEventListener('mousedown', e => {
                    e.stopPropagation(); e.preventDefault();
                    const sx = e.clientX, sTrimIn = clip.trimIn || 0, sDur = clip.duration;
                    const outPt = sTrimIn + sDur;
                    const onMove = ev => {
                        const newIn = Math.max(0, Math.round((sTrimIn + (ev.clientX - sx) / S.pxPerSec) * 10) / 10);
                        clip.trimIn   = newIn;
                        clip.duration = Math.max(0.5, Math.round((outPt - newIn) * 10) / 10);
                        S.dirty = true; renderTimeline(); renderMediaList(); if (i === S.selIdx) renderProps();
                    };
                    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
            }
            videoTrackEl.appendChild(div);
            cursor += dur;
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
            item.className = `ive-tl-audio-item${i === S.selAudioIdx ? ' sel' : ''}`;
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
                S.selAudioIdx = i; S.selIdx = -1; S.activeTab = 'slide'; renderTimeline(); renderProps();
                const sx = e.clientX, sOff = track.startOffset || 0;
                let moved = false;
                const onMove = ev => {
                    if (!moved && Math.abs(ev.clientX - sx) < 4) return;
                    moved = true;
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    track.startOffset = Math.max(0, Math.round((sOff + dx) * 10) / 10);
                    S.dirty = true; renderTimeline(); if (i === S.selAudioIdx) renderProps();
                };
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            lh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, sOff = track.startOffset || 0, sTrimIn = track.trimIn || 0;
                const sDur = track.duration !== undefined ? track.duration : Math.max(1, total - sOff);
                const outPt = sOff + sDur;  // keep out-point fixed
                const onMove = ev => {
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    const maxTrimIn = (track.originalDuration || 9999) - 0.5;
                    const newOff    = Math.max(0, Math.round((sOff + dx) * 10) / 10);
                    const newTrimIn = Math.max(0, Math.min(maxTrimIn, Math.round((sTrimIn + dx) * 10) / 10));
                    track.startOffset = newOff;
                    track.trimIn      = newTrimIn;
                    track.duration    = Math.max(0.5, Math.round((outPt - newOff) * 10) / 10);
                    S.dirty = true; renderTimeline(); if (i === S.selAudioIdx) renderProps();
                };
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            rh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX;
                const sDur = track.duration !== undefined ? track.duration : Math.max(1, total - (track.startOffset || 0));
                const onMove = ev => {
                    const maxDur = (track.originalDuration || 9999) - (track.trimIn || 0);
                    track.duration = Math.max(0.5, Math.min(maxDur, Math.round((sDur + (ev.clientX - sx) / S.pxPerSec) * 10) / 10));
                    S.dirty = true; renderTimeline(); if (i === S.selAudioIdx) renderProps();
                };
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
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
            el.className = `ive-tl-sub-item${si === S.selSubIdx ? ' sel' : ''}`;
            el.style.left  = ((sub.start || 0) * S.pxPerSec) + 'px';
            el.style.width = w + 'px';
            el.title = sub.text || '';
            el.textContent = sub.text ? sub.text.slice(0, 20) : '—';
            el.addEventListener('click', e => {
                e.stopPropagation();
                S.selSubIdx = si;
                S.selIdx = -1; S.selAudioIdx = -1;
                S.activeTab = 'subs';
                document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-ptab="subs"]')?.classList.add('active');
                renderTimeline(); renderProps();
            });
            // Drag to move subtitle timing
            el.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, s0 = sub.start || 0, e0 = sub.end || 3;
                const dur = e0 - s0;
                const snapTargets = _getSnapTargets(si, 'sub');
                const onMove = ev => {
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    let newStart = Math.max(0, s0 + dx);
                    newStart = _snap(newStart, snapTargets);
                    sub.start = Math.round(newStart * 10) / 10;
                    sub.end   = Math.round((newStart + dur) * 10) / 10;
                    S.dirty = true; renderTimeline();
                };
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            // Right resize handle
            const rh = document.createElement('div');
            rh.className = 'ive-tl-clip-resize';
            rh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, e0 = sub.end || 3;
                const onMove = ev => {
                    sub.end = Math.max((sub.start || 0) + 0.1, Math.round((e0 + (ev.clientX - sx) / S.pxPerSec) * 10) / 10);
                    S.dirty = true; renderTimeline();
                };
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
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
            previewImg.style.display   = 'none';
            previewVideo.style.display = 'none';
            previewEmpty.style.display = 'flex';
            subOverlay.style.display   = 'none';
            previewContent.style.filter = '';
            return;
        }
        const { clip, local } = info;
        previewEmpty.style.display   = 'none';
        previewContent.style.filter  = buildCSSFilter(clip.effects || []);

        if (clip.type === 'image') {
            previewVideo.style.display = 'none';
            if (previewImg.dataset.src !== clip.fileUrl) {
                previewImg.src = clip.fileUrl; previewImg.dataset.src = clip.fileUrl;
            }
            previewImg.style.display = 'block';
        } else {
            previewImg.style.display = 'none';
            if (previewVideo.dataset.src !== clip.fileUrl) {
                previewVideo.src = clip.fileUrl; previewVideo.dataset.src = clip.fileUrl;
                previewVideo.load();
            }
            previewVideo.style.display = 'block';
            const videoTime = local + (clip.trimIn || 0);
            const vSpeed    = clip.speed ?? 1;
            if (previewVideo.playbackRate !== vSpeed) previewVideo.playbackRate = vSpeed;
            if (!S.isPlaying) {
                if (Math.abs(previewVideo.currentTime - videoTime) > 0.15) previewVideo.currentTime = videoTime;
                if (!previewVideo.paused) previewVideo.pause();
            } else {
                if (previewVideo.paused) previewVideo.play().catch(() => {});
                // Keep video in sync with project time
                if (Math.abs(previewVideo.currentTime - videoTime) > 0.3) previewVideo.currentTime = videoTime;
            }
        }

        // Find active subtitle: check global S.subtitles first (independent track)
        const t = S.currentTime;
        let activeSub = S.subtitles.find(s => t >= (s.start || 0) && t <= (s.end ?? 3));
        // Fall back to per-clip subtitles
        if (!activeSub && clip) {
            activeSub = (clip.subtitles || []).find(s => local >= (s.start || 0) && local <= (s.end ?? clip.duration));
        }
        if (activeSub?.text) {
            _renderSubOverlay(activeSub, activeSub.id || '');
        } else {
            subOverlay.style.display = 'none';
            _lastSubStart = null;
        }
    }

    function _renderSubOverlay(sub, subKey) {
        subOverlay.style.display    = 'block';
        subOverlay.textContent      = sub.text;
        subOverlay.style.left       = (sub.x ?? 50) + '%';
        subOverlay.style.top        = (sub.y ?? 88) + '%';
        subOverlay.style.transform  = `translate(-50%, -50%) rotate(${sub.rotation || 0}deg)`;
        subOverlay.style.fontSize   = (sub.fontSize || 40) + 'px';
        subOverlay.style.color      = sub.color || '#ffffff';
        subOverlay.style.fontFamily = `"${sub.fontFamily || 'Arial'}", sans-serif`;
        subOverlay.style.fontWeight = sub.bold   ? 'bold'   : 'normal';
        subOverlay.style.fontStyle  = sub.italic ? 'italic' : 'normal';
        subOverlay.style.textDecoration = sub.underline ? 'underline' : 'none';
        subOverlay.style.textAlign  = sub.align || 'center';
        const ol = sub.outline ?? 2, sh = sub.shadow ?? 1;
        const shadows = [];
        if (ol > 0) { for (const [dx, dy] of [[-ol,-ol],[ol,-ol],[-ol,ol],[ol,ol]]) shadows.push(`${dx}px ${dy}px 0 #000`); }
        if (sh > 0) shadows.push(`${sh}px ${sh}px ${sh * 2}px rgba(0,0,0,0.6)`);
        subOverlay.style.textShadow = shadows.join(', ');
        const bgOp = sub.bgOpacity ?? 0;
        if (sub.bgColor && bgOp > 0) {
            subOverlay.style.background   = hexToRgba(sub.bgColor, bgOp);
            subOverlay.style.padding      = '4px 10px';
            subOverlay.style.borderRadius = '4px';
        } else {
            subOverlay.style.background = 'none';
            subOverlay.style.padding    = '0';
        }
        // Animation with custom duration
        const animType = sub.animation || 'none';
        const animDur  = (sub.animDuration || 0.6).toFixed(2) + 's';
        const key = subKey || ((sub.id || '') + ':' + (sub.start ?? 0));
        if (key !== _lastSubStart) {
            _lastSubStart = key;
            subOverlay.style.animation = 'none';
            void subOverlay.offsetWidth;
            subOverlay.style.animation = animType !== 'none' ? `sub-${animType} ${animDur} ease forwards` : '';
        }
        // Enable drag in preview
        subOverlay.style.cursor = 'grab';
        subOverlay._activeSub = sub;
        // Show selection outline when this sub is the selected one
        const isSelected = S.selSubIdx >= 0 && S.subtitles[S.selSubIdx] === sub;
        subOverlay.classList.toggle('selected', isSelected);
    }

    // ── Properties panel ──────────────────────────────────────────────────────
    function renderProps() {
        if (S.selAudioIdx >= 0 && S.selAudioIdx < S.audioTracks.length && S.activeTab === 'slide') {
            _renderPropsAudio(S.audioTracks[S.selAudioIdx], S.selAudioIdx); return;
        }
        if (S.activeTab === 'subs') {
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
    <div class="ive-sub-item${si === S.selSubIdx ? ' ive-sub-sel' : ''}" data-subitem="${si}">
        <div class="ive-sub-hdr">
            <span>#${si + 1}</span>
            <div style="display:flex;gap:2px">
                <button class="ive-style-btn${sub.bold      ? ' active' : ''}" data-sbf="bold"      data-si="${si}"><b>B</b></button>
                <button class="ive-style-btn${sub.italic    ? ' active' : ''}" data-sbf="italic"    data-si="${si}"><i>I</i></button>
                <button class="ive-style-btn${sub.underline ? ' active' : ''}" data-sbf="underline" data-si="${si}"><u>U</u></button>
                <button class="hist-btn danger" data-sdel="${si}">${ICONS.trash}</button>
            </div>
        </div>
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
    </div>`).join('')}</div>`;

        $('pv-add-sub').addEventListener('click', () => {
            const t = S.currentTime;
            S.subtitles.push({ id: uid(), text: '', start: Math.round(t * 10) / 10, end: Math.round((t + 3) * 10) / 10,
                x: 50, y: 88, fontFamily: 'Arial', fontSize: 40, color: '#ffffff',
                outline: 2, shadow: 1, bold: false, italic: false, underline: false,
                align: 'center', bgColor: '#000000', bgOpacity: 0,
                animation: 'none', animDuration: 0.6, rotation: 0 });
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
                if (el.type === 'number') sub[key] = parseFloat(el.value) || 0;
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
                    <option value="0.5"${(track.speed??1)===0.5?' selected':''}>0.5×</option>
                    <option value="0.75"${(track.speed??1)===0.75?' selected':''}>0.75×</option>
                    <option value="1"${(!track.speed||track.speed===1)?' selected':''}>1× (норма)</option>
                    <option value="1.25"${(track.speed??1)===1.25?' selected':''}>1.25×</option>
                    <option value="1.5"${(track.speed??1)===1.5?' selected':''}>1.5×</option>
                    <option value="2"${(track.speed??1)===2?' selected':''}>2×</option>
                </select>
            </label>
            <button class="btn btn-sm danger" id="acp-del" style="margin-top:6px">Удалить дорожку</button>
        </div>`;

        const volEl = $('acp-vol'), volV = $('acp-vol-v');
        volEl.addEventListener('input', () => {
            track.volume = parseFloat(volEl.value);
            volV.textContent = track.volume.toFixed(2);
            S.dirty = true;
            // Live volume update
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
        $('acp-speed').addEventListener('change', e => {
            track.speed = parseFloat(e.target.value) || 1;
            S.dirty = true;
            const el = _audioEls.get(track.id);
            if (el) el.playbackRate = track.speed;
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
            </div>` : ''}
            ${isVideo ? `<button class="btn btn-sm" id="pv-extract-audio" style="margin-top:4px">Извлечь аудио</button>` : ''}
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
        }).join('')}<button class="btn btn-sm" id="pv-reset-ef" style="margin-top:8px">Сбросить всё</button></div>`;

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
        $('pv-reset-ef').addEventListener('click', () => { clip.effects = []; S.dirty = true; renderProps(); renderPreview(); });
    }

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
            S.selIdx = S.clips.length ? 0 : -1; S.dirty = false;
            renderAll(); await loadProjectsList();
            toast('Проект загружен', 'ok');
        } catch (err) { toast(err.message, 'err'); }
    });

    // ── Save ──────────────────────────────────────────────────────────────────
    async function _saveProject() {
        const body = { id: S.projectId, name: S.projectName, slides: S.clips, audio: S.audioTracks, subtitles: S.subtitles, export_settings: _getExportSettings() };
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
    async function _startExport() {
        if (!S.clips.length) { toast('Нет клипов для экспорта', 'warn'); return; }
        exportBtn.disabled = true;
        exportProg.hidden  = false;
        exportStatus.textContent = 'Подготовка…';
        exportStatus.className   = 'status busy';
        progFill.style.width = '2%';
        progPct.textContent  = '0%';
        const fd = new FormData();
        fd.append('project_json',  JSON.stringify({ slides: S.clips, audio: S.audioTracks, subtitles: S.subtitles }));
        fd.append('output_format', $('ive-exp-format').value);
        fd.append('resolution',    $('ive-exp-res').value);
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
    function _selectClip(idx) {
        S.selIdx = idx; S.selAudioIdx = -1;
        let cursor = 0;
        for (let i = 0; i < idx; i++) cursor += (S.clips[i].duration || 3);
        _seek(cursor);
        renderMediaList(); _renderVideoTrack(totalDur()); renderProps();
    }

    function _deleteSelectedClip() {
        if (S.selIdx < 0 || S.selIdx >= S.clips.length) return;
        S.clips.splice(S.selIdx, 1);
        if (S.selIdx >= S.clips.length) S.selIdx = S.clips.length - 1;
        S.dirty = true; renderAll();
    }

    function _resetState() {
        S.projectId = null; S.projectName = 'Новый проект';
        S.clips = []; S.audioTracks = []; S.subtitles = [];
        S.selIdx = -1; S.selAudioIdx = -1; S.selSubIdx = -1;
        S.dirty = false; S.currentTime = 0;
    }

    function _getExportSettings() {
        return { format: $('ive-exp-format')?.value || 'mp4', resolution: $('ive-exp-res')?.value || '1920x1080', fps: $('ive-exp-fps')?.value || '30', quality: $('ive-exp-quality')?.value || 'medium' };
    }
}
