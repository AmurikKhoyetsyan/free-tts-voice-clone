import gradio as gr
from asyncio.proactor_events import _ProactorBasePipeTransport

from core.voice_manager import voices_dropdown, VOICES_DIR
from core.audio import OUTPUT_DIR
from ui.windows_tab import build as build_windows
from ui.cloning_tab import build as build_cloning
from ui.my_voices_tab import (
    build as build_my_voices,
    INJECT_OPTIONS_PLAY_JS,
    _voice_urls_json,
)

# Suppress harmless Windows asyncio "connection forcibly closed" noise.
_orig = _ProactorBasePipeTransport._call_connection_lost
def _silent(self, exc):
    try:
        _orig(self, exc)
    except ConnectionResetError:
        pass
_ProactorBasePipeTransport._call_connection_lost = _silent

_css = """
.tab-nav button { font-size: 15px; padding: 10px 20px; }
footer { display: none !important; }

/* Скрываем устаревший локальный debug-блок — теперь сообщения
   проксируются в глобальный логгер. */
#__voiceDebug { display: none !important; }

/* ---- глобальный плавающий логгер ---- */
#__voiceLogToggle {
    position: fixed !important;
    right: 0 !important;
    top: 50% !important;
    transform: translateY(-50%) !important;
    z-index: 2147483647 !important;
    background: #4f46e5 !important;
    color: #fff !important;
    border: none !important;
    border-radius: 8px 0 0 8px !important;
    padding: 14px 10px !important;
    cursor: pointer !important;
    font-size: 13px !important;
    font-weight: 700 !important;
    line-height: 1 !important;
    letter-spacing: 1px !important;
    box-shadow: -3px 3px 12px rgba(0,0,0,0.4) !important;
    display: block !important;
    visibility: visible !important;
}
#__voiceLogToggle:hover { background: #6366f1 !important; }
#__voiceLogToggle.open { background: #ef4444 !important; }
#__voiceLog {
    position: fixed;
    right: 8px;
    bottom: 8px;
    z-index: 1000000;
    width: 340px;
    height: 220px;
    min-height: 140px;
    max-height: 90vh;
    background: rgba(15,15,20,0.94);
    color: #f3f4f6;
    font: 11px ui-monospace, "JetBrains Mono", Consolas, monospace;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 28px rgba(0,0,0,0.5);
    transition: box-shadow .15s ease;
}
#__voiceLog.dragging {
    box-shadow: 0 14px 40px rgba(0,0,0,0.7);
    transition: none;
    user-select: none;
}
#__voiceLog .hdr {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    background: rgba(255,255,255,0.05);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex: 0 0 auto;
    cursor: move;
    user-select: none;
}
#__voiceLog .hdr.grabbing { cursor: grabbing; }
#__voiceLog .progress-section {
    padding: 7px 9px 8px;
    background: rgba(255,255,255,0.03);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex: 0 0 auto;
}
#__voiceLog.idle .progress-section { display: none; }
#__voiceLog .ps-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 5px;
    gap: 8px;
}
#__voiceLog .ps-text {
    color: #fbbf24;
    font-weight: 600;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#__voiceLog .ps-pct {
    color: #f3f4f6;
    font-weight: 700;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
}
#__voiceLog .ps-bar {
    width: 100%;
    height: 6px;
    background: rgba(255,255,255,0.08);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
}
#__voiceLog .ps-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #6366f1, #34d399);
    border-radius: 3px;
    transition: width .25s ease;
}
#__voiceLog .ps-fill.err {
    background: linear-gradient(90deg, #ef4444, #dc2626);
}
#__voiceLog .ps-fill.done {
    background: linear-gradient(90deg, #10b981, #34d399);
}
#__voiceLog .ps-meta {
    margin-top: 5px;
    display: flex;
    justify-content: space-between;
    color: rgba(243,244,246,0.55);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
}
#__voiceLog .resize-handle {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 8px;
    cursor: ns-resize;
    background: transparent;
    z-index: 10;
}
#__voiceLog .resize-handle::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: 2px;
    transform: translateX(-50%);
    width: 36px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.18);
    transition: background .15s ease;
}
#__voiceLog .resize-handle:hover::after,
#__voiceLog.resizing .resize-handle::after {
    background: rgba(99,102,241,0.75);
}
#__voiceLog.resizing { user-select: none; }
#__voiceLog .title { flex: 1; font-weight: 600; font-size: 11px; letter-spacing: .3px; }
#__voiceLog .hdr button {
    background: transparent;
    border: none;
    color: #f3f4f6;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 7px;
    border-radius: 3px;
    line-height: 1;
}
#__voiceLog .hdr button:hover { background: rgba(255,255,255,0.15); }
#__voiceLog .body {
    flex: 1 1 auto;
    overflow-y: scroll;
    padding: 6px 8px;
    line-height: 1.45;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.4) rgba(255,255,255,0.05);
}
#__voiceLog .body::-webkit-scrollbar { width: 10px; }
#__voiceLog .body::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.35);
    border-radius: 5px;
}
#__voiceLog .body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.55); }
#__voiceLog .body::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); }
#__voiceLog .row { white-space: pre-wrap; word-break: break-all; padding: 1px 0; }
#__voiceLog .row.click { color: #93c5fd; }
#__voiceLog .row.gen   { color: #fbbf24; }
#__voiceLog .row.done  { color: #34d399; }
#__voiceLog .row.err   { color: #f87171; }

/* ---- equalizer-лоадер ---- */
.js-audio-loader { position: relative; }
.tts-eq-loader {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.55);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    border-radius: inherit;
    z-index: 999;
    pointer-events: none;
    overflow: hidden;
}
@media (prefers-color-scheme: dark) {
    .tts-eq-loader { background: rgba(30,32,42,0.55); }
}
.tts-eq-bars {
    height: 26px;
    display: flex;
    align-items: flex-end;
}
.tts-eq-cell { padding: 1px; }
.tts-eq-bar {
    width: 4px;
    background: var(--eq-bg, #6366f1);
    box-shadow: 0 0 6px 1px var(--eq-bg, #6366f1);
    animation: tts-eq-anim 500ms ease-in-out infinite;
    animation-delay: calc(var(--i) * -100ms);
    border-radius: 1px;
}
@keyframes tts-eq-anim {
    from { height: calc(var(--w) * 5px); }
    50%  { height: 22px; }
    to   { height: calc(var(--w) * 5px); }
}
.tts-eq-loader.err .tts-eq-bar { --eq-bg: #ef4444; }
.tts-eq-loader.done .tts-eq-bar { --eq-bg: #34d399; }
/* Глушим все встроенные индикаторы Gradio */
.progress-text, .eta-bar, .loading-status .progress,
.generating > .wrap > .loading, .svelte-1ipelgc .progress-bar,
.wrap > .loading, .loader, .pending,
[class*="loading-indicator"], [class*="spinner"] { display: none !important; }
/* Статус — никаких оверлеев */
.js-status-poll .tts-eq-loader { display: none !important; }
"""

