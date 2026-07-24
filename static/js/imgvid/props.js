import { S, _audioEls } from './state.js';
import { TRANSITIONS, EFFECTS_DEF, FONTS, ANIMS, START_EFFECTS, END_EFFECTS } from './constants.js';
import { uid, eh, fmt } from './utils.js';
import { ICONS } from '../icons.js';
import { toast } from '../toast.js';
import { openConfirm, openPrompt } from '../modal.js';

let _dom = {};
let _cb  = {}; // callbacks: renderAll, renderTimeline, renderPreview, renderMediaList, renderProps, pushHistory, getNextLane, findFreeAudioOffset, totalDur

export function init(dom, callbacks) {
    _dom = dom;
    _cb  = callbacks;
}

export function renderProps() {
    if (S.selPipIdxs.size > 1) { _renderPropsMultiPip(); return; }
    if (S.selPipIdx >= 0 && S.selPipIdx < S.pipLayers.length) {
        _renderPropsPip(S.pipLayers[S.selPipIdx], S.selPipIdx); return;
    }
    if (S.selIdxs.size > 1 && S.activeTab !== 'subs') {
        _renderPropsMulti(); return;
    }
    if (S.selAudioIdxs.size > 1) { _renderPropsMultiAudio(); return; }
    if (S.selAudioIdx >= 0 && S.selAudioIdx < S.audioTracks.length && S.activeTab === 'slide') {
        _renderPropsAudio(S.audioTracks[S.selAudioIdx], S.selAudioIdx); return;
    }
    if (S.activeTab === 'subs') {
        if (S.selSubIdxs.size > 1) { _renderPropsMultiSub(); return; }
        _renderPropsSubsGlobal(); return;
    }
    const clip = S.clips[S.selIdx];
    if (!clip) { _dom.propsBody.innerHTML = '<div class="ive-empty ive-props-placeholder">Выберите клип</div>'; return; }
    if (S.activeTab === 'slide')   _renderPropsSlide(clip);
    if (S.activeTab === 'effects') _renderPropsEffects(clip);
}

