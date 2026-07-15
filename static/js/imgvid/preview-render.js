import { S } from './state.js';
import { TRANSITIONS } from './constants.js';
import { buildCSSFilter, hexToRgba, _makeTextShadow, eh } from './utils.js';
import { clipAtTime as _clipAtTimeFn } from './utils.js';
import { ANIMS } from './constants.js';
import { FONTS } from './constants.js';

let _dom = {};
let _cb  = {}; // callbacks: getResolution

// Subtitle animation state (module-level, not reset between renders)
let _lastSubStart = null;

export function init(dom, callbacks) {
    _dom = dom;
    _cb  = callbacks;
}

export function renderPreview() {
    const info = _clipAtTimeFn(S.clips, S.currentTime);
    if (!info) {
        _dom.previewImg.style.display    = 'none';
        _dom.previewVideo.style.display  = 'none';
        _dom.previewEmpty.style.display  = 'flex';
        _dom.subOverlay.style.display    = 'none';
        if (_dom.subContainer) _dom.subContainer.style.display = 'none';
        _dom.previewContent.style.filter = '';
        _dom.previewImg.style.filter     = '';
        _dom.previewVideo.style.filter   = '';
        resetTransitionPreview();
        _cb.renderPipInPreview(S.currentTime);
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

    _dom.previewEmpty.style.display  = 'none';

    // Determine active subtitle early so we can route the CSS filter correctly
    const _t = S.currentTime;
    const _activeSub = S.subtitles.find(s => _t >= (s.start || 0) && _t <= (s.end ?? 3))
        || (clip ? (clip.subtitles || []).find(s => local >= (s.start || 0) && local <= (s.end ?? clip.duration)) : null);

    // Apply CSS effects filter: if aboveEffects, filter only the media elements (not subContainer)
    const _cssFilter = inTrans ? '' : buildCSSFilter(clip.effects || []);
    if (_activeSub?.aboveEffects) {
        _dom.previewContent.style.filter = '';
        _dom.previewImg.style.filter   = _cssFilter;
        _dom.previewVideo.style.filter = _cssFilter;
        if (_dom.subContainer) _dom.subContainer.style.filter = '';
    } else {
        _dom.previewContent.style.filter = _cssFilter;
        _dom.previewImg.style.filter   = '';
        _dom.previewVideo.style.filter = '';
        if (_dom.subContainer) _dom.subContainer.style.filter = _cssFilter;
    }

    // Show current clip
    if (clip.type === 'image') {
        _dom.previewVideo.style.display = 'none';
        if (_dom.previewImg.dataset.src !== clip.fileUrl) {
            _dom.previewImg.src = clip.fileUrl; _dom.previewImg.dataset.src = clip.fileUrl;
        }
        _dom.previewImg.style.display = 'block';
        _applyImgTransform(_dom.previewImg, clip);
    } else {
        _dom.previewImg.style.display = 'none';
        _dom.previewImg.style.transform = '';
        _dom.previewImg.style.clipPath = '';
        if (_dom.previewVideo.dataset.src !== clip.fileUrl) {
            _dom.previewVideo.src = clip.fileUrl; _dom.previewVideo.dataset.src = clip.fileUrl;
            _dom.previewVideo.load();
        }
        _dom.previewVideo.style.display = 'block';
        const videoTime = local + (clip.trimIn || 0);
        const vSpeed    = clip.speed ?? 1;
        if (_dom.previewVideo.playbackRate !== vSpeed) _dom.previewVideo.playbackRate = vSpeed;
        if (inTrans) {
            // Outgoing clip at its last frame — always frozen during transition
            if (!_dom.previewVideo.paused) _dom.previewVideo.pause();
            if (Math.abs(_dom.previewVideo.currentTime - videoTime) > 0.05) _dom.previewVideo.currentTime = videoTime;
        } else if (!S.isPlaying) {
            if (Math.abs(_dom.previewVideo.currentTime - videoTime) > 0.15) _dom.previewVideo.currentTime = videoTime;
            if (!_dom.previewVideo.paused) _dom.previewVideo.pause();
        } else {
            if (_dom.previewVideo.paused) _dom.previewVideo.play().catch(() => {});
            if (Math.abs(_dom.previewVideo.currentTime - videoTime) > 0.3) _dom.previewVideo.currentTime = videoTime;
        }
    }

    // Transition preview: show next clip and apply CSS effect
    if (inTrans && _dom.previewContentNext) {
        const nextLocal = transProgress * transDur;
        if (nextClip.type === 'image') {
            _dom.previewVideoNext.style.display = 'none';
            if (_dom.previewImgNext.dataset.src !== nextClip.fileUrl) {
                _dom.previewImgNext.src = nextClip.fileUrl; _dom.previewImgNext.dataset.src = nextClip.fileUrl;
            }
            _dom.previewImgNext.style.display = 'block';
        } else {
            _dom.previewImgNext.style.display = 'none';
            if (_dom.previewVideoNext.dataset.src !== nextClip.fileUrl) {
                _dom.previewVideoNext.src = nextClip.fileUrl; _dom.previewVideoNext.dataset.src = nextClip.fileUrl;
                _dom.previewVideoNext.load();
            }
            _dom.previewVideoNext.style.display = 'block';
            const nVT = nextLocal + (nextClip.trimIn || 0);
            const nSpeed = nextClip.speed ?? 1;
            if (_dom.previewVideoNext.playbackRate !== nSpeed) _dom.previewVideoNext.playbackRate = nSpeed;
            if (!S.isPlaying) {
                if (Math.abs(_dom.previewVideoNext.currentTime - nVT) > 0.15) _dom.previewVideoNext.currentTime = nVT;
                if (!_dom.previewVideoNext.paused) _dom.previewVideoNext.pause();
            } else {
                if (_dom.previewVideoNext.paused) _dom.previewVideoNext.play().catch(() => {});
                if (Math.abs(_dom.previewVideoNext.currentTime - nVT) > 0.3) _dom.previewVideoNext.currentTime = nVT;
            }
        }
        _dom.previewContentNext.style.display = 'block';
        applyTransitionCSS(transType, transProgress);
    } else {
        resetTransitionPreview();
        _applyClipStartEndEffects(clip, local);
    }

    // Render PIP layers
    _cb.renderPipInPreview(S.currentTime);

    // Render active subtitle (already resolved above)
    if (_activeSub?.text) {
        if (_dom.subContainer) _dom.subContainer.style.display = 'block';
        _renderSubOverlay(_activeSub, _activeSub.id || '');
    } else {
        _dom.subOverlay.style.display = 'none';
        if (_dom.subContainer) _dom.subContainer.style.display = 'none';
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
    _dom.previewContent.style.opacity   = opacity.toFixed(4);
    _dom.previewContent.style.transform = [zT, effT].filter(Boolean).join(' ') || '';
}

function _renderSubOverlay(sub, subKey) {
    _dom.subOverlay.style.display = 'block';

    const animType   = sub.animation || 'none';
    const animDurSec = sub.animDuration || 0.6;
    const elapsed    = Math.max(0, S.currentTime - (sub.start || 0));
    const subDur     = Math.max(0.001, (sub.end || 3) - (sub.start || 0));

    // ── Text content ──────────────────────────────────────────────────────────
    const textEl = _dom.subOverlay._textEl || _dom.subOverlay;
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
    const { w: resW, h: resH } = _cb.getResolution();
    const _pvH      = S.previewH || resH;
    const sc        = _pvH / resH;

    _dom.subOverlay.style.left        = (sub.x ?? 50) + '%';
    _dom.subOverlay.style.top         = (sub.y ?? 88) + '%';
    _dom.subOverlay.style.transform   = `translate(-50%, -50%) rotate(${sub.rotation || 0}deg)`;
    _dom.subOverlay.style.fontSize    = ((sub.fontSize || 40) * sc) + 'px';
    _dom.subOverlay.style.color       = sub.color || '#ffffff';
    _dom.subOverlay.style.fontFamily  = `"${sub.fontFamily || 'Arial'}", sans-serif`;
    _dom.subOverlay.style.fontWeight  = sub.bold      ? 'bold'      : 'normal';
    _dom.subOverlay.style.fontStyle   = sub.italic    ? 'italic'    : 'normal';
    _dom.subOverlay.style.textDecoration = sub.underline ? 'underline' : 'none';
    _dom.subOverlay.style.textAlign   = sub.align     || 'center';
    _dom.subOverlay.style.lineHeight  = sub.lineHeight || 1.35;
    _dom.subOverlay.style.textShadow  = _makeTextShadow(
        (sub.outline ?? 2) * sc, sub.outlineColor || '#000000',
        (sub.shadow  ?? 1) * sc, sub.shadowColor  || '#000000'
    );

    if (sub.w > 0) {
        _dom.subOverlay.style.width    = sub.w + '%';
        _dom.subOverlay.style.maxWidth = sub.w + '%';
    } else {
        _dom.subOverlay.style.width    = '';
        _dom.subOverlay.style.maxWidth = '90%';
    }
    if (sub.h > 0) {
        _dom.subOverlay.style.minHeight = (sub.h * sc) + 'px';
    } else {
        _dom.subOverlay.style.minHeight = '';
    }

    const bgOp = sub.bgOpacity ?? 0;
    if (bgOp > 0) {
        _dom.subOverlay.style.background   = hexToRgba(sub.bgColor || '#000000', bgOp);
        _dom.subOverlay.style.padding      = `${(sub.bgPadY ?? 6) * sc}px ${(sub.bgPadX ?? 12) * sc}px`;
        _dom.subOverlay.style.borderRadius = ((sub.bgRadius ?? 4) * sc) + 'px';
    } else {
        _dom.subOverlay.style.background   = 'none';
        _dom.subOverlay.style.padding      = '0';
        _dom.subOverlay.style.borderRadius = '0';
    }

    // ── Animation ─────────────────────────────────────────────────────────────
    // Clear properties that time-based or CSS animations might have set previously.
    _dom.subOverlay.style.clipPath = '';

    const key = subKey || ((sub.id || '') + ':' + (sub.start ?? 0));

    if (animType === 'typewriter') {
        // Text content already updated above; no CSS animation needed.
        if (key !== _lastSubStart) {
            _lastSubStart = key;
            _dom.subOverlay.style.animation = 'none';
            void _dom.subOverlay.offsetWidth;
        }
        _dom.subOverlay.style.animation = '';
        _dom.subOverlay.style.opacity   = '';

    } else if (animType === 'fade-out') {
        // Fade out at the END of the subtitle — matches ASS \fad(0,anim_ms).
        // (A CSS `sub-fade-out` animation would play at the *start*, which is wrong.)
        const fadeStart = subDur - animDurSec;
        if (elapsed >= fadeStart && fadeStart >= 0) {
            _dom.subOverlay.style.opacity = String(Math.max(0, 1 - (elapsed - fadeStart) / Math.max(0.001, animDurSec)));
        } else {
            _dom.subOverlay.style.opacity = '1';
        }
        if (key !== _lastSubStart) {
            _lastSubStart = key;
            _dom.subOverlay.style.animation = 'none';
            void _dom.subOverlay.offsetWidth;
        }
        _dom.subOverlay.style.animation = '';

    } else {
        // CSS animations for fade-in, zoom-in, slide-up, slide-down.
        // These all play at the START of the subtitle, matching ASS behaviour.
        _dom.subOverlay.style.opacity = '';
        if (key !== _lastSubStart) {
            _lastSubStart = key;
            _dom.subOverlay.style.animation = 'none';
            void _dom.subOverlay.offsetWidth;
            _dom.subOverlay.style.animation = animType !== 'none'
                ? `sub-${animType} ${animDurSec.toFixed(2)}s ease forwards`
                : '';
        }
    }

    _dom.subOverlay.style.cursor = 'grab';
    _dom.subOverlay._activeSub   = sub;
    const isSelected = S.selSubIdx >= 0 && S.subtitles[S.selSubIdx] === sub;
    _dom.subOverlay.classList.toggle('selected', isSelected);
}

export function applyTransitionCSS(type, p) {
    if (!_dom.previewContentNext) return;
    const zT = S.previewMode === 'custom' ? `scale(${S.previewZoom})` : '';
    _dom.previewContent.style.opacity  = '1';
    _dom.previewContent.style.clipPath = '';
    _dom.previewContentNext.style.opacity  = '1';
    _dom.previewContentNext.style.clipPath = '';
    if (_dom.transOverlayEl) _dom.transOverlayEl.style.display = 'none';
    switch (type) {
        case 'fade': case 'crossfade': case 'dissolve':
            _dom.previewContent.style.opacity = String(1 - p);
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'fadeblack': case 'fadegrays': {
            const col = type === 'fadegrays' ? '#888' : '#000';
            if (_dom.transOverlayEl) { _dom.transOverlayEl.style.display = 'block'; _dom.transOverlayEl.style.background = col; }
            if (p < 0.5) {
                _dom.previewContent.style.opacity = String(1 - p * 2);
                if (_dom.transOverlayEl) _dom.transOverlayEl.style.opacity = String(p * 2);
            } else {
                _dom.previewContent.style.opacity = '0';
                if (_dom.transOverlayEl) _dom.transOverlayEl.style.opacity = String((1 - p) * 2);
            }
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        }
        case 'fadewhite':
            if (_dom.transOverlayEl) { _dom.transOverlayEl.style.display = 'block'; _dom.transOverlayEl.style.background = '#fff'; }
            if (p < 0.5) {
                _dom.previewContent.style.opacity = String(1 - p * 2);
                if (_dom.transOverlayEl) _dom.transOverlayEl.style.opacity = String(p * 2);
            } else {
                _dom.previewContent.style.opacity = '0';
                if (_dom.transOverlayEl) _dom.transOverlayEl.style.opacity = String((1 - p) * 2);
            }
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'slideleft':
            _dom.previewContent.style.transform = `translateX(${-p * 100}%) ${zT}`.trim();
            _dom.previewContentNext.style.transform = `translateX(${(1 - p) * 100}%)`;
            break;
        case 'slideright':
            _dom.previewContent.style.transform = `translateX(${p * 100}%) ${zT}`.trim();
            _dom.previewContentNext.style.transform = `translateX(${-(1 - p) * 100}%)`;
            break;
        case 'slideup':
            _dom.previewContent.style.transform = `translateY(${-p * 100}%) ${zT}`.trim();
            _dom.previewContentNext.style.transform = `translateY(${(1 - p) * 100}%)`;
            break;
        case 'slidedown':
            _dom.previewContent.style.transform = `translateY(${p * 100}%) ${zT}`.trim();
            _dom.previewContentNext.style.transform = `translateY(${-(1 - p) * 100}%)`;
            break;
        case 'wipeleft':
            _dom.previewContent.style.clipPath = `inset(0 ${p * 100}% 0 0)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'wiperight':
            _dom.previewContent.style.clipPath = `inset(0 0 0 ${p * 100}%)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'wipeup':
            _dom.previewContent.style.clipPath = `inset(${p * 100}% 0 0 0)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'wipedown':
            _dom.previewContent.style.clipPath = `inset(0 0 ${p * 100}% 0)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'zoomin':
            _dom.previewContent.style.transform = `scale(${1 + p * 0.3}) ${zT}`.trim();
            _dom.previewContent.style.opacity = String(1 - p);
            _dom.previewContentNext.style.transform = '';
            break;
        case 'hblur': case 'pixelize':
            _dom.previewContent.style.opacity = String(1 - p);
            _dom.previewContent.style.filter  = `blur(${p * 15}px)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.opacity = String(p);
            _dom.previewContentNext.style.filter  = `blur(${(1 - p) * 10}px)`;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'circlecrop': case 'radial':
            _dom.previewContent.style.clipPath = `circle(${(1 - p) * 72}% at 50% 50%)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'hlslice':
            _dom.previewContent.style.clipPath = `inset(0 ${p * 50}% 0 ${p * 50}%)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        case 'vuslice':
            _dom.previewContent.style.clipPath = `inset(${p * 50}% 0 ${p * 50}% 0)`;
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
            break;
        default:
            _dom.previewContent.style.opacity = String(1 - p);
            _dom.previewContent.style.transform = zT;
            _dom.previewContentNext.style.transform = '';
    }
}

export function resetTransitionPreview() {
    if (!_dom.previewContentNext) return;
    const zT = S.previewMode === 'custom' ? `scale(${S.previewZoom})` : '';
    _dom.previewContent.style.opacity  = '1';
    _dom.previewContent.style.clipPath = '';
    if (zT) _dom.previewContent.style.transform = zT;
    else _dom.previewContent.style.transform = '';
    _dom.previewContentNext.style.display   = 'none';
    _dom.previewContentNext.style.opacity   = '1';
    _dom.previewContentNext.style.transform = '';
    _dom.previewContentNext.style.clipPath  = '';
    _dom.previewContentNext.style.filter    = '';
    if (_dom.transOverlayEl) _dom.transOverlayEl.style.display = 'none';
    if (_dom.previewVideoNext && !_dom.previewVideoNext.paused) _dom.previewVideoNext.pause();
}
