// Extracted pure utility functions from image-video.js

export function uid()     { return Math.random().toString(36).slice(2, 10); }
export function eh(s)     { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
export function fmt(s)    { const m = Math.floor(s / 60), ss = Math.floor(s % 60), t = Math.floor((s % 1) * 10); return `${m}:${ss.toString().padStart(2,'0')}.${t}`; }
export function fmtShort(s) { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${m}:${ss.toString().padStart(2,'0')}`; }

// clips is passed explicitly (was S.clips in the original)
export function totalDur(clips) { return clips.reduce((a, c) => a + (c.duration || 3), 0); }

// clips is passed explicitly
export function clipAtTime(clips, t) {
    let cur = 0;
    for (let i = 0; i < clips.length; i++) {
        const d = clips[i].duration || 3;
        if (t < cur + d || i === clips.length - 1)
            return { clip: clips[i], idx: i, local: Math.max(0, t - cur), start: cur };
        cur += d;
    }
    return null;
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
    const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
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

// snap utils — S is passed explicitly
export function getSnapTargets(S, excludeIdx, type) {
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

export function snap(t, targets, threshold = 0.15) {
    let best = t, bestDist = threshold;
    for (const target of targets) {
        const dist = Math.abs(t - target);
        if (dist < bestDist) { best = target; bestDist = dist; }
    }
    return best;
}
