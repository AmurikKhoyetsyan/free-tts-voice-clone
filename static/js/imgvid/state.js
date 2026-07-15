// ── Shared application state ───────────────────────────────────────────────
export const S = {
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
    // Preview dimensions (set by updatePreviewSize, used for subtitle scaling)
    previewH: 0, previewW: 0,
    // Template edit mode
    isTemplateMode: false, editingTemplateId: null,
};

// ── Undo/Redo history ────────────────────────────────────────────────────────
export const _historyStack = [];
// Wrapper object so _hist.idx is mutable across module imports
export const _hist = { idx: -1 };

// ── Audio element pool ────────────────────────────────────────────────────────
export const _audioEls = new Map(); // trackId → HTMLAudioElement

export function syncAudio(t, force = false) {
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
        const audioFileT = trackT * speed + (track.trimIn || 0);
        if (force || Math.abs(el.currentTime - audioFileT) > 0.3) {
            el.currentTime = Math.max(0, audioFileT);
        }
        if (S.isPlaying && el.paused) el.play().catch(() => {});
        if (!S.isPlaying && !el.paused) el.pause();
    }
}

export function pauseAllAudio() {
    for (const el of _audioEls.values()) el.pause();
}
