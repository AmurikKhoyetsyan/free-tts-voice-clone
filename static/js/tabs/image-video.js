import { log }             from '../logger.js';
import { toast }           from '../toast.js';
import { synthesizeStream } from '../api.js';
import { openConfirm }     from '../modal.js';
import { ICONS }           from '../icons.js';
import { events }          from '../events.js';

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
    selIdx: -1, selAudioIdx: -1, selSubIdx: -1, selPipIdx: -1, selIdxs: new Set(),
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

function _makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor) {
    const parts = [];
    if (outlineSize > 0) {
        const s = outlineSize, c = outlineColor;
        parts.push(
            `${-s}px ${-s}px 0 ${c}`, `${s}px ${-s}px 0 ${c}`,
            `${-s}px ${s}px 0 ${c}`,  `${s}px ${s}px 0 ${c}`,
            `0 ${-s}px 0 ${c}`,       `0 ${s}px 0 ${c}`,
            `${-s}px 0 0 ${c}`,       `${s}px 0 0 ${c}`,
        );
    }
    if (shadowSize > 0) {
        const blur = Math.ceil(shadowSize / 2);
        parts.push(`${shadowSize}px ${shadowSize}px ${blur}px ${shadowColor}`);
    }
    return parts.join(', ');
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
        const onMove = ev => {
            const dx = (ev.clientX - sx) / rect.width * 100;
            sub.w = Math.max(5, Math.min(100, Math.round((w0 + 2 * dx) * 10) / 10));
            S.dirty = true; renderPreview(); if (S.selSubIdx >= 0) renderProps();
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
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
        const onMove = ev => {
            const dy = (ev.clientY - sy) / sc;
            sub.h = Math.max(10, Math.round(h0 + 2 * dy));
            S.dirty = true; renderPreview(); if (S.selSubIdx >= 0) renderProps();
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
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
        const onMove = ev => {
            const dx = (ev.clientX - sx) / rect.width * 100;
            const dy = (ev.clientY - sy) / sc;
            sub.w = Math.max(5, Math.min(100, Math.round((w0 + 2 * dx) * 10) / 10));
            sub.h = Math.max(10, Math.round(h0 + 2 * dy));
            S.dirty = true; renderPreview(); if (S.selSubIdx >= 0) renderProps();
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

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

    document.addEventListener('mousemove', e => {
        if (!_subDragging) return;
        const sub = subOverlay._activeSub;
        if (!sub) return;
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
        if (e.target.closest('.ive-tl-clip') || e.target.closest('.ive-tl-audio-item') || e.target.closest('.ive-tl-sub-item') || e.target.closest('.ive-tl-pip-item')) return;
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
            renderAll(); await loadProjectsList();
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
            renderAll(); await loadProjectsList();
            toast('Проект открыт: ' + d.name, 'ok');
        } catch (e) { toast(e.message, 'err'); }
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
            case 'Delete': case 'Backspace':
                if (S.selIdx >= 0) { e.preventDefault(); _deleteSelectedClip(); }             break;
        }
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
    renderAll();

    // Size the preview content to match the selected export resolution aspect ratio
    function _updateCustomResVis() {
        const isCustom = resEl?.value === 'custom';
        if (resWEl) resWEl.style.display = isCustom ? '' : 'none';
        if (resHEl) resHEl.style.display = isCustom ? '' : 'none';
        if (resXEl) resXEl.style.display = isCustom ? '' : 'none';
    }
    _updateCustomResVis();
    _updatePreviewSize();
    resEl?.addEventListener('change', () => { _updateCustomResVis(); _updatePreviewSize(); renderPreview(); });
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

    function _getResolution() {
        const v = resEl ? resEl.value : '1920x1080';
        if (v === 'custom') {
            const w = parseInt(resWEl?.value) || 1920;
            const h = parseInt(resHEl?.value) || 1080;
            return `${w}x${h}`;
        }
        return v;
    }

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
                <div class="ive-tl-clip-resize" data-ridx="${i}"></div>`;

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
        // Add inter-clip transition blocks centered at clip boundaries
        let tCursor = 0;
        S.clips.forEach((clip, i) => {
            const dur = clip.duration || 3;
            if (i > 0) {
                const prev = S.clips[i - 1];
                const trans = prev.transition;
                if (trans?.type && trans.type !== 'none') {
                    const transDur  = trans.duration || 0.5;
                    const transDurPx = Math.max(20, transDur * S.pxPerSec);
                    const junctionX  = tCursor * S.pxPerSec;
                    const block = document.createElement('div');
                    block.className = 'ive-tl-trans-block';
                    block.style.left  = (junctionX - transDurPx / 2) + 'px';
                    block.style.width = transDurPx + 'px';
                    const lbl = TRANSITIONS.find(t => t.value === trans.type)?.label || trans.type;
                    block.innerHTML = `<span class="ive-tl-trans-label">${eh(lbl)}</span><span class="ive-tl-trans-dur">${transDur}s</span>`;
                    block.addEventListener('click', e => {
                        e.stopPropagation();
                        _selectClip(i - 1);
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
        const { clip, idx, local } = info;
        const clipDur   = clip.duration || 3;
        const nextClip  = S.clips[idx + 1];
        const trans     = clip.transition;
        const transType = (trans?.type && trans.type !== 'none') ? trans.type : 'none';
        const transDur  = Math.max(0.01, parseFloat(trans?.duration || 0.5));
        const inTrans   = transType !== 'none' && nextClip && local >= clipDur - transDur;
        const transProgress = inTrans ? Math.max(0, Math.min(1, (local - (clipDur - transDur)) / transDur)) : 0;

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

    function _renderSubOverlay(sub, subKey) {
        subOverlay.style.display = 'block';

        // Update text content without touching resize handle children
        const textEl = subOverlay._textEl || subOverlay;
        if (sub.karaokeEnable && sub.end > sub.start) {
            const karaokeColor = sub.karaokeColor || '#ffdd00';
            const wordArr  = sub.text.split(/\s+/);
            const elapsed  = S.currentTime - (sub.start || 0);
            const subDur   = (sub.end || 3) - (sub.start || 0);
            const spoken   = Math.min(wordArr.length, Math.floor(wordArr.length * elapsed / subDur + 0.5));
            const tokens   = sub.text.split(/(\s+)/);
            let wi = 0;
            textEl.innerHTML = tokens.map(tok => {
                if (/^\s+$/.test(tok)) return tok;
                const color = wi++ < spoken ? karaokeColor : (sub.color || '#ffffff');
                return `<span style="color:${color}">${eh(tok)}</span>`;
            }).join('');
        } else {
            textEl.textContent = sub.text;
        }

        // Scale all pixel values to match the preview/export resolution ratio
        const _resParts = _getResolution().split('x').map(Number);
        const _resH     = _resParts[1] || 1080;
        const _pvH      = previewContent.clientHeight || _resH;
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

        // Width / height override
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
        const animType = sub.animation || 'none';
        const animDur  = (sub.animDuration || 0.6).toFixed(2) + 's';
        const key = subKey || ((sub.id || '') + ':' + (sub.start ?? 0));
        if (key !== _lastSubStart) {
            _lastSubStart = key;
            subOverlay.style.animation = 'none';
            void subOverlay.offsetWidth;
            subOverlay.style.animation = animType !== 'none' ? `sub-${animType} ${animDur} ease forwards` : '';
        }
        subOverlay.style.cursor = 'grab';
        subOverlay._activeSub   = sub;
        const isSelected = S.selSubIdx >= 0 && S.subtitles[S.selSubIdx] === sub;
        subOverlay.classList.toggle('selected', isSelected);
    }

    // ── Properties panel ──────────────────────────────────────────────────────
    function renderProps() {
        if (S.selPipIdx >= 0 && S.selPipIdx < S.pipLayers.length) {
            _renderPropsPip(S.pipLayers[S.selPipIdx], S.selPipIdx); return;
        }
        if (S.selIdxs.size > 1 && S.activeTab !== 'subs') {
            _renderPropsMulti(); return;
        }
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
                <label class="ive-label" style="flex-direction:row;align-items:center;gap:6px;font-size:12px">
                    <input class="ive-input" type="color" data-sf="karaokeColor" data-si="${si}" value="${sub.karaokeColor || '#ffdd00'}">
                    <span>Цвет подсветки</span>
                </label>
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
                              'karaokeEnable','karaokeColor',
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
                lineHeight: 1.35, karaokeEnable: false, karaokeColor: '#ffdd00',
                aboveEffects: false });
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
        $('pv-apply-all').addEventListener('click', () => {
            S.clips.forEach((c, idx) => {
                if (c === clip) return;
                c.duration   = clip.duration;
                c.transition = JSON.parse(JSON.stringify(clip.transition || {}));
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
            const x0 = pip.x || 0, y0 = pip.y || 0;
            let moved = false;
            S.selPipIdx = S.pipLayers.indexOf(pip);
            S.selIdx = -1; S.selAudioIdx = -1; S.selSubIdx = -1;
            renderTimeline(); renderProps();
            _positionPipEl(pip, el);
            const onMove = ev => {
                const dx = ev.clientX - sx;
                const dy = ev.clientY - sy;
                if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                moved = true;
                pip.x = Math.max(0, Math.min(100, x0 + dx / rect.width * 100));
                pip.y = Math.max(0, Math.min(100, y0 + dy / rect.height * 100));
                S.dirty = true;
                _positionPipEl(pip, el);
                renderTimeline();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (moved) { renderProps(); }
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
                const onMove = ev => {
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
            item.className = `ive-tl-pip-item${pi === S.selPipIdx ? ' sel' : ''}`;
            item.style.left  = left + 'px';
            item.style.width = w + 'px';
            item.textContent = pip.original || pip.file;

            // Right resize handle
            const rh = document.createElement('div');
            rh.className = 'ive-tl-pip-resize';
            item.appendChild(rh);

            item.addEventListener('click', e => {
                if (e.target === rh) return;
                S.selPipIdx = pi; S.selIdx = -1; S.selAudioIdx = -1; S.selSubIdx = -1;
                S.activeTab = 'slide';
                document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-ptab="slide"]')?.classList.add('active');
                renderTimeline(); renderProps(); renderPreview();
            });

            // Drag to move pip
            item.addEventListener('mousedown', e => {
                if (e.button !== 0 || e.target === rh) return;
                e.preventDefault(); e.stopPropagation();
                const sx = e.clientX;
                const s0 = pip.startTime || 0;
                const dur = (pip.endTime ?? (s0 + 5)) - s0;
                const onMove = ev => {
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    pip.startTime = Math.max(0, s0 + dx);
                    pip.endTime   = pip.startTime + dur;
                    S.dirty = true; _renderPipTrack(total);
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            // Resize end time
            rh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX;
                const end0 = pip.endTime ?? ((pip.startTime || 0) + 5);
                const onMove = ev => {
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    pip.endTime = Math.max((pip.startTime || 0) + 0.1, end0 + dx);
                    S.dirty = true; _renderPipTrack(total);
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
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
            // Load PIP layers
            _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
            _pipEls.clear();
            S.pipLayers = d.pip || d.pipLayers || [];
            S.selPipIdx = -1; S.selIdxs = new Set();
            S.selIdx = S.clips.length ? 0 : -1; S.dirty = false;
            if ($('ive-project-name')) $('ive-project-name').value = S.projectName;
            _applyExportSettings(d.export_settings);
            renderAll(); await loadProjectsList();
            toast('Проект загружен', 'ok');
        } catch (err) { toast(err.message, 'err'); }
    });

    // ── Save ──────────────────────────────────────────────────────────────────
    async function _saveProject() {
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
    async function _startExport() {
        if (!S.clips.length) { toast('Нет клипов для экспорта', 'warn'); return; }
        exportBtn.disabled = true;
        exportProg.hidden  = false;
        exportStatus.textContent = 'Подготовка…';
        exportStatus.className   = 'status busy';
        progFill.style.width = '2%';
        progPct.textContent  = '0%';
        const fd = new FormData();
        fd.append('project_json',  JSON.stringify({ slides: S.clips, audio: S.audioTracks, subtitles: S.subtitles, pip: S.pipLayers }));
        fd.append('output_format', $('ive-exp-format').value);
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
        S.selPipIdx = -1; S.selIdxs = new Set();
        S.pipLayers = [];
        S.dirty = false; S.currentTime = 0;
        _pipEls.forEach(({ wrapper }) => { if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper); });
        _pipEls.clear();
    }

    function _getExportSettings() {
        return { format: $('ive-exp-format')?.value || 'mp4', resolution: _getResolution(), fps: $('ive-exp-fps')?.value || '30', quality: $('ive-exp-quality')?.value || 'medium' };
    }

    function _applyExportSettings(s) {
        if (!s) return;
        const fmtEl = $('ive-exp-format');
        const fpsEl = $('ive-exp-fps');
        const qualEl = $('ive-exp-quality');
        if (s.format  && fmtEl)  fmtEl.value  = s.format;
        if (s.fps     && fpsEl)  fpsEl.value  = String(s.fps);
        if (s.quality && qualEl) qualEl.value = s.quality;
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