function _renderPropsSubsGlobal() {
    const subs = S.subtitles;
    const $ = id => document.getElementById(id);
    _dom.propsBody.innerHTML = `
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
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px">
                <select class="ive-select" data-sf="karaokeMode" data-si="${si}" style="font-size:12px;padding:2px 4px">
                    <option value="word"${(!sub.karaokeMode || sub.karaokeMode === 'word') ? ' selected' : ''}>Только слово</option>
                    <option value="cumulative"${sub.karaokeMode === 'cumulative' ? ' selected' : ''}>Накопительно</option>
                </select>
                <input class="ive-input" type="color" data-sf="karaokeColor" data-si="${si}" value="${sub.karaokeColor || '#ffdd00'}">
            </div>
        </div>
        <label class="ive-label ive-sub-above-row" style="flex-direction:row;align-items:center;gap:6px;font-size:12px;margin-top:6px">
            <input type="checkbox" data-sf="aboveEffects" data-si="${si}"${sub.aboveEffects ? ' checked' : ''}>
            <span title="Субтитр отображается поверх фильтров и эффектов изображения">☑ Поверх эффектов (Always On Top)</span>
        </label>
    </details>
    </div>
</details>`).join('')}</div>`;

    // Accordion: open one → select it, close others
    _dom.propsBody.querySelectorAll('[data-subitem]').forEach(details => {
        details.addEventListener('toggle', () => {
            if (details.open) {
                S.selSubIdx = +details.dataset.subitem;
                _dom.propsBody.querySelectorAll('[data-subitem]').forEach(other => {
                    if (other !== details && other.open) other.open = false;
                });
                _cb.renderTimeline(); _cb.renderPreview();
            }
        });
    });

    _dom.propsBody.querySelectorAll('[data-apply-all]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const srcIdx = +btn.dataset.applyAll;
            const src = S.subtitles[srcIdx]; if (!src) return;
            const keys = ['fontFamily','fontSize','color','bold','italic','underline',
                          'outline','outlineColor','shadow','shadowColor',
                          'bgColor','bgOpacity','bgPadX','bgPadY','bgRadius',
                          'animation','animDuration','align','lineHeight',
                          'karaokeEnable','karaokeColor','karaokeMode',
                          'x','y','rotation','w','h','aboveEffects'];
            S.subtitles.forEach((sub, si) => {
                if (si === srcIdx) return;
                keys.forEach(k => { if (src[k] !== undefined) sub[k] = src[k]; });
            });
            _cb.pushHistory();
            S.dirty = true; renderProps(); _cb.renderPreview();
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
            lineHeight: 1.35, karaokeEnable: false, karaokeColor: '#ffdd00', karaokeMode: 'word',
            aboveEffects: false });
        _cb.pushHistory();
        S.selSubIdx = S.subtitles.length - 1;
        S.dirty = true; renderProps(); _cb.renderPreview(); _cb.renderTimeline();
    });

    _dom.propsBody.querySelectorAll('[data-sdel]').forEach(btn => {
        btn.addEventListener('click', () => {
            S.subtitles.splice(+btn.dataset.sdel, 1);
            if (S.selSubIdx >= S.subtitles.length) S.selSubIdx = S.subtitles.length - 1;
            _cb.pushHistory();
            S.dirty = true; renderProps(); _cb.renderPreview(); _cb.renderTimeline();
        });
    });

    _dom.propsBody.querySelectorAll('[data-sbf]').forEach(btn => {
        btn.addEventListener('click', () => {
            const si = +btn.dataset.si, key = btn.dataset.sbf;
            const sub = S.subtitles[si]; if (!sub) return;
            sub[key] = !sub[key]; btn.classList.toggle('active', sub[key]);
            _cb.pushHistory();
            S.dirty = true; _cb.renderPreview();
        });
    });

    _dom.propsBody.querySelectorAll('[data-align]').forEach(btn => {
        btn.addEventListener('click', () => {
            const si = +btn.dataset.si;
            const sub = S.subtitles[si]; if (!sub) return;
            sub.align = btn.dataset.align;
            btn.closest('.ive-row3')?.querySelectorAll('.ive-align-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _cb.pushHistory();
            S.dirty = true; _cb.renderPreview();
        });
    });

    _dom.propsBody.querySelectorAll('[data-sf][data-si]').forEach(el => {
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
            S.dirty = true; _cb.renderPreview();
            if (['start', 'end'].includes(key)) _cb.renderTimeline();
        });
    });
}

function _renderPropsAudio(track, idx) {
    const AUDIO_FX = [
        { type: 'echo',       label: 'Эхо',       params: [{key:'delay',label:'Задержка (мс)',min:50,max:2000,step:50,def:500},{key:'decay',label:'Затухание',min:0.1,max:1,step:0.1,def:0.5}] },
        { type: 'reverb',     label: 'Реверб',    params: [{key:'delay',label:'Задержка (мс)',min:50,max:3000,step:50,def:1000},{key:'decay',label:'Затухание',min:0.1,max:1,step:0.1,def:0.8}] },
        { type: 'bassboost',  label: 'Бас',       params: [{key:'gain',label:'Усиление (дБ)',min:-20,max:20,step:1,def:10}] },
        { type: 'treble',     label: 'Тембр',     params: [{key:'gain',label:'Усиление (дБ)',min:-20,max:20,step:1,def:8}] },
        { type: 'compressor', label: 'Компрес.',  params: [{key:'ratio',label:'Коэффициент',min:1,max:20,step:0.5,def:4}] },
        { type: 'phone',      label: 'Телефон',   params: [] },
        { type: 'radio',      label: 'Радио',     params: [] },
        { type: 'lowpass',    label: 'НЧ фильтр', params: [{key:'freq',label:'Частота (Гц)',min:100,max:8000,step:100,def:500}] },
        { type: 'highpass',   label: 'ВЧ фильтр', params: [{key:'freq',label:'Частота (Гц)',min:200,max:12000,step:200,def:2000}] },
        { type: 'chorus',     label: 'Хорус',     params: [] },
        { type: 'flanger',    label: 'Флэнджер',  params: [] },
        { type: 'distortion', label: 'Дисторшн',  params: [{key:'level',label:'Уровень',min:0.5,max:5,step:0.1,def:1.5}] },
        { type: 'noise',      label: 'Шумодав',   params: [] },
        { type: 'pitch',      label: 'Питч',      params: [{key:'semitones',label:'Полутоны',min:-12,max:12,step:1,def:2}] },
    ];
    const $ = id => document.getElementById(id);
    const curSpeed = track.speed ?? 1;
    const _uniqueLanes = [...new Set(S.audioTracks.map(t => t.laneIndex ?? 0))].sort((a, b) => a - b);
    const curLane = track.laneIndex ?? 0;

    _dom.propsBody.innerHTML = `
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
        <label class="ive-label">Дорожка
            <select class="ive-select" id="acp-lane">
                ${_uniqueLanes.map(l => `<option value="${l}"${l===curLane?' selected':''}>Дорожка ${l + 1}</option>`).join('')}
                <option value="__new__">+ Новая дорожка</option>
            </select>
        </label>
        <label class="ive-label">Скорость
            <div class="ive-range-row">
                <input class="ive-range" type="range" id="acp-speed-range" min="0.1" max="4" step="0.05" value="${Math.min(4, curSpeed)}">
                <input class="ive-input" id="acp-speed-input" type="number" min="0.1" max="10" step="0.05" style="width:60px;flex-shrink:0" value="${curSpeed}">
            </div>
            <div id="acp-speed-display" style="font-size:11px;color:var(--text-dim)">${curSpeed}×</div>
        </label>
        <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:8px 0 4px">Звуковые эффекты</div>
        <div class="ive-sfx-chips" id="acp-sfx-chips"></div>
        <div id="acp-sfx-params"></div>
        <button class="btn btn-sm" id="acp-split" style="margin-top:8px" title="Разделить в позиции курсора">✂ Разделить</button>
        <button class="btn btn-sm danger" id="acp-del" style="margin-top:6px">Удалить дорожку</button>
    </div>`;

    const volEl = $('acp-vol'), volV = $('acp-vol-v');
    volEl.addEventListener('input', () => {
        track.volume = parseFloat(volEl.value);
        volV.textContent = track.volume.toFixed(2);
        S.dirty = true;
        const el = _audioEls.get(track.id);
        if (el) el.volume = Math.max(0, Math.min(1, track.volume));
    });
    $('acp-fi').addEventListener('change', e => { track.fadeIn = parseFloat(e.target.value) || 0; S.dirty = true; });
    $('acp-fo').addEventListener('change', e => { track.fadeOut = parseFloat(e.target.value) || 0; S.dirty = true; });
    $('acp-offset').addEventListener('change', e => { track.startOffset = parseFloat(e.target.value) || 0; S.dirty = true; _cb.renderTimeline(); });
    $('acp-dur').addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        track.duration = isFinite(v) && v > 0 ? v : undefined;
        S.dirty = true; _cb.renderTimeline();
    });

    $('acp-lane').addEventListener('change', e => {
        if (e.target.value === '__new__') {
            track.laneIndex = _cb.getNextLane();
        } else {
            track.laneIndex = parseInt(e.target.value);
        }
        _cb.pushHistory(); S.dirty = true; _cb.renderTimeline(); renderProps();
    });

    const speedRange = $('acp-speed-range'), speedInput = $('acp-speed-input'), speedDisp = $('acp-speed-display');
    const _applySpeed = (val) => {
        const clamped = Math.max(0.1, Math.min(10, val));
        track.speed = clamped;
        speedRange.value = Math.min(4, clamped);
        speedInput.value = clamped;
        if (speedDisp) speedDisp.textContent = clamped + '×';
        if (track.originalDuration !== undefined) {
            track.duration = track.originalDuration / clamped;
            const durEl = $('acp-dur');
            if (durEl) durEl.value = track.duration.toFixed(2);
        }
        S.dirty = true;
        const el = _audioEls.get(track.id);
        if (el) el.playbackRate = clamped;
        _cb.renderTimeline();
    };
    speedRange.addEventListener('input', () => _applySpeed(parseFloat(speedRange.value) || 1));
    speedInput.addEventListener('change', () => {
        const v = parseFloat(speedInput.value);
        if (isFinite(v) && v > 0) _applySpeed(v);
    });

    // ── Sound effects ──────────────────────────────────────────────────────────
    if (!track.soundEffects) track.soundEffects = [];

    function _sfxRender() {
        const chipsEl = $('acp-sfx-chips'), paramsEl = $('acp-sfx-params');
        if (!chipsEl || !paramsEl) return;
        chipsEl.innerHTML = AUDIO_FX.map(fx => {
            const on = track.soundEffects.some(e => e.type === fx.type);
            return `<button class="ive-sfx-chip${on?' active':''}" data-fxt="${fx.type}">${fx.label}</button>`;
        }).join('');
        paramsEl.innerHTML = '';
        track.soundEffects.forEach(eff => {
            const fxDef = AUDIO_FX.find(f => f.type === eff.type);
            if (!fxDef || !fxDef.params.length) return;
            const wrap = document.createElement('div');
            wrap.className = 'ive-sfx-params-block';
            wrap.innerHTML = `<div class="ive-sfx-params-label">${fxDef.label}</div>` +
                fxDef.params.map(p => {
                    const val = eff[p.key] !== undefined ? eff[p.key] : p.def;
                    return `<label class="ive-label">${p.label}
                        <div class="ive-range-row">
                            <input class="ive-range" type="range" data-efft="${eff.type}" data-pk="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">
                            <span class="ive-range-val" id="sfxv-${eff.type}-${p.key}">${val}</span>
                        </div></label>`;
                }).join('');
            paramsEl.appendChild(wrap);
        });
        chipsEl.querySelectorAll('.ive-sfx-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.fxt;
                const i = track.soundEffects.findIndex(e => e.type === type);
                if (i >= 0) {
                    track.soundEffects.splice(i, 1);
                } else {
                    const fxDef = AUDIO_FX.find(f => f.type === type);
                    const entry = { type };
                    if (fxDef) fxDef.params.forEach(p => { entry[p.key] = p.def; });
                    track.soundEffects.push(entry);
                }
                _cb.pushHistory();
                S.dirty = true; _sfxRender();
            });
        });
        paramsEl.querySelectorAll('input[data-efft]').forEach(rng => {
            rng.addEventListener('input', () => {
                const eff = track.soundEffects.find(e => e.type === rng.dataset.efft);
                if (!eff) return;
                const val = parseFloat(rng.value);
                eff[rng.dataset.pk] = val;
                const vEl = $(`sfxv-${rng.dataset.efft}-${rng.dataset.pk}`);
                if (vEl) vEl.textContent = val;
                S.dirty = true;
            });
        });
    }
    _sfxRender();

    $('acp-split').addEventListener('click', () => {
        const t = S.currentTime;
        const st = track.startOffset || 0;
        const origDur = track.originalDuration || 3600;
        const usedDur = track.duration !== undefined ? track.duration : Math.max(1, _cb.totalDur() - st);
        const end = st + usedDur;
        if (t <= st + 0.05 || t >= end - 0.05) {
            toast('Поставьте курсор внутри аудио дорожки', 'warn'); return;
        }
        const firstDur = t - st;
        const audioSplitPos = (track.trimIn || 0) + firstDur;
        const secondDur = end - t;
        track.duration = firstDur;
        const newTrack = { ...track, id: uid(), startOffset: t, trimIn: Math.min(audioSplitPos, origDur - 0.1), duration: secondDur };
        const ti = S.audioTracks.indexOf(track);
        S.audioTracks.splice(ti + 1, 0, newTrack);
        _cb.pushHistory();
        S.dirty = true; _cb.renderTimeline(); renderProps();
        toast('Аудио разделено', 'ok');
    });
    $('acp-del').addEventListener('click', () => { S.audioTracks.splice(idx, 1); S.selAudioIdx = -1; _cb.pushHistory(); S.dirty = true; _cb.renderAll(); });
}

function _renderPropsSlide(clip) {
    const $ = id => document.getElementById(id);
    const isVideo = clip.type === 'video';
    _dom.propsBody.innerHTML = `
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
        <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 2px">Начальный эффект</div>
        <label class="ive-label">Тип
            <select class="ive-select" id="pv-start-eff-type">
                ${START_EFFECTS.map(e => `<option value="${e.value}"${(clip.startEffect?.type||'none')===e.value?' selected':''}>${e.label}</option>`).join('')}
            </select>
        </label>
        <label class="ive-label" id="pv-start-eff-dur-row" ${(!clip.startEffect?.type||clip.startEffect.type==='none')?'hidden':''}>Длит. (с)
            <input class="ive-input" id="pv-start-eff-dur" type="number" min="0.1" max="${clip.duration}" step="0.1" value="${clip.startEffect?.duration||1.0}">
        </label>
        <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 2px">Конечный эффект</div>
        <label class="ive-label">Тип
            <select class="ive-select" id="pv-end-eff-type">
                ${END_EFFECTS.map(e => `<option value="${e.value}"${(clip.endEffect?.type||'none')===e.value?' selected':''}>${e.label}</option>`).join('')}
            </select>
        </label>
        <label class="ive-label" id="pv-end-eff-dur-row" ${(!clip.endEffect?.type||clip.endEffect.type==='none')?'hidden':''}>Длит. (с)
            <input class="ive-input" id="pv-end-eff-dur" type="number" min="0.1" max="${clip.duration}" step="0.1" value="${clip.endEffect?.duration||1.0}">
        </label>
        <label class="ive-label">Скорость
            <div class="ive-range-row">
                <input class="ive-range" type="range" id="pv-speed-range" min="0.1" max="4" step="0.05" value="${Math.min(4, clip.speed??1)}">
                <input class="ive-input" id="pv-speed-input" type="number" min="0.1" max="10" step="0.05" style="width:60px;flex-shrink:0" value="${clip.speed??1}">
            </div>
            <div id="pv-speed-display" style="font-size:11px;color:var(--text-dim)">${(clip.speed??1)}×</div>
        </label>
        <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 2px">Позиция на кадре</div>
        <div class="ive-row2">
            <label class="ive-label">X%<input class="ive-input" type="number" id="pv-frame-x" min="-200" max="300" step="1" value="${clip.frameX||0}"></label>
            <label class="ive-label">Y%<input class="ive-input" type="number" id="pv-frame-y" min="-200" max="300" step="1" value="${clip.frameY||0}"></label>
        </div>
        <div class="ive-row2">
            <label class="ive-label">Ширина%<input class="ive-input" type="number" id="pv-frame-w" min="1" max="500" step="1" value="${clip.frameW??100}"></label>
            <label class="ive-label">Высота%<input class="ive-input" type="number" id="pv-frame-h" min="1" max="500" step="1" value="${clip.frameH??100}"></label>
        </div>
        <button class="btn btn-sm" id="pv-frame-reset" style="margin-top:2px" title="Вернуть на весь кадр">↺ Полный кадр</button>
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
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 2px">Трансформация</div>
        <label class="ive-label">Масштаб%<input class="ive-input" type="number" id="pv-img-scale" min="10" max="500" step="5" value="${clip.imgScale||100}"></label>
        <div class="ive-row2">
            <label class="ive-label">Смещ. X<input class="ive-input" type="number" id="pv-img-ox" min="-100" max="100" step="1" value="${clip.imgOffsetX||0}"></label>
            <label class="ive-label">Смещ. Y<input class="ive-input" type="number" id="pv-img-oy" min="-100" max="100" step="1" value="${clip.imgOffsetY||0}"></label>
        </div>
        <div class="ive-row2">
            <button class="btn btn-sm" id="pv-crop-btn">${clip.crop && clip.crop.w < 100 ? '✂ Обрезка (' + Math.round(clip.crop.w) + '×' + Math.round(clip.crop.h) + '%)' : '✂ Обрезать'}</button>
            <button class="btn btn-sm" id="pv-reset-transform" title="Сбросить трансформацию">↺ Сброс</button>
        </div>` : ''}
        ${isVideo ? `<button class="btn btn-sm" id="pv-extract-audio" style="margin-top:4px">Извлечь аудио</button>` : ''}
        <button class="btn btn-sm" id="pv-apply-all" style="margin-top:4px">Apply to All</button>
        <button class="btn btn-sm danger" id="pv-remove-clip" style="margin-top:4px">Удалить клип</button>
    </div>`;

    $('pv-dur').addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (isFinite(v) && v >= 0.5) { clip.duration = v; S.dirty = true; _cb.renderTimeline(); _cb.renderMediaList(); }
    });
    const ttEl = $('pv-trans-type'), tdRow = $('pv-tdur-row');
    ttEl.addEventListener('change', () => {
        clip.transition = clip.transition || {};
        clip.transition.type = ttEl.value;
        tdRow.hidden = ttEl.value === 'none';
        S.dirty = true; _cb.renderTimeline();
    });
    $('pv-trans-dur')?.addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (isFinite(v) && v > 0) { clip.transition.duration = v; S.dirty = true; }
    });
    const seTypeEl = $('pv-start-eff-type'), seDurRow = $('pv-start-eff-dur-row');
    seTypeEl.addEventListener('change', () => {
        clip.startEffect = clip.startEffect || {};
        clip.startEffect.type = seTypeEl.value;
        seDurRow.hidden = seTypeEl.value === 'none';
        S.dirty = true; _cb.renderPreview();
    });
    $('pv-start-eff-dur')?.addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (isFinite(v) && v > 0) { (clip.startEffect = clip.startEffect || {}).duration = v; S.dirty = true; _cb.renderPreview(); }
    });
    const eeTypeEl = $('pv-end-eff-type'), eeDurRow = $('pv-end-eff-dur-row');
    eeTypeEl.addEventListener('change', () => {
        clip.endEffect = clip.endEffect || {};
        clip.endEffect.type = eeTypeEl.value;
        eeDurRow.hidden = eeTypeEl.value === 'none';
        S.dirty = true; _cb.renderPreview();
    });
    $('pv-end-eff-dur')?.addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (isFinite(v) && v > 0) { (clip.endEffect = clip.endEffect || {}).duration = v; S.dirty = true; _cb.renderPreview(); }
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
                S.dirty = true; _cb.renderAll();
            } catch (err) { toast(err.message, 'err'); }
            $('pv-replace-file').value = '';
        });
    }
    if (!isVideo) {
        $('pv-img-scale')?.addEventListener('change', e => {
            clip.imgScale = Math.max(10, Math.min(500, parseFloat(e.target.value) || 100));
            S.dirty = true; _cb.renderPreview();
        });
        $('pv-img-ox')?.addEventListener('change', e => {
            clip.imgOffsetX = parseFloat(e.target.value) || 0;
            S.dirty = true; _cb.renderPreview();
        });
        $('pv-img-oy')?.addEventListener('change', e => {
            clip.imgOffsetY = parseFloat(e.target.value) || 0;
            S.dirty = true; _cb.renderPreview();
        });
        $('pv-crop-btn')?.addEventListener('click', () => _openCropDialog(clip));
        $('pv-reset-transform')?.addEventListener('click', () => {
            clip.imgScale = 100; clip.imgOffsetX = 0; clip.imgOffsetY = 0; clip.crop = null;
            _cb.pushHistory();
            S.dirty = true; _cb.renderPreview(); renderProps();
        });
    }
    const _applyVideoSpeed = (val) => {
        const clamped = Math.max(0.1, Math.min(10, val));
        clip.speed = clamped;
        $('pv-speed-range').value = Math.min(4, clamped);
        $('pv-speed-input').value = clamped;
        const dispEl = $('pv-speed-display');
        if (dispEl) dispEl.textContent = clamped + '×';
        if (clip.originalDuration !== undefined) {
            clip.duration = Math.max(0.5, Math.round((clip.originalDuration / clamped) * 10) / 10);
            const durEl = $('pv-dur');
            if (durEl) durEl.value = clip.duration;
        }
        S.dirty = true; _cb.renderTimeline(); _cb.renderPreview();
    };
    $('pv-speed-range').addEventListener('input', () => _applyVideoSpeed(parseFloat($('pv-speed-range').value) || 1));
    $('pv-speed-input').addEventListener('change', () => {
        const v = parseFloat($('pv-speed-input').value);
        if (isFinite(v) && v > 0) _applyVideoSpeed(v);
    });
    if (isVideo) {
        $('pv-mute-audio')?.addEventListener('change', e => {
            clip.muteAudio = e.target.checked;
            S.dirty = true;
        });
        $('pv-trimin')?.addEventListener('change', e => {
            clip.trimIn = Math.max(0, parseFloat(e.target.value) || 0);
            S.dirty = true; _cb.renderPreview();
        });
    }
    $('pv-apply-all').addEventListener('click', () => {
        S.clips.forEach((c) => {
            if (c === clip) return;
            c.duration    = clip.duration;
            c.transition  = JSON.parse(JSON.stringify(clip.transition  || {}));
            c.startEffect = JSON.parse(JSON.stringify(clip.startEffect || {}));
            c.endEffect   = JSON.parse(JSON.stringify(clip.endEffect   || {}));
            c.speed      = clip.speed;
            c.muteAudio  = clip.muteAudio;
            c.trimIn     = clip.trimIn;
        });
        _cb.pushHistory();
        S.dirty = true;
        toast(`Настройки применены к ${S.clips.length - 1} клипам`, 'ok');
        _cb.renderTimeline(); _cb.renderMediaList();
    });
    $('pv-remove-clip').addEventListener('click', () => { _cb.deleteSelectedClip(); });
    $('pv-frame-x')?.addEventListener('change', e => { clip.frameX = parseFloat(e.target.value)||0; S.dirty=true; _cb.renderPreview(); });
    $('pv-frame-y')?.addEventListener('change', e => { clip.frameY = parseFloat(e.target.value)||0; S.dirty=true; _cb.renderPreview(); });
    $('pv-frame-w')?.addEventListener('change', e => { clip.frameW = Math.max(1, parseFloat(e.target.value)||100); S.dirty=true; _cb.renderPreview(); });
    $('pv-frame-h')?.addEventListener('change', e => { clip.frameH = Math.max(1, parseFloat(e.target.value)||100); S.dirty=true; _cb.renderPreview(); });
    $('pv-frame-reset')?.addEventListener('click', () => {
        clip.frameX=0; clip.frameY=0; clip.frameW=100; clip.frameH=100;
        _cb.pushHistory(); S.dirty=true; _cb.renderPreview(); renderProps();
    });
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
                const _exLane = _cb.getNextLane();
                const track = { id: uid(), file: d.name, fileUrl: d.url, original: d.original, volume: 1, fadeIn: 0, fadeOut: 0, startOffset: _cb.findFreeAudioOffset(_exLane), trimIn: 0, laneIndex: _exLane, originalDuration: d.duration || undefined };
                S.audioTracks.push(track);
                _cb.pushHistory();
                S.dirty = true;
                _cb.renderMediaList(); _cb.renderTimeline();
                toast('Аудио добавлено в таймлайн', 'ok');
            } catch (e) { toast(e.message, 'err'); }
        });
    }
}

