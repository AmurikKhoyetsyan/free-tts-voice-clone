import { S } from './state.js';
import { TRANSITIONS } from './constants.js';
import { drawWaveform } from './waveform.js';
import { eh, fmtShort } from './utils.js';
import { totalDur as _totalDurFn, clipAtTime as _clipAtTimeFn } from './utils.js';
import { getSnapTargets, snap } from './utils.js';

let _dom = {};
let _cb  = {}; // callbacks: selectClip, renderProps, pushHistory, renderAll, renderPreview

export function init(dom, callbacks) {
    _dom = dom;
    _cb  = callbacks;
}

export function renderTimeline() {
    const total = _totalDurFn(S.clips);
    _dom.totalDurEl.textContent = total.toFixed(1) + 'с';
    const contentW = Math.max(total * S.pxPerSec, (_dom.tracksScroll.clientWidth || 500));
    _dom.tracksInner.style.minWidth = contentW + 'px';
    _renderRuler(contentW, total);
    _renderVideoTrack(total);
    _renderAudioTracks(total, contentW);
    _renderSubsTrack(total);
    _renderPipTrack(total);
    renderPlayhead();
}

function _renderRuler(contentW, total) {
    _dom.timeRulerEl.innerHTML = '';
    _dom.timeRulerEl.style.width = contentW + 'px';
    if (total <= 0) return;
    const step = total < 10 ? 1 : total < 60 ? 5 : total < 300 ? 10 : 30;
    for (let t = 0; t <= total + 0.01; t += step) {
        const x = t * S.pxPerSec;
        const tick = Object.assign(document.createElement('div'), { className: 'ive-ruler-tick' });
        tick.style.left = x + 'px';
        _dom.timeRulerEl.appendChild(tick);
        const lbl = Object.assign(document.createElement('div'), { className: 'ive-ruler-label', textContent: fmtShort(t) });
        lbl.style.left = x + 'px';
        _dom.timeRulerEl.appendChild(lbl);
    }
}

function _renderVideoTrack(total) {
    _dom.videoTrackEl.style.width = Math.max(total * S.pxPerSec, _dom.tracksScroll.clientWidth || 500) + 'px';
    _dom.videoTrackEl.innerHTML = '';
    if (!S.clips.length) {
        _dom.videoTrackEl.innerHTML = '<div class="ive-tl-empty-abs">Добавьте медиафайлы</div>'; return;
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
            _cb.selectClip(i, { ctrl: e.ctrlKey, shift: e.shiftKey });
        });
        // Mouse-based drag to reorder clips
        div.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.target.closest('.ive-tl-clip-resize') || e.target.closest('.ive-tl-clip-resize-left')) return;
            e.preventDefault(); e.stopPropagation();
            _cb.selectClip(i, { ctrl: e.ctrlKey, shift: e.shiftKey });
            const sx = e.clientX;
            let moved = false;
            const onMove = ev => {
                const dx = ev.clientX - sx;
                if (!moved && Math.abs(dx) < 5) return;
                moved = true;
                document.body.style.cursor = 'grabbing';
                _dom.videoTrackEl.querySelector(`[data-cidx="${i}"]`)?.classList.add('dragging');
                // Calculate which position to insert at
                const tlRect = _dom.videoTrackEl.getBoundingClientRect();
                const mouseX = ev.clientX - tlRect.left;
                let dropIdx = 0, cur2 = 0;
                for (let j = 0; j < S.clips.length; j++) {
                    const mid = (cur2 + (S.clips[j].duration || 3) / 2) * S.pxPerSec;
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
                _dom.videoTrackEl.appendChild(ind);
            };
            const onUp = ev => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.querySelectorAll('.ive-tl-drop-indicator').forEach(el => el.remove());
                document.body.style.cursor = '';
                _dom.videoTrackEl.querySelector(`[data-cidx="${i}"]`)?.classList.remove('dragging');
                if (!moved) return;
                const tlRect = _dom.videoTrackEl.getBoundingClientRect();
                const mouseX = ev.clientX - tlRect.left;
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
                    _cb.pushHistory();
                    S.selIdx = finalIdx; S.dirty = true; _cb.renderAll();
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
                S.dirty = true; renderTimeline(); _cb.renderMediaList(); if (i === S.selIdx) _cb.renderProps();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                if (moved) _cb.pushHistory();
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
                    S.dirty = true; renderTimeline(); _cb.renderMediaList(); if (i === S.selIdx) _cb.renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _cb.pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
        _dom.videoTrackEl.appendChild(div);
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
                    _cb.selectClip(i);
                    S.activeTab = 'slide';
                    document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-ptab="slide"]')?.classList.add('active');
                    _cb.renderProps();
                });
                _dom.videoTrackEl.appendChild(block);
            }
        }
        tCursor += dur;
    });
}

