// Extracted pure utility functions from image-video.js

export function uid()     { return Math.random().toString(36).slice(2, 10); }
export function eh(s)     { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
export function fmt(s)    { const m = Math.floor(s / 60), ss = Math.floor(s % 60), t = Math.floor((s % 1) * 10); return `${m}:${ss.toString().padStart(2,'0')}.${t}`; }
export function fmtShort(s) { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${m}:${ss.toString().padStart(2,'0')}`; }

const _XFADE_SET = new Set(['fade','crossfade','dissolve','fadeblack','fadewhite',
    'slideleft','slideright','slideup','slidedown','wipeleft','wiperight',
    'wipeup','wipedown','zoomin','pixelize','hblur','circlecrop',
    'radial','fadegrays','hlslice','vuslice']);

// Additive model: each clip keeps its full duration on the timeline.
// Transitions are stored on the INCOMING clip (clips[i].transition = from clips[i-1] to clips[i]).
// The transition sits at the boundary [sum(dur[0..i-1]), sum(dur[0..i-1]) + transDur],
// overlapping the first transDur seconds of the incoming clip's range.
// During transition: outgoing clip shows its last frame; incoming clip plays from 0.

export function totalDur(clips) {
    return clips.reduce((a, c) => a + (c.duration || 3), 0);
}

// Find clip (or active transition) at effective time t.
//
// When t falls within the transition window at the start of clips[i] (i > 0),
// returns inTransition: true:
//   { inTransition, outClip, outIdx, inClip, inIdx,
//     transProgress, transLocal, transDur, transType, start,
//     clip (=inClip), idx (=inIdx), local (=transLocal) }
//
// Otherwise returns inTransition: false:
//   { clip, idx, local, start, inTransition }
export function clipAtTime(clips, t) {
    if (!clips.length) return null;
    let cur = 0;
    for (let i = 0; i < clips.length; i++) {
        const dur = clips[i].duration || 3;

        // Check for transition INTO clip i (transition stored on incoming clip).
        // Transition window: [cur, cur + transDur] — sits at the start of clip i's range.
        if (i > 0) {
            const trans = clips[i].transition;
            if (trans?.type && trans.type !== 'none' && _XFADE_SET.has(trans.type)) {
                const transDur = parseFloat(trans.duration || 0.5);
                if (t >= cur && t < cur + transDur) {
                    const transLocal = t - cur;
                    return {
                        inTransition: true,
                        outClip: clips[i - 1], outIdx: i - 1,
                        inClip:  clips[i],     inIdx:  i,
                        transProgress: Math.max(0, Math.min(1, transLocal / transDur)),
                        transLocal, transDur,
                        transType: trans.type,
                        start: cur,
                        // Compat: callers that read .clip / .idx / .local still work
                        clip: clips[i], idx: i, local: transLocal
                    };
                }
            }
        }

        if (t < cur + dur || i === clips.length - 1) {
            return { clip: clips[i], idx: i, local: Math.max(0, t - cur), start: cur, inTransition: false };
        }
        cur += dur;
    }
    // Past the end — clamp to last clip
    const last = clips[clips.length - 1];
    return { clip: last, idx: clips.length - 1,
             local: last.duration || 3,
             start: cur - (last.duration || 3),
             inTransition: false };
}

export function buildCSSFilter(effects) {
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

export function hexToRgba(hex, a) {
    const h = (hex || '#000000').replace('#', '');
    const r = parseInt(h.substr(0, 2), 16);
    const g = parseInt(h.substr(2, 2), 16);
    const b = parseInt(h.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${a})`;
}

export function _makeTextShadow(outlineSize, outlineColor, shadowSize, shadowColor) {
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

// Snap targets use raw clip boundaries so snapping feels intuitive
export function getSnapTargets(S, excludeIdx, type) {
    const targets = [];
    let cur = 0;
    S.clips.forEach(c => {
        targets.push(cur);
        cur += c.duration || 3;
        targets.push(cur);
    });
    S.audioTracks.forEach(a => {
        targets.push(a.startOffset || 0);
        if (a.duration !== undefined) targets.push((a.startOffset || 0) + a.duration);
    });
    S.subtitles.forEach((s, i) => {
        if (type === 'sub' && i === excludeIdx) return;
        targets.push(s.start || 0);
        targets.push(s.end || 3);
    });
    targets.push(S.currentTime);
    return targets;
}

export function snap(t, targets, threshold = 0.15) {
    let best = t, bestDist = threshold;
    for (const target of targets) {
        const dist = Math.abs(t - target);
        if (dist < bestDist) { best = target; bestDist = dist; }
    }
    return best;
}