function _openCropDialog(clip) {
    const modal = document.getElementById('ive-crop-modal');
    if (!modal) { toast('Модальное окно кропа не найдено', 'err'); return; }
    const crop = clip.crop || { x: 0, y: 0, w: 100, h: 100 };
    document.getElementById('ive-crop-x').value = crop.x || 0;
    document.getElementById('ive-crop-y').value = crop.y || 0;
    document.getElementById('ive-crop-w').value = crop.w || 100;
    document.getElementById('ive-crop-h').value = crop.h || 100;
    const prevImg = document.getElementById('ive-crop-preview-img');
    if (prevImg) prevImg.src = clip.fileUrl || '';
    modal.hidden = false;

    const applyPreset = (ar) => {
        const xEl = document.getElementById('ive-crop-x');
        const yEl = document.getElementById('ive-crop-y');
        const wEl = document.getElementById('ive-crop-w');
        const hEl = document.getElementById('ive-crop-h');
        if (ar === 'original') { xEl.value=0; yEl.value=0; wEl.value=100; hEl.value=100; return; }
        const [aw, ah] = ar.split(':').map(Number);
        const ratio = aw / ah;
        let w = 100, h = Math.round(100 / ratio);
        if (h > 100) { h = 100; w = Math.round(100 * ratio); }
        xEl.value = Math.round((100 - w) / 2);
        yEl.value = Math.round((100 - h) / 2);
        wEl.value = w;
        hEl.value = h;
    };

    modal.querySelectorAll('.ive-crop-preset').forEach(btn => {
        btn.onclick = () => applyPreset(btn.dataset.preset);
    });

    document.getElementById('ive-crop-ok').onclick = () => {
        const x = Math.max(0, parseFloat(document.getElementById('ive-crop-x').value) || 0);
        const y = Math.max(0, parseFloat(document.getElementById('ive-crop-y').value) || 0);
        const w = Math.max(1, parseFloat(document.getElementById('ive-crop-w').value) || 100);
        const h = Math.max(1, parseFloat(document.getElementById('ive-crop-h').value) || 100);
        clip.crop = (x === 0 && y === 0 && w >= 100 && h >= 100) ? null : { x, y, w, h };
        S.dirty = true; modal.hidden = true; _cb.renderPreview(); renderProps();
    };
    document.getElementById('ive-crop-cancel').onclick = () => { modal.hidden = true; };
}