function _renderAudioTracks(total, contentW) {
    const rowH = 44;

    // Backward compat: give every track without a laneIndex its own unique lane
    S.audioTracks.forEach((t, i) => { if (t.laneIndex === undefined) t.laneIndex = i; });

    const lanesSet = new Set(S.audioTracks.map(t => t.laneIndex));
    const uniqueLanes = [...lanesSet].sort((a, b) => a - b);
    if (!uniqueLanes.length) uniqueLanes.push(0);

    const totalH = uniqueLanes.length * rowH;
    _dom.audioTrackEl.style.height = totalH + 'px';
    _dom.audioLblEl.style.height   = totalH + 'px';
    _dom.audioLblEl.style.display  = 'flex';
    _dom.audioLblEl.style.flexDirection = 'column';
    _dom.audioLblEl.innerHTML = '';

    _dom.audioTrackEl.innerHTML = '';

    if (!S.audioTracks.length) {
        _dom.audioLblEl.innerHTML = `<div style="height:${rowH}px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em">AUDIO</div>`;
        const empty = document.createElement('div');
        empty.className = 'ive-audio-row-inner';
        empty.innerHTML = '<div class="ive-tl-empty-abs">Нет аудиодорожек</div>';
        _dom.audioTrackEl.appendChild(empty);
        return;
    }

    uniqueLanes.forEach((laneIdx) => {
        // Label for this lane
        const lbl = document.createElement('div');
        lbl.style.cssText = `height:${rowH}px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0`;
        lbl.textContent = uniqueLanes.length === 1 ? 'AUDIO' : `AUDIO ${laneIdx + 1}`;
        _dom.audioLblEl.appendChild(lbl);

        // Row for this lane
        const row = document.createElement('div');
        row.className = 'ive-audio-row-inner';
        row.style.width = contentW + 'px';
        row.dataset.lane = laneIdx;

        // All tracks on this lane
        S.audioTracks.forEach((track, i) => {
            if ((track.laneIndex ?? 0) !== laneIdx) return;

            const offsetPx = (track.startOffset || 0) * S.pxPerSec;
            const trackDur = track.duration !== undefined ? track.duration : Math.max(1, total - (track.startOffset || 0));
            const itemW    = trackDur * S.pxPerSec;
            const item     = document.createElement('div');
            const isMultiAudioSel = S.selAudioIdxs.size > 1 && S.selAudioIdxs.has(i);
            item.className = `ive-tl-audio-item${i === S.selAudioIdx ? ' sel' : ''}${isMultiAudioSel ? ' multi-sel' : ''}`;
            item.dataset.aidx = i;
            item.style.left  = offsetPx + 'px';
            item.style.width = itemW + 'px';
            const canvas = document.createElement('canvas');
            canvas.className = 'ive-waveform-canvas';
            canvas.width  = Math.max(1, Math.floor(itemW)); canvas.height = rowH - 4;
            item.appendChild(canvas);
            const lh = document.createElement('div');
            lh.className = 'ive-tl-audio-resize ive-tl-audio-resize-left';
            item.appendChild(lh);
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
                    S.activeTab = 'slide'; renderTimeline(); _cb.renderProps();
                    return;
                }
                if (!S.selAudioIdxs.has(i)) {
                    S.selAudioIdx = i; S.selAudioIdxs = new Set([i]);
                    S.selIdx = -1; S.selIdxs = new Set(); S.selSubIdx = -1; S.selSubIdxs = new Set(); S.selPipIdx = -1; S.selPipIdxs = new Set();
                } else {
                    S.selAudioIdx = i;
                }
                S.activeTab = 'slide'; renderTimeline(); _cb.renderProps();
                const sx = e.clientX, sy = e.clientY;
                const _dragInitAudio = [...S.selAudioIdxs].map(idx => ({
                    idx,
                    startOffset: S.audioTracks[idx]?.startOffset || 0,
                    laneIndex: S.audioTracks[idx]?.laneIndex ?? 0,
                }));
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
                    if (!moved && Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return;
                    moved = true;
                    const dx = (ev.clientX - sx) / S.pxPerSec;
                    const laneShift = Math.round((ev.clientY - sy) / rowH);
                    _dragInitAudio.forEach(({ idx, startOffset, laneIndex: initLane }) => {
                        if (!S.audioTracks[idx]) return;
                        S.audioTracks[idx].startOffset = Math.max(0, Math.round((startOffset + dx) * 10) / 10);
                        if (laneShift !== 0) {
                            const newLane = Math.max(0, initLane + laneShift);
                            S.audioTracks[idx].laneIndex = newLane;
                        }
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
                    S.dirty = true; renderTimeline(); _cb.renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _cb.pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            lh.addEventListener('mousedown', e => {
                e.stopPropagation(); e.preventDefault();
                const sx = e.clientX, sOff = track.startOffset || 0, sTrimIn = track.trimIn || 0;
                const sDur = track.duration !== undefined ? track.duration : Math.max(1, total - sOff);
                const outPt = sOff + sDur;
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
                    S.dirty = true; renderTimeline(); if (i === S.selAudioIdx) _cb.renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _cb.pushHistory();
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
                    S.dirty = true; renderTimeline(); if (i === S.selAudioIdx) _cb.renderProps();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                    if (moved) _cb.pushHistory();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            row.appendChild(item);
            drawWaveform(canvas, track.fileUrl);
        });

        _dom.audioTrackEl.appendChild(row);
    });
}

function _renderSubsTrack(total) {
    _dom.subTrackEl.style.width = Math.max(total * S.pxPerSec, _dom.tracksScroll.clientWidth || 500) + 'px';
    _dom.subTrackEl.innerHTML = '';
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
            renderTimeline(); _cb.renderProps();
        });
        // Drag to move subtitle timing
        el.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.ctrlKey) return; // Ctrl+click handled by click event
            e.stopPropagation(); e.preventDefault();
            const sx = e.clientX;
            const snapTargets = getSnapTargets(S, si, 'sub');
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
                    if (_dragSubIds.length === 1 && _dragInitAudio.length === 0 && _dragInitPip.length === 0) newStart = snap(newStart, snapTargets);
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
                if (moved) _cb.pushHistory();
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
                if (moved) _cb.pushHistory();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        el.appendChild(rh);
        _dom.subTrackEl.appendChild(el);
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
            el.addEventListener('click', e => {
                e.stopPropagation(); _cb.selectClip(ci); S.activeTab = 'subs';
                document.querySelectorAll('.ive-ptab').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-ptab="subs"]')?.classList.add('active');
                _cb.renderProps();
            });
            _dom.subTrackEl.appendChild(el);
        });
        cursor += clipDur;
    });
}

