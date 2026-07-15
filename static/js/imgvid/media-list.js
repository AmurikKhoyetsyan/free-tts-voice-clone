import { S } from './state.js';
import { ICONS } from '../icons.js';
import { eh } from './utils.js';

let _dom = {};
let _cb  = {}; // callbacks: selectClip, renderAll, pushHistory

export function init(dom, callbacks) {
    _dom = dom;
    _cb  = callbacks;
}

export function renderMediaList() {
    const listEl = _dom.mediaListEl;
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
                _cb.pushHistory();
                S.dirty = true; _cb.renderAll(); return;
            }
            if (row.dataset.mk === 'clip') _cb.selectClip(+row.dataset.mi, { ctrl: e.ctrlKey, shift: e.shiftKey });
        });
    });
}