function _renderPropsSubs(clip) {
    const $ = id => document.getElementById(id);
    const subs = clip.subtitles || [];
    _dom.propsBody.innerHTML = `
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
        S.dirty = true; renderProps(); _cb.renderPreview();
    });

    _dom.propsBody.querySelectorAll('[data-sdel]').forEach(btn => {
        btn.addEventListener('click', () => {
            clip.subtitles.splice(+btn.dataset.sdel, 1);
            S.dirty = true; renderProps(); _cb.renderPreview(); _cb.renderTimeline();
        });
    });

    // B/I/U toggle buttons
    _dom.propsBody.querySelectorAll('[data-sbf]').forEach(btn => {
        btn.addEventListener('click', () => {
            const si  = +btn.dataset.si;
            const key = btn.dataset.sbf;
            const sub = clip.subtitles[si]; if (!sub) return;
            sub[key] = !sub[key];
            btn.classList.toggle('active', sub[key]);
            S.dirty = true; _cb.renderPreview();
        });
    });

    // Align buttons
    _dom.propsBody.querySelectorAll('[data-align]').forEach(btn => {
        btn.addEventListener('click', () => {
            const si  = +btn.dataset.si;
            const sub = clip.subtitles[si]; if (!sub) return;
            sub.align = btn.dataset.align;
            btn.closest('.ive-row3')?.querySelectorAll('.ive-align-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _cb.pushHistory();
            S.dirty = true; _cb.renderPreview();
        });
    });

    // All data-sf inputs
    _dom.propsBody.querySelectorAll('[data-sf][data-si]').forEach(el => {
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
            S.dirty = true; _cb.renderPreview();
            if (['start', 'end'].includes(key)) _cb.renderTimeline();
        });
    });
}

function _renderPropsEffects(clip) {
    const $ = id => document.getElementById(id);
    const efMap = Object.fromEntries((clip.effects || []).map(e => [e.type, e.value]));
    _dom.propsBody.innerHTML = `<div class="ive-form">${EFFECTS_DEF.map(ef => {
        const val = efMap[ef.key] ?? ef.def;
        if (ef.toggle) return `<label class="ive-label ive-toggle-row">${eh(ef.label)}<input class="ive-toggle" type="checkbox" data-ef="${ef.key}"${val ? ' checked' : ''}></label>`;
        return `<label class="ive-label"><span>${eh(ef.label)}</span><div class="ive-range-row"><input class="ive-range" type="range" data-ef="${ef.key}" min="${ef.min}" max="${ef.max}" step="${ef.step}" value="${val}"><span class="ive-range-val" data-efv="${ef.key}">${val}</span></div></label>`;
    }).join('')}<button class="btn btn-sm" id="pv-ef-all" style="margin-top:8px">Apply Effects to All</button><button class="btn btn-sm" id="pv-reset-ef" style="margin-top:4px">Сбросить всё</button></div>`;

    _dom.propsBody.querySelectorAll('[data-ef]').forEach(el => {
        const key = el.dataset.ef;
        el.addEventListener('input', () => {
            const v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value);
            const vEl = _dom.propsBody.querySelector(`[data-efv="${key}"]`);
            if (vEl) vEl.textContent = v;
            clip.effects = (clip.effects || []).filter(e => e.type !== key);
            if (v !== 0) clip.effects.push({ type: key, value: v });
            S.dirty = true; _cb.renderPreview();
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
    $('pv-reset-ef').addEventListener('click', () => { clip.effects = []; S.dirty = true; renderProps(); _cb.renderPreview(); });
}

function _renderPropsPip(pip, idx) {
    const $ = id => document.getElementById(id);
    const isVideo = pip.type === 'video';
    _dom.propsBody.innerHTML = `<div class="ive-form">
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
            _cb.positionPipEl(pip, _dom.pipEls.get(pip.id));
            _cb.renderPreview(); _cb.renderTimeline();
            if (extra) extra();
        });
        if (el.type === 'range') {
            el.addEventListener('input', () => {
                pip[key] = parse(el.value);
                S.dirty = true;
                _cb.positionPipEl(pip, _dom.pipEls.get(pip.id));
                _cb.renderPreview();
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
        const el = _dom.pipEls.get(pip.id);
        if (el?.wrapper?.parentNode) el.wrapper.parentNode.removeChild(el.wrapper);
        _dom.pipEls.delete(pip.id);
        S.pipLayers.splice(idx, 1);
        S.selPipIdx = -1;
        _cb.pushHistory();
        S.dirty = true;
        _cb.renderAll();
    });
}