export function renderPlayhead() {
    const total = _totalDurFn(S.clips);
    if (total <= 0 || !S.clips.length) { _dom.playheadEl.style.display = 'none'; return; }
    _dom.playheadEl.style.display = 'block';
    _dom.playheadEl.style.left    = (S.currentTime * S.pxPerSec) + 'px';
    if (S.isPlaying) {
        const x = S.currentTime * S.pxPerSec;
        const vr = _dom.tracksScroll.scrollLeft + _dom.tracksScroll.clientWidth;
        if (x > vr - 60) _dom.tracksScroll.scrollLeft = x - _dom.tracksScroll.clientWidth * 0.3;
    }
}

function _renderPipTrack(total) {
    if (!_dom.pipTrackEl) return;
    const contentW = Math.max(total * S.pxPerSec, (_dom.tracksScroll.clientWidth || 500));
    _dom.pipTrackEl.style.width = contentW + 'px';
    _dom.pipTrackEl.innerHTML = '';
    if (!S.pipLayers.length) {
        _dom.pipTrackEl.innerHTML = '<div class="ive-tl-empty-abs" style="font-size:10px;opacity:.4">Нет PIP</div>';
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
            renderTimeline(); _cb.renderProps(); _cb.renderPreview();
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
            renderTimeline(); _cb.renderProps();
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
                if (moved) _cb.pushHistory();
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
                if (moved) _cb.pushHistory();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        _dom.pipTrackEl.appendChild(item);
    });
}