# Один audio за раз + стоп при смене вкладки + глобальный логгер активности.
_global_js = """
() => {
    // Маркер версии — посмотри в DevTools Console. Если этой строки нет —
    // браузер показывает СТАРУЮ версию JS, перезапусти сервер и сделай
    // Ctrl+Shift+R. Без этого никакие правки не применятся.
    try { console.log('[__ttsAudio] v6 install — enforced singleton'); } catch(_) {}
    // ====== window.__ttsAudio — единый Audio Manager (singleton) ======
    // Жёсткое правило: в любой момент играет МАКСИМУМ один источник.
    //
    // Manager владеет одним <audio> элементом (this._player) для всех наших
    // управляемых проигрываний (dropdown-превью, programmatic playback).
    // Никто кроме Manager-а не должен создавать new Audio() или вызывать
    // .play()/.pause() на нём напрямую.
    //
    // Gradio-компоненты создают свои <audio> и WaveSurfer'ы внутри своих
    // Svelte-компонентов — это вне нашего контроля. Manager обращается с
    // ними как с "внешними источниками": перехватывает их play (event
    // 'play' для MediaElement-backend и click на Play-кнопке для WebAudio-
    // backend), регистрирует их как currentAudio и стопает всё остальное.
    //
    // Публичный API:
    //   __ttsAudio.play(url, opts?) → Promise   воспроизвести через свой плеер
    //   __ttsAudio.stop()                       полная остановка ВСЕГО
    //   __ttsAudio.currentAudio                 текущий активный <audio> или null
    //   __ttsAudio.isPlaying                    boolean
    //   __ttsAudio.subscribe(fn)                подписка на изменения состояния
    //
    // ====== BULLETPROOF: monkey-patches на прототипах ======
    // Сначала ставим хуки прямо на HTMLMediaElement.play и
    // AudioBufferSourceNode.start. Это даёт физическую гарантию singleton-а:
    // КАЖДЫЙ вызов play() / start() на ЛЮБОМ элементе/узле в странице
    // автоматически останавливает все остальные источники ПЕРЕД тем, как
    // делегировать в оригинал. Не важно, кто и как запускает звук — Gradio,
    // WaveSurfer (MediaElement или WebAudio backend), наш Manager, любой
    // сторонний код, — два аудио одновременно не запустятся в принципе.
    try {
        if (window.HTMLMediaElement && !HTMLMediaElement.prototype.__ttsPlayPatched) {
            const origPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function() {
                const me = this;
                // Глушим все остальные media-элементы.
                document.querySelectorAll('audio, video').forEach(function(el) {
                    if (el === me || el.paused) return;
                    try { el.pause(); el.currentTime = 0; } catch(_) {}
                });
                // Глушим активный WebAudio-источник (WaveSurfer WebAudio backend).
                if (window.__ttsAudio && window.__ttsAudio._activeBufferSource) {
                    try { window.__ttsAudio._activeBufferSource.stop(); } catch(_) {}
                    window.__ttsAudio._activeBufferSource = null;
                }
                return origPlay.apply(this, arguments);
            };
            try {
                Object.defineProperty(HTMLMediaElement.prototype, '__ttsPlayPatched', { value: true });
            } catch(_) { HTMLMediaElement.prototype.__ttsPlayPatched = true; }
        }
    } catch(_) {}
    // Глобальный registry AudioContext-ов. Любая lib (WaveSurfer, Tone.js,
    // что угодно) создаёт source-nodes через context.createBufferSource().
    // Когда такой узел запускают через start() — мы видим его .context и
    // запоминаем. Дальше при Manager.play() suspend-им все «чужие» контексты
    // → весь Web Audio output в странице глохнет физически, на уровне API.
    if (!window.__ttsAudioContexts) window.__ttsAudioContexts = [];
    try {
        if (window.AudioBufferSourceNode && !AudioBufferSourceNode.prototype.__ttsStartPatched) {
            const origStart = AudioBufferSourceNode.prototype.start;
            AudioBufferSourceNode.prototype.start = function() {
                const me = this;
                // Регистрируем контекст этого источника.
                try {
                    const ctx = me.context;
                    if (ctx && window.__ttsAudioContexts.indexOf(ctx) === -1) {
                        window.__ttsAudioContexts.push(ctx);
                    }
                } catch(_) {}
                // Глушим все нативные <audio>/<video>.
                document.querySelectorAll('audio, video').forEach(function(el) {
                    if (el.paused) return;
                    try { el.pause(); el.currentTime = 0; } catch(_) {}
                });
                // Глушим предыдущий активный WebAudio-источник и регистрируем себя.
                if (window.__ttsAudio) {
                    if (window.__ttsAudio._activeBufferSource && window.__ttsAudio._activeBufferSource !== me) {
                        try { window.__ttsAudio._activeBufferSource.stop(); } catch(_) {}
                    }
                    window.__ttsAudio._activeBufferSource = me;
                    try {
                        me.addEventListener('ended', function() {
                            if (window.__ttsAudio && window.__ttsAudio._activeBufferSource === me) {
                                window.__ttsAudio._activeBufferSource = null;
                            }
                        });
                    } catch(_) {}
                }
                return origStart.apply(this, arguments);
            };
            try {
                Object.defineProperty(AudioBufferSourceNode.prototype, '__ttsStartPatched', { value: true });
            } catch(_) { AudioBufferSourceNode.prototype.__ttsStartPatched = true; }
        }
    } catch(_) {}

    // Также пробуем перехватить КОНСТРУКТОРЫ AudioContext, чтобы регистрировать
    // даже те контексты, в которых ни один source-node ещё не стартовал.
    try {
        ['AudioContext', 'webkitAudioContext'].forEach(function(name) {
            const Orig = window[name];
            if (!Orig || Orig.__ttsPatched) return;
            const Wrapped = function() {
                const args = Array.prototype.slice.call(arguments);
                const inst = (args.length === 0)
                    ? new Orig()
                    : new (Function.prototype.bind.apply(Orig, [null].concat(args)))();
                try {
                    if (window.__ttsAudioContexts && window.__ttsAudioContexts.indexOf(inst) === -1) {
                        window.__ttsAudioContexts.push(inst);
                    }
                } catch(_) {}
                return inst;
            };
            Wrapped.prototype = Orig.prototype;
            try { Object.setPrototypeOf(Wrapped, Orig); } catch(_) {}
            try { Object.defineProperty(Wrapped, '__ttsPatched', { value: true }); } catch(_) {}
            try { window[name] = Wrapped; } catch(_) {}
        });
    } catch(_) {}

    // Helper-ы для управления зарегистрированными контекстами.
    window.__ttsSuspendForeignContexts = function() {
        if (!window.__ttsAudioContexts) return;
        window.__ttsAudioContexts.forEach(function(ctx) {
            if (!ctx) return;
            if (ctx.state === 'running' && typeof ctx.suspend === 'function') {
                try { ctx.suspend(); } catch(_) {}
            }
        });
    };
    window.__ttsResumeForeignContexts = function() {
        if (!window.__ttsAudioContexts) return;
        window.__ttsAudioContexts.forEach(function(ctx) {
            if (!ctx) return;
            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                try { ctx.resume(); } catch(_) {}
            }
        });
    };

    try {
        if (!window.__ttsAudio) {
            // ВАЖНО: в JS regex без флага `u` `\\b` — это ASCII word boundary.
            // Кириллица НЕ считается word char, поэтому `\\bпауз` НЕ матчит
            // «Пауза». Для русских меток границу не ставим.
            const isPauseLabel = (s) => /\\bpause\\b|пауз/i.test(s || '');
            const isPlayLabel  = (s) => /\\bplay\\b|воспроизв/i.test(s || '');

            const nearbyAudio = (el) => {
                if (!el) return null;
                if (el.tagName === 'AUDIO') return el;
                let cur = el;
                for (let d = 0; d < 8 && cur; d++, cur = cur.parentElement) {
                    if (cur.querySelector) {
                        const a = cur.querySelector('audio');
                        if (a) return a;
                    }
                }
                return null;
            };

            const isAudioControl = (btn) => {
                let cur = btn;
                for (let d = 0; d < 8 && cur; d++, cur = cur.parentElement) {
                    if (cur.querySelector && (cur.querySelector('audio') || cur.querySelector('canvas'))) {
                        return true;
                    }
                }
                return false;
            };

            const componentOfButton = (btn) => {
                let cur = btn;
                for (let d = 0; d < 8 && cur; d++, cur = cur.parentElement) {
                    if (cur.querySelector && cur.querySelector('audio')) return cur;
                }
                return null;
            };

            const mgr = {
                _player: null,
                _activeBufferSource: null,  // tracked WebAudio source (WaveSurfer WebAudio backend)
                _subscribers: [],
                _swappingSrc: false,
                _playToken: 0,
                currentAudio: null,
                currentUrl: null,
                isPlaying: false,

                _getPlayer: function() {
                    if (this._player) return this._player;
                    const a = document.createElement('audio');
                    a.id = '__ttsAudioPlayer';
                    a.style.display = 'none';
                    a.preload = 'auto';
                    document.body.appendChild(a);
                    this._player = a;

                    a.addEventListener('play', () => {
                        // Уже обработано в _stopExternal/_takeOver; страховка.
                        this._setState(a, a.src, true);
                    });
                    a.addEventListener('pause', () => {
                        if (this._swappingSrc) return;
                        if (a.ended) return;
                        if (this.currentAudio === a) this._setState(null, null, false);
                    });
                    a.addEventListener('ended', () => {
                        if (this.currentAudio === a) this._setState(null, null, false);
                    });
                    return a;
                },

                // Останавливает ВСЁ кроме указанного <audio>: pause+currentTime=0
                // для нативных <audio>, click по Pause-кнопкам для WaveSurfer
                // (MediaElement backend) и stop() для WebAudio buffer source
                // (WaveSurfer WebAudio backend).
                _stopExternal: function(exceptAudio) {
                    document.querySelectorAll('audio').forEach(function(a) {
                        if (a === exceptAudio) return;
                        try {
                            if (!a.paused) a.pause();
                            a.currentTime = 0;
                        } catch(_) {}
                    });
                    document.querySelectorAll('button[aria-label]').forEach(function(btn) {
                        if (!isPauseLabel(btn.getAttribute('aria-label'))) return;
                        if (!isAudioControl(btn)) return;
                        if (exceptAudio) {
                            const comp = componentOfButton(btn);
                            if (comp && comp.contains(exceptAudio)) return;
                        }
                        try { btn.click(); } catch(_) {}
                    });
                    // Прибиваем активный WebAudio-источник, если он не «свой».
                    if (this._activeBufferSource) {
                        try { this._activeBufferSource.stop(); } catch(_) {}
                        this._activeBufferSource = null;
                    }
                },

                _setState: function(audio, url, playing) {
                    this.currentAudio = audio;
                    this.currentUrl = url;
                    this.isPlaying = !!playing;
                    const snap = { currentAudio: audio, currentUrl: url, isPlaying: !!playing };
                    this._subscribers.forEach(function(fn) {
                        try { fn(snap); } catch(_) {}
                    });
                },

                // Публичное: проиграть URL через наш единственный плеер.
                play: function(url) {
                    if (!url) return Promise.reject(new Error('no url'));
                    const a = this._getPlayer();
                    const token = ++this._playToken;
                    // Сначала глушим всё чужое.
                    this._stopExternal(a);
                    // Suspend всех чужих AudioContext-ов → весь Web Audio
                    // output (включая Gradio WaveSurfer) останавливается.
                    if (window.__ttsSuspendForeignContexts) {
                        try { window.__ttsSuspendForeignContexts(); } catch(_) {}
                    }
                    this._swappingSrc = true;
                    try { a.src = url; } catch(_) {}
                    try { a.currentTime = 0; } catch(_) {}
                    const p = a.play();
                    const self = this;
                    return (p && typeof p.then === 'function' ? p : Promise.resolve())
                        .then(function() {
                            self._swappingSrc = false;
                            // Если за это время вызвали play(url2) — игнор.
                            if (token !== self._playToken) return;
                            self._setState(a, url, true);
                        })
                        .catch(function(err) {
                            self._swappingSrc = false;
                            if (token !== self._playToken) throw err;
                            self._setState(null, null, false);
                            throw err;
                        });
                },

                // Публичное: полностью остановить ВСЁ во всём приложении.
                stop: function() {
                    this._playToken++;
                    if (this._player) {
                        this._swappingSrc = true;
                        try { if (!this._player.paused) this._player.pause(); } catch(_) {}
                        try { this._player.currentTime = 0; } catch(_) {}
                        this._swappingSrc = false;
                    }
                    this._stopExternal(null);
                    if (this._activeBufferSource) {
                        try { this._activeBufferSource.stop(); } catch(_) {}
                        this._activeBufferSource = null;
                    }
                    if (window.__ttsSuspendForeignContexts) {
                        try { window.__ttsSuspendForeignContexts(); } catch(_) {}
                    }
                    this._setState(null, null, false);
                },

                // Внутреннее: внешний источник (Gradio) собирается играть.
                _takeOver: function(externalAudio) {
                    this._playToken++;
                    // Глушим всё кроме него (включая наш _player).
                    this._stopExternal(externalAudio);
                    // Внутренний счётчик не путаем: наш _player.pause фактически
                    // сейчас сработал — установим состояние.
                    const url = (externalAudio && externalAudio.src) || null;
                    this._setState(externalAudio, url, true);
                },

                subscribe: function(fn) {
                    if (typeof fn !== 'function') return function(){};
                    this._subscribers.push(fn);
                    const subs = this._subscribers;
                    return function() {
                        const i = subs.indexOf(fn);
                        if (i >= 0) subs.splice(i, 1);
                    };
                }
            };
            window.__ttsAudio = mgr;

            // Перехват 1: любой нативный <audio> сообщил 'play'. Если это
            // не наш плеер — это Gradio (MediaElement backend). Берём над ним
            // управление и стопаем всё остальное.
            document.addEventListener('play', function(e) {
                if (!e.target || e.target.tagName !== 'AUDIO') return;
                if (e.target === mgr._player) return; // свой обрабатывается в _getPlayer
                mgr._takeOver(e.target);
            }, true);

            // Перехват 2: клик по Play-кнопке Gradio-компонента (WebAudio
            // backend — 'play' event на <audio> не сработает). Перехват в
            // capture-фазе → срабатывает раньше Gradio-handler-а.
            document.addEventListener('click', function(e) {
                const btn = e.target && e.target.closest && e.target.closest('button[aria-label]');
                if (!btn) return;
                if (!isPlayLabel(btn.getAttribute('aria-label'))) return;
                if (!isAudioControl(btn)) return;
                // Resume контекстов — иначе Gradio не сможет проиграть после
                // того, как мы их раньше suspend-нули.
                if (window.__ttsResumeForeignContexts) {
                    try { window.__ttsResumeForeignContexts(); } catch(_) {}
                }
                mgr._takeOver(nearbyAudio(btn));
            }, true);

            // Страховка: прямой listener на каждый <audio> (shadow DOM,
            // переподписки и т.п.). Заодно ставим timestamp начала
            // воспроизведения — используется polling-страховкой ниже.
            const wireAudio = (el) => {
                if (!el || el.__ttsAudioWired) return;
                el.__ttsAudioWired = true;
                el.addEventListener('play', () => {
                    el.__ttsStartedAt = (window.performance && performance.now) ? performance.now() : Date.now();
                    if (el === mgr._player) return;
                    mgr._takeOver(el);
                });
            };
            const wireAll = (root) => {
                (root || document).querySelectorAll('audio, video').forEach(wireAudio);
            };
            wireAll();
            new MutationObserver(muts => {
                muts.forEach(m => {
                    m.addedNodes && m.addedNodes.forEach(n => {
                        if (!n || n.nodeType !== 1) return;
                        if (n.tagName === 'AUDIO' || n.tagName === 'VIDEO') wireAudio(n);
                        else if (n.querySelectorAll) wireAll(n);
                    });
                });
            }).observe(document.body, { childList: true, subtree: true });

            // Глобальный capture-listener: ставим timestamp ДО прямых
            // listener-ов, чтобы он стоял на всём, что играет, независимо
            // от того, успел ли wireAudio к этому элементу добраться.
            document.addEventListener('play', function(e) {
                const t = e.target;
                if (!t || (t.tagName !== 'AUDIO' && t.tagName !== 'VIDEO')) return;
                t.__ttsStartedAt = (window.performance && performance.now) ? performance.now() : Date.now();
            }, true);

            // ====== АГРЕССИВНЫЙ ENFORCEMENT (последняя линия обороны) ======
            // Раз в 30мс проверяем инвариант singleton-а:
            //   • Если играет наш _player → ВСЕ остальные <audio>/<video>
            //     паузим + currentTime=0, suspend-им все чужие AudioContext,
            //     убиваем _activeBufferSource. Гарантия: пока играет dropdown,
            //     ничего другое звучать не может.
            //   • Если играют несколько НЕ-наших audio → оставляем самое
            //     свежее (по __ttsStartedAt), остальные глушим.
            try {
                if (window.__ttsAudioPollTimer) clearInterval(window.__ttsAudioPollTimer);
                window.__ttsAudioPollTimer = setInterval(function() {
                    const player = mgr._player;
                    const playerLive = player && !player.paused && !player.ended;

                    if (playerLive) {
                        // Наш плеер играет → никто другой не имеет права играть.
                        document.querySelectorAll('audio, video').forEach(function(el) {
                            if (el === player) return;
                            if (!el.paused) {
                                try { el.pause(); el.currentTime = 0; } catch(_) {}
                            }
                        });
                        if (window.__ttsAudioContexts) {
                            window.__ttsAudioContexts.forEach(function(ctx) {
                                if (ctx && ctx.state === 'running' && typeof ctx.suspend === 'function') {
                                    try { ctx.suspend(); } catch(_) {}
                                }
                            });
                        }
                        if (mgr._activeBufferSource) {
                            try { mgr._activeBufferSource.stop(); } catch(_) {}
                            mgr._activeBufferSource = null;
                        }
                        return;
                    }

                    // Наш плеер молчит. Среди чужих оставляем самое свежее.
                    const live = [];
                    document.querySelectorAll('audio, video').forEach(function(el) {
                        if (!el.paused && !el.ended && el.readyState > 0) live.push(el);
                    });
                    if (live.length <= 1) return;
                    live.sort(function(a, b) {
                        return (b.__ttsStartedAt || 0) - (a.__ttsStartedAt || 0);
                    });
                    for (let i = 1; i < live.length; i++) {
                        try { live[i].pause(); live[i].currentTime = 0; } catch(_) {}
                    }
                }, 30);
            } catch(_) {}

            // Обратно-совместимый alias на старое имя, чтобы внешний код,
            // ещё ссылающийся на __ttsAudioBus, не падал. Минимальный shim.
            window.__ttsAudioBus = {
                stopAll: function() { mgr.stop(); },
                claim:   function(t) { mgr._takeOver(nearbyAudio(t) || t); }
            };
        }
    } catch (e) {
        try { console.error('[audio manager install failed]', e); } catch(_) {}
    }

    try {
    if (window.__ttsAudioMutex) return;
    window.__ttsAudioMutex = true;

    // -------- глобальный логгер --------
    const tgl = document.createElement('button');
    tgl.id = '__voiceLogToggle';
    tgl.type = 'button';
    tgl.title = 'Показать/скрыть лог';
    tgl.textContent = 'ЛОГ';
    document.body.appendChild(tgl);

    const panel = document.createElement('div');
    panel.id = '__voiceLog';
    panel.style.display = 'flex';
    panel.classList.add('idle');
    panel.innerHTML = '<div class="hdr">'
        + '<span class="title">Активность</span>'
        + '<button class="clear" type="button" title="Очистить">⌫</button>'
        + '<button class="close" type="button" title="Скрыть">×</button>'
        + '</div>'
        + '<div class="progress-section">'
        +   '<div class="ps-head">'
        +     '<span class="ps-text">Готово к работе</span>'
        +     '<span class="ps-pct">0%</span>'
        +   '</div>'
        +   '<div class="ps-bar"><div class="ps-fill"></div></div>'
        +   '<div class="ps-meta"><span class="ps-stage"></span><span class="ps-eta"></span></div>'
        + '</div>'
        + '<div class="body"></div>'
        + '<div class="resize-handle" title="Потяните, чтобы изменить высоту"></div>';
    document.body.appendChild(panel);
    const body = panel.querySelector('.body');
    tgl.classList.add('open');

    // ---- restore position/size from session ----
    const POS_KEY = '__voiceLog_pos_v1';
    const SIZE_KEY = '__voiceLog_size_v1';
    try {
        const pos = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null');
        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            const maxLeft = Math.max(0, window.innerWidth  - 80);
            const maxTop  = Math.max(0, window.innerHeight - 60);
            panel.style.right  = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = Math.min(pos.left, maxLeft) + 'px';
            panel.style.top  = Math.min(pos.top,  maxTop)  + 'px';
        }
        const size = JSON.parse(sessionStorage.getItem(SIZE_KEY) || 'null');
        if (size && Number.isFinite(size.height)) {
            const h = Math.max(140, Math.min(window.innerHeight * 0.9, size.height));
            panel.style.height = h + 'px';
        }
    } catch (_) {}

    // ---- progress UI ----
    const $ps = {
        sect:  panel.querySelector('.progress-section'),
        text:  panel.querySelector('.ps-text'),
        pct:   panel.querySelector('.ps-pct'),
        fill:  panel.querySelector('.ps-fill'),
        stage: panel.querySelector('.ps-stage'),
        eta:   panel.querySelector('.ps-eta'),
    };
    const fmtEta = (sec) => {
        if (!isFinite(sec) || sec <= 0) return '';
        if (sec < 1)  return '~<1с';
        if (sec < 60) return '~' + Math.round(sec) + 'с';
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return '~' + m + 'м ' + (s < 10 ? '0' + s : s) + 'с';
    };
    const progState = { active: false, started: 0, lastPct: 0, hideTimer: null };

    const setBarColor = (cls) => {
        $ps.fill.classList.remove('err', 'done');
        if (cls) $ps.fill.classList.add(cls);
    };

    // ---- equalizer-loader ----
    const EQ_STEPS = [
        { w: 2, i: 1 }, { w: 1, i: 0 }, { w: 2, i: 1 },
        { w: 1, i: 2 }, { w: 2, i: 1 }, { w: 1, i: 0 }, { w: 2, i: 2 },
    ];
    const ensureEqLoader = (host) => {
        let ov = host.querySelector(':scope > .tts-eq-loader');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.className = 'tts-eq-loader';
        const bars = document.createElement('div');
        bars.className = 'tts-eq-bars';
        EQ_STEPS.forEach(s => {
            const cell = document.createElement('div');
            cell.className = 'tts-eq-cell';
            const bar = document.createElement('div');
            bar.className = 'tts-eq-bar';
            bar.style.setProperty('--w', String(s.w));
            bar.style.setProperty('--i', String(s.i));
            cell.appendChild(bar);
            bars.appendChild(cell);
        });
        ov.appendChild(bars);
        host.appendChild(ov);
        return ov;
    };

    // Инжектим эквалайзер на любой Gradio-компонент в состоянии загрузки
    const GRADIO_LOADING_SEL = '.generating, [aria-busy="true"]';
    const shouldSkipHost = (host) => {
        if (host.closest('.tts-eq-loader')) return true;
        if (host.querySelector(':scope > .tts-eq-loader')) return true;
        if (host.id === '__voiceLog' || host.closest('#__voiceLog')) return true;
        // Пропускаем статус — в любом направлении по DOM
        if (host.classList.contains('js-status-poll')) return true;
        if (host.closest('.js-status-poll')) return true;
        if (host.querySelector('.js-status-poll')) return true;
        return false;
    };
    let _eqRefreshScheduled = false;
    const refreshGradioLoaders = () => {
        _eqRefreshScheduled = false;
        document.querySelectorAll(GRADIO_LOADING_SEL).forEach(host => {
            if (shouldSkipHost(host)) return;
            const r = host.getBoundingClientRect();
            if (r.width < 50 || r.height < 22) return;
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
            ensureEqLoader(host);
        });
        document.querySelectorAll('.tts-eq-loader').forEach(ov => {
            const host = ov.parentElement;
            if (!host) return;
            if (!host.matches(GRADIO_LOADING_SEL)) ov.remove();
        });
    };
    const scheduleEqRefresh = () => {
        if (_eqRefreshScheduled) return;
        _eqRefreshScheduled = true;
        requestAnimationFrame(refreshGradioLoaders);
    };
    new MutationObserver(scheduleEqRefresh).observe(document.body, {
        subtree: true, childList: true,
        attributes: true, attributeFilter: ['class', 'aria-busy'],
    });
    scheduleEqRefresh();

    const startProgress = (label) => {
        if (progState.hideTimer) { clearTimeout(progState.hideTimer); progState.hideTimer = null; }
        progState.active = true;
        progState.started = performance.now();
        progState.lastPct = 0;
        if (panel.style.display === 'none') {
            panel.style.display = 'flex';
            tgl.classList.add('open');
        }
        panel.classList.remove('idle');
        setBarColor(null);
        $ps.text.textContent  = label || 'Генерация...';
        $ps.pct.textContent   = '0%';
        $ps.fill.style.width  = '0%';
        $ps.stage.textContent = 'старт';
        $ps.eta.textContent   = '';
    };

    const updateProgress = (frac, desc) => {
        if (!progState.active) startProgress(desc);
        const f   = Math.max(0, Math.min(1, frac));
        const pct = Math.round(f * 100);
        progState.lastPct = pct;
        $ps.pct.textContent  = pct + '%';
        $ps.fill.style.width = pct + '%';
        if (desc) {
            $ps.text.textContent  = desc.slice(0, 60);
            $ps.stage.textContent = (desc.length > 60 ? desc.slice(0, 60) + '…' : desc);
        }
        const elapsedSec = (performance.now() - progState.started) / 1000;
        if (f >= 0.02 && f < 0.99) {
            const total = elapsedSec / f;
            $ps.eta.textContent = 'осталось ' + fmtEta(total - elapsedSec);
        } else {
            $ps.eta.textContent = elapsedSec.toFixed(1) + 'с';
        }
    };

    const finishProgress = (ok) => {
        if (!progState.active && !ok) return;
        const elapsed = ((performance.now() - progState.started) / 1000).toFixed(1);
        progState.active = false;
        setBarColor(ok ? 'done' : 'err');
        $ps.fill.style.width = '100%';
        $ps.pct.textContent  = ok ? '100%' : '—';
        $ps.text.textContent  = ok ? '✓ Готово' : '✗ Ошибка';
        $ps.stage.textContent = 'всего ' + elapsed + 'с';
        $ps.eta.textContent   = '';
        if (progState.hideTimer) clearTimeout(progState.hideTimer);
        progState.hideTimer = setTimeout(() => {
            if (!progState.active) {
                panel.classList.add('idle');
                setBarColor(null);
                $ps.fill.style.width = '0%';
            }
        }, 5000);
    };

    // Expose so other tabs/handlers can drive it.
    window.__voiceProgress = {
        start: startProgress, update: updateProgress, finish: finishProgress,
    };

    // ---- drag (mouse) ----
    const hdr = panel.querySelector('.hdr');
    let drag = null;
    hdr.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;
        const r = panel.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        panel.style.right  = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = r.left + 'px';
        panel.style.top  = r.top  + 'px';
        panel.classList.add('dragging');
        hdr.classList.add('grabbing');
        e.preventDefault();
    });

    // ---- resize (vertical) ----
    const rh = panel.querySelector('.resize-handle');
    let resize = null;
    rh.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        resize = { startY: e.clientY, startH: panel.offsetHeight };
        panel.classList.add('resizing');
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
        if (drag) {
            const w = panel.offsetWidth;
            const h = panel.offsetHeight;
            let x = e.clientX - drag.dx;
            let y = e.clientY - drag.dy;
            x = Math.max(0, Math.min(window.innerWidth  - w, x));
            y = Math.max(0, Math.min(window.innerHeight - h, y));
            panel.style.left = x + 'px';
            panel.style.top  = y + 'px';
        } else if (resize) {
            const dh = e.clientY - resize.startY;
            const h  = Math.max(140, Math.min(window.innerHeight * 0.9, resize.startH + dh));
            panel.style.height = h + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (drag) {
            drag = null;
            panel.classList.remove('dragging');
            hdr.classList.remove('grabbing');
            try {
                sessionStorage.setItem(POS_KEY, JSON.stringify({
                    left: parseInt(panel.style.left, 10) || 0,
                    top:  parseInt(panel.style.top,  10) || 0,
                }));
            } catch (_) {}
        }
        if (resize) {
            resize = null;
            panel.classList.remove('resizing');
            try {
                sessionStorage.setItem(SIZE_KEY, JSON.stringify({
                    height: panel.offsetHeight,
                }));
            } catch (_) {}
        }
    });

    // Keep the panel on-screen if the window is resized.
    window.addEventListener('resize', () => {
        if (panel.style.left === '' && panel.style.top === '') return;
        const r = panel.getBoundingClientRect();
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        const x = Math.max(0, Math.min(window.innerWidth  - w, r.left));
        const y = Math.max(0, Math.min(window.innerHeight - h, r.top));
        panel.style.left = x + 'px';
        panel.style.top  = y + 'px';
    });

    const voiceLog = (msg, level) => {
        if (msg == null) return;
        const t = new Date().toLocaleTimeString();
        const row = document.createElement('div');
        row.className = 'row' + (level ? ' ' + level : '');
        row.textContent = '[' + t + '] ' + msg;
        body.insertBefore(row, body.firstChild);
        while (body.children.length > 300) body.removeChild(body.lastChild);
        body.scrollTop = 0;
    };
    window.voiceLog = voiceLog;

    tgl.addEventListener('click', () => {
        const open = panel.style.display === 'none';
        panel.style.display = open ? 'flex' : 'none';
        tgl.classList.toggle('open', open);
    });
    panel.querySelector('.close').addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = 'none';
        tgl.classList.remove('open');
    });
    panel.querySelector('.clear').addEventListener('click', (e) => {
        e.stopPropagation();
        body.innerHTML = '';
        voiceLog('очищено');
    });

    // -------- лог кликов --------
    document.addEventListener('click', (e) => {
        const el = e.target && e.target.closest && e.target.closest(
            'button, [role="button"], a, label, .tab-nav button, .gradio-button, [role="tab"], [role="option"]'
        );
        if (!el) return;
        if (el.closest && (el.closest('#__voiceLog') || el.id === '__voiceLogToggle')) return;
        const txt = (el.getAttribute('aria-label') || el.textContent || el.title || el.id || 'элемент').trim();
        voiceLog('клик: ' + txt.slice(0, 70), 'click');
    }, true);

    // -------- проксируем старый локальный log() из my_voices_tab.py --------
    // Он зовёт console.log('[voice-play]', msg) — перехватим и проброс.
    const origLog = console.log.bind(console);
    console.log = function(...args) {
        if (args.length >= 2 && typeof args[0] === 'string' && args[0].startsWith('[voice')) {
            const msg = args.slice(1).map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
            voiceLog(msg);
        }
        return origLog(...args);
    };

    // -------- прогресс генерации (Gradio EventSource) --------
    const OrigES = window.EventSource;
    if (OrigES) {
        const Wrapped = function(url, opts) {
            const es = new OrigES(url, opts);
            const u = String(url || '');
            if (u.includes('/queue/data') || u.includes('/stream')) {
                es.addEventListener('message', (ev) => {
                    try {
                        const d = JSON.parse(ev.data);
                        if (!d || !d.msg) return;
                        if (d.msg === 'estimation') {
                            const eta = d.queue_eta != null ? ', ~' + Math.round(d.queue_eta) + 'с' : '';
                            voiceLog('очередь: ранг ' + (d.rank || 0) + eta, 'gen');
                        } else if (d.msg === 'process_starts') {
                            voiceLog('▶ генерация началась', 'gen');
                            if (window.__voiceProgress) window.__voiceProgress.start('Запуск генерации...');
                        } else if (d.msg === 'process_generating') {
                            // Стримящийся output из yield: показываем реальные строки.
                            let printed = false;
                            let lastDesc = null;
                            let lastPct  = null;
                            try {
                                if (d.output && Array.isArray(d.output.data)) {
                                    d.output.data.forEach(v => {
                                        if (typeof v === 'string' && v.trim()) {
                                            const lvl = v.indexOf('❌') !== -1 ? 'err'
                                                      : (v.indexOf('✓') !== -1 ? 'done' : 'gen');
                                            voiceLog('⚙ ' + v.slice(0, 200), lvl);
                                            printed = true;
                                            // Парсим "[ NN%] описание" из stream() — это
                                            // даёт нам fraction и desc для прогресс-бара.
                                            const m = v.match(/^\\[\\s*(\\d+)%\\]\\s*(.*)$/);
                                            if (m) {
                                                lastPct  = parseInt(m[1], 10) / 100;
                                                lastDesc = m[2] || '';
                                            }
                                        }
                                    });
                                }
                            } catch (e) {}
                            if (!printed) voiceLog('⚙ модель работает...', 'gen');
                            if (lastPct != null && window.__voiceProgress) {
                                window.__voiceProgress.update(lastPct, lastDesc);
                            }
                        } else if (d.msg === 'progress' && Array.isArray(d.progress_data)) {
                            d.progress_data.forEach(p => {
                                let frac = null;
                                let pct  = '';
                                if (p.index != null && p.length) {
                                    frac = p.index / p.length;
                                    pct  = ' ' + p.index + '/' + p.length
                                        + ' (' + Math.round(100 * frac) + '%)';
                                } else if (p.progress != null) {
                                    frac = Number(p.progress);
                                    pct  = ' ' + Math.round(frac * 100) + '%';
                                }
                                const desc = String(p.desc || 'progress');
                                let level = 'gen';
                                if (desc.includes('❌') || /ошибк/i.test(desc)) level = 'err';
                                else if (desc.includes('✓') || /готов/i.test(desc)) level = 'done';
                                voiceLog('… ' + desc + pct, level);
                                if (frac != null && window.__voiceProgress) {
                                    window.__voiceProgress.update(frac, desc);
                                }
                            });
                        } else if (d.msg === 'process_completed') {
                            const ok = d.success !== false;
                            let outErr = false;
                            try {
                                if (d.output && Array.isArray(d.output.data)) {
                                    d.output.data.forEach(v => {
                                        if (typeof v === 'string' && v.indexOf('❌') !== -1) outErr = true;
                                    });
                                }
                            } catch (e) {}
                            const success = ok && !outErr;
                            voiceLog(success ? '✓ генерация готова' : '✗ генерация прервана', success ? 'done' : 'err');
                            if (d.output && d.output.error) voiceLog('ошибка: ' + d.output.error, 'err');
                            try {
                                if (d.output && Array.isArray(d.output.data)) {
                                    d.output.data.forEach(v => {
                                        if (typeof v === 'string' && v.trim()) {
                                            voiceLog('статус: ' + v.slice(0, 200),
                                                     v.indexOf('❌') !== -1 ? 'err' : 'done');
                                        }
                                    });
                                }
                            } catch (e) {}
                            if (window.__voiceProgress) window.__voiceProgress.finish(success);
                        }
                    } catch (e) {}
                });
            }
            return es;
        };
        Wrapped.CONNECTING = OrigES.CONNECTING;
        Wrapped.OPEN = OrigES.OPEN;
        Wrapped.CLOSED = OrigES.CLOSED;
        Wrapped.prototype = OrigES.prototype;
        window.EventSource = Wrapped;
    }

    // -------- polling status-textbox для real-time прогресса --------
    // В Gradio 4.x перехват EventSource не всегда срабатывает (зависит от
    // транспорта: SSE / fetch+ReadableStream / websocket). Поэтому основной
    // источник прогресса — прямое чтение DOM: streaming-генератор stream()
    // обновляет <textarea> статуса значениями вида "[ NN%] описание", их
    // достаточно опрашивать раз в 200мс.
    const _statusState = new Map(); // textarea → {lastValue, lastDesc}
    const _scanStatus = () => {
        document.querySelectorAll('.js-status-poll textarea, .js-status-poll input').forEach((el) => {
            const v  = String(el.value || '');
            const st = _statusState.get(el) || { lastValue: '', lastDesc: '' };
            if (st.lastValue === v) return;
            st.lastValue = v;
            _statusState.set(el, st);

            if (!v.trim()) return;

            const m = v.match(/^\\[\\s*(\\d+)%\\]\\s*(.*)$/);
            if (m) {
                const frac = parseInt(m[1], 10) / 100;
                const desc = (m[2] || '').trim();
                if (window.__voiceProgress) window.__voiceProgress.update(frac, desc);
                // Логируем только смену стадии (по тексту), иначе на каждое
                // слово в Windows-TTS получим спам.
                if (desc && desc !== st.lastDesc) {
                    st.lastDesc = desc;
                    let level = 'gen';
                    if (/❌|ошибк/i.test(desc))      level = 'err';
                    else if (/✓|готов/i.test(desc)) level = 'done';
                    voiceLog('⚙ ' + desc + ' (' + Math.round(frac * 100) + '%)', level);
                }
            } else {
                // Финальный статус без процента: "✓ Готово ..." / "❌ Ошибка ..."
                const isDone = v.indexOf('✓') !== -1;
                const isErr  = v.indexOf('❌') !== -1;
                if (isDone || isErr) {
                    voiceLog(v.slice(0, 200), isDone ? 'done' : 'err');
                    if (window.__voiceProgress) window.__voiceProgress.finish(isDone);
                    st.lastDesc = '';
                }
            }
        });
    };
    setInterval(_scanStatus, 200);

    // -------- стоп при смене вкладки --------
    const wireTabs = () => {
        document.querySelectorAll('.tab-nav button').forEach(b => {
            if (b.__ttsWired) return;
            b.__ttsWired = true;
            b.addEventListener('click', () => {
                if (window.__ttsAudio) window.__ttsAudio.stop();
            });
        });
    };
    wireTabs();
    new MutationObserver(wireTabs).observe(document.body, { childList: true, subtree: true });

    voiceLog('логгер запущен');
    } catch (err) {
        try { console.error('[voice-log init failed]', err); } catch (e) {}
        // Безусловный fallback — если что-то рухнуло выше, хотя бы сделаем
        // кнопку видимой, чтобы было понятно, что JS пытался стартовать.
        try {
            if (!document.getElementById('__voiceLogToggle')) {
                const b = document.createElement('button');
                b.id = '__voiceLogToggle';
                b.textContent = 'ЛОГ?';
                b.title = String(err && err.message || err);
                b.onclick = () => alert(b.title);
                document.body.appendChild(b);
            }
        } catch (e) {}
    }
}
"""

with gr.Blocks(title="TTS — Синтез речи", theme=gr.themes.Soft(), css=_css, js=_global_js) as app:
    gr.Markdown("# Синтез речи и клонирование голоса")
    with gr.Tabs():
        build_windows()
        build_cloning()
        sv_voice, sv_urls = build_my_voices()

    # Обновляем список голосов и URL-карту при каждом открытии страницы
    app.load(fn=voices_dropdown, outputs=[sv_voice])
    app.load(fn=_voice_urls_json, outputs=[sv_urls])
    # Дублирующий запуск логгера через app.load — на случай если js= на Blocks
    # по какой-то причине не отработал (старая версия Gradio, кэш, и т.п.).
    app.load(fn=None, inputs=None, outputs=None, js=_global_js)
    # Инжектим ▶ в опции дропдауна голосов (один раз, ставит MutationObserver)
    app.load(fn=None, inputs=None, outputs=None, js=INJECT_OPTIONS_PLAY_JS)

if __name__ == "__main__":
    app.launch(inbrowser=True, allowed_paths=[VOICES_DIR, OUTPUT_DIR])