function _renderPropsMulti() {
    const $ = id => document.getElementById(id);
    const count = S.selIdxs.size;
    _dom.propsBody.innerHTML = `<div class="ive-form">
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
        _cb.pushHistory();
        S.dirty = true;
        toast('Применено к ' + S.selIdxs.size + ' клипам', 'ok');
        _cb.renderAll();
    });
    $('multi-delete').addEventListener('click', () => {
        const sorted = [...S.selIdxs].sort((a, b) => b - a);
        sorted.forEach(i => S.clips.splice(i, 1));
        S.selIdx = S.clips.length ? 0 : -1;
        S.selIdxs = new Set(S.selIdx >= 0 ? [S.selIdx] : []);
        _cb.pushHistory();
        S.dirty = true;
        _cb.renderAll();
    });
}

function _renderPropsMultiSub() {
    const $ = id => document.getElementById(id);
    const count = S.selSubIdxs.size;
    _dom.propsBody.innerHTML = `<div class="ive-form">
        <div style="color:var(--accent);font-size:12px;margin-bottom:8px">Выбрано субтитров: ${count}</div>
        <button class="btn btn-sm danger" id="multi-sub-delete">Удалить выбранные</button>
    </div>`;
    $('multi-sub-delete')?.addEventListener('click', () => {
        const sorted = [...S.selSubIdxs].sort((a, b) => b - a);
        sorted.forEach(i => { if (S.subtitles[i] !== undefined) S.subtitles.splice(i, 1); });
        S.selSubIdx = -1; S.selSubIdxs = new Set();
        _cb.pushHistory();
        S.dirty = true; _cb.renderAll();
    });
}

function _renderPropsMultiPip() {
    const $ = id => document.getElementById(id);
    const count = S.selPipIdxs.size;
    _dom.propsBody.innerHTML = `<div class="ive-form">
        <div style="color:var(--accent);font-size:12px;margin-bottom:8px">Выбрано PIP-слоёв: ${count}</div>
        <button class="btn btn-sm danger" id="multi-pip-delete">Удалить выбранные</button>
    </div>`;
    $('multi-pip-delete')?.addEventListener('click', () => {
        const sorted = [...S.selPipIdxs].sort((a, b) => b - a);
        sorted.forEach(i => {
            const pip = S.pipLayers[i]; if (!pip) return;
            const el = _dom.pipEls.get(pip.id);
            if (el?.wrapper) el.wrapper.remove(); _dom.pipEls.delete(pip.id);
            S.pipLayers.splice(i, 1);
        });
        S.selPipIdx = -1; S.selPipIdxs = new Set();
        _cb.pushHistory();
        S.dirty = true; _cb.renderAll();
    });
}

function _renderPropsMultiAudio() {
    const $ = id => document.getElementById(id);
    const count = S.selAudioIdxs.size;
    _dom.propsBody.innerHTML = `<div class="ive-form">
        <div style="color:var(--accent);font-size:12px;margin-bottom:8px">Выбрано аудиодорожек: ${count}</div>
        <label class="ive-label">Громкость
            <div class="ive-range-row">
                <input class="ive-range" type="range" id="multi-audio-vol" min="0" max="2" step="0.01" value="1">
                <span class="ive-range-val" id="multi-audio-vol-val">100%</span>
            </div>
        </label>
        <button class="btn btn-sm" id="multi-audio-apply" style="margin-top:8px">Применить громкость</button>
        <button class="btn btn-sm danger" id="multi-audio-delete" style="margin-top:4px">Удалить выбранные</button>
    </div>`;
    const volEl = $('multi-audio-vol');
    const volVal = $('multi-audio-vol-val');
    volEl?.addEventListener('input', () => { if (volVal) volVal.textContent = Math.round(parseFloat(volEl.value) * 100) + '%'; });
    $('multi-audio-apply')?.addEventListener('click', () => {
        const vol = parseFloat($('multi-audio-vol').value);
        [...S.selAudioIdxs].forEach(i => { if (S.audioTracks[i]) S.audioTracks[i].volume = vol; });
        _cb.pushHistory();
        S.dirty = true;
        toast('Громкость применена к ' + S.selAudioIdxs.size + ' дорожкам', 'ok');
        _cb.renderAll();
    });
    $('multi-audio-delete')?.addEventListener('click', () => {
        const sorted = [...S.selAudioIdxs].sort((a, b) => b - a);
        sorted.forEach(i => {
            const track = S.audioTracks[i]; if (!track) return;
            const el = _audioEls.get(track.id);
            if (el) { el.pause(); _audioEls.delete(track.id); }
            S.audioTracks.splice(i, 1);
        });
        S.selAudioIdx = -1; S.selAudioIdxs = new Set();
        _cb.pushHistory();
        S.dirty = true; _cb.renderAll();
    });
}
