import { S, syncAudio, pauseAllAudio } from './state.js';
import { totalDur as _totalDurFn } from './utils.js';
import { ICONS } from '../icons.js';

let _dom = {};
let _cb  = {}; // callbacks: renderPreview, renderPlayhead, renderProps

export function init(dom, callbacks) {
    _dom = dom;
    _cb  = callbacks;
}

// ── Playback engine ───────────────────────────────────────────────────────────

export function togglePlay() {
    S.isPlaying ? pausePlayback() : startPlayback();
}

export function startPlayback() {
    if (!S.clips.length) return;
    const total = _totalDurFn(S.clips);
    if (S.currentTime >= total - 0.05) seek(0);
    S.isPlaying = true;
    S._playStartReal    = performance.now();
    S._playStartProject = S.currentTime;
    S._syncTick = 0;
    _dom.playPauseBtn.innerHTML = ICONS.pause;
    _dom.playPauseBtn.classList.add('playing');
    syncAudio(S.currentTime, true);
    S._rafId = requestAnimationFrame(_tick);
}

export function pausePlayback() {
    S.isPlaying = false;
    _dom.playPauseBtn.innerHTML = ICONS.play;
    _dom.playPauseBtn.classList.remove('playing');
    if (S._rafId) { cancelAnimationFrame(S._rafId); S._rafId = null; }
    pauseAllAudio();
    _dom.previewVideo.pause();
    // Pause all PIP video elements
    _dom.pipEls.forEach(({ video }) => { if (video) video.pause(); });
}

export function stopPlayback() {
    pausePlayback();
    S.currentTime = 0;
}

function _tick(now) {
    if (!S.isPlaying) return;
    const elapsed = (now - S._playStartReal) / 1000;
    const total   = _totalDurFn(S.clips);
    S.currentTime = Math.min(S._playStartProject + elapsed, total);
    updateTransportUI();
    _cb.renderPreview();
    _cb.renderPlayhead();
    // Sync audio every ~30 frames (~0.5s) to avoid stuttering
    S._syncTick++;
    if (S._syncTick % 30 === 0) syncAudio(S.currentTime);
    if (S.currentTime >= total) { S.currentTime = total; pausePlayback(); return; }
    S._rafId = requestAnimationFrame(_tick);
}

export function seek(t) {
    const total = _totalDurFn(S.clips);
    S.currentTime = Math.max(0, Math.min(total, t));
    if (S.isPlaying) { S._playStartReal = performance.now(); S._playStartProject = S.currentTime; }
    updateTransportUI();
    _cb.renderPreview();
    _cb.renderPlayhead();
    syncAudio(S.currentTime, true);
}

export function updateTransportUI() {
    const total = _totalDurFn(S.clips);
    _dom.seekBar.value = total > 0 ? (S.currentTime / total) * 10000 : 0;
    _dom.curTime.textContent = _cb.fmt(S.currentTime);
    _dom.totTime.textContent = _cb.fmt(total);
}

// ── Preview zoom ──────────────────────────────────────────────────────────────

export function applyZoom(mode, pct) {
    S.previewMode = mode;
    if (mode === 'fit') {
        S.previewZoom = 1;
        _dom.previewContent.style.transform = '';
        _dom.previewContent.style.transformOrigin = '';
        _dom.zoomDisplay.textContent = 'Fit';
        _dom.zoomPct.style.display = 'none'; _dom.zoomSign.style.display = 'none';
        updatePreviewSize();
    } else if (mode === 'original') {
        S.previewZoom = 1;
        _dom.previewContent.style.transform = '';
        _dom.previewContent.style.transformOrigin = '';
        _dom.zoomDisplay.textContent = '100%';
        _dom.zoomPct.style.display = 'none'; _dom.zoomSign.style.display = 'none';
        updatePreviewSize();
    } else {
        const scale = Math.max(0.1, Math.min(8, pct / 100));
        S.previewZoom = scale;
        _dom.previewContent.style.transform = `scale(${scale})`;
        _dom.zoomDisplay.textContent = Math.round(scale * 100) + '%';
        _dom.zoomPct.value = Math.round(scale * 100);
        _dom.zoomPct.style.display = ''; _dom.zoomSign.style.display = '';
        updatePreviewSize();
    }
}

export function updatePreviewSize() {
    const { w: resW, h: resH } = _cb.getResolution();
    let w, h;
    if (S.previewMode === 'original') {
        w = resW; h = resH;
    } else {
        const cW = _dom.previewInner.clientWidth  || 640;
        const cH = _dom.previewInner.clientHeight || 360;
        const sc = Math.min(cW / resW, cH / resH);
        w = Math.floor(resW * sc); h = Math.floor(resH * sc);
    }
    _dom.previewContent.style.width  = w + 'px';
    _dom.previewContent.style.height = h + 'px';
    S.previewH = h; S.previewW = w;
    if (_dom.previewContentNext) {
        const iW   = _dom.previewInner.clientWidth  || 640;
        const iH   = _dom.previewInner.clientHeight || 360;
        const left = Math.floor((iW - w) / 2);
        const top  = Math.floor((iH - h) / 2);
        _dom.previewContentNext.style.width  = w + 'px';
        _dom.previewContentNext.style.height = h + 'px';
        _dom.previewContentNext.style.left   = left + 'px';
        _dom.previewContentNext.style.top    = top  + 'px';
        if (_dom.transOverlayEl) {
            _dom.transOverlayEl.style.width  = w + 'px';
            _dom.transOverlayEl.style.height = h + 'px';
            _dom.transOverlayEl.style.left   = left + 'px';
            _dom.transOverlayEl.style.top    = top  + 'px';
        }
        // Sync subtitle container with same position as previewContentNext
        if (_dom.subContainer) {
            _dom.subContainer.style.width  = w + 'px';
            _dom.subContainer.style.height = h + 'px';
            _dom.subContainer.style.left   = left + 'px';
            _dom.subContainer.style.top    = top  + 'px';
        }
    }
}
