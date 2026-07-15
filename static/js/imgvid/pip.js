import { S } from './state.js';
import { buildCSSFilter } from './utils.js';

let _dom = {};
let _cb  = {}; // callbacks: renderAll, renderProps, renderTimeline, pushHistory

export function init(dom, callbacks) {
    _dom = dom;
    _cb  = callbacks;
}

export function getPipEl(pip) {
    if (_dom.pipEls.has(pip.id)) return _dom.pipEls.get(pip.id);
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
    _dom.previewContent.appendChild(wrapper);
    const el = { wrapper, img, video };
    _dom.pipEls.set(pip.id, el);
    _setupPipEvents(pip, el);
    return el;
}

export function positionPipEl(pip, el) {
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
        const rect = _dom.previewContent.getBoundingClientRect();
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
        _cb.renderTimeline(); _cb.renderProps();
        positionPipEl(pip, el);
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
                const e2 = _dom.pipEls.get(p2.id);
                if (e2) positionPipEl(p2, e2);
            });
            S.dirty = true;
            _cb.renderTimeline();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (moved) { _cb.pushHistory(); _cb.renderProps(); }
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
        _cb.renderTimeline(); _cb.renderProps(); _cb.renderPreview();
    });

    // Resize handles
    wrapper.querySelectorAll('.ive-pip-rh').forEach(handle => {
        handle.addEventListener('mousedown', e => {
            e.stopPropagation(); e.preventDefault();
            const dir = handle.dataset.rhdir;
            const rect = _dom.previewContent.getBoundingClientRect();
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
                positionPipEl(pip, el);
                _cb.renderTimeline();
                _cb.renderProps();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (moved) _cb.pushHistory();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

export function renderPipInPreview(currentTime) {
    const activeIds = new Set();
    for (const pip of S.pipLayers) {
        const start = pip.startTime || 0;
        const end   = pip.endTime ?? (start + 5);
        if (currentTime < start || currentTime >= end) continue;
        activeIds.add(pip.id);
        const el = getPipEl(pip);
        positionPipEl(pip, el);
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
    _dom.pipEls.forEach((el, id) => {
        if (!activeIds.has(id)) {
            el.wrapper.style.display = 'none';
            if (el.video) el.video.pause();
        }
    });
}
