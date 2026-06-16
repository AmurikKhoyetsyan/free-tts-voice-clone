import gradio as gr
from asyncio.proactor_events import _ProactorBasePipeTransport

from core.voice_manager import voices_dropdown, VOICES_DIR
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
    height: 160px;
    background: rgba(15,15,20,0.94);
    color: #f3f4f6;
    font: 11px ui-monospace, "JetBrains Mono", Consolas, monospace;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 28px rgba(0,0,0,0.5);
}
#__voiceLog .hdr {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    background: rgba(255,255,255,0.05);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex: 0 0 auto;
}
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
    panel.innerHTML = '<div class="hdr">'
        + '<span class="title">Активность</span>'
        + '<button class="clear" type="button" title="Очистить">⌫</button>'
        + '<button class="close" type="button" title="Скрыть">×</button>'
        + '</div><div class="body"></div>';
    document.body.appendChild(panel);
    const body = panel.querySelector('.body');
    tgl.classList.add('open');

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
                        } else if (d.msg === 'process_generating') {
                            // Стримящийся output из yield: показываем реальные строки.
                            let printed = false;
                            try {
                                if (d.output && Array.isArray(d.output.data)) {
                                    d.output.data.forEach(v => {
                                        if (typeof v === 'string' && v.trim()) {
                                            const lvl = v.indexOf('❌') !== -1 ? 'err'
                                                      : (v.indexOf('✓') !== -1 ? 'done' : 'gen');
                                            voiceLog('⚙ ' + v.slice(0, 200), lvl);
                                            printed = true;
                                        }
                                    });
                                }
                            } catch (e) {}
                            if (!printed) voiceLog('⚙ модель работает...', 'gen');
                        } else if (d.msg === 'progress' && Array.isArray(d.progress_data)) {
                            d.progress_data.forEach(p => {
                                let pct = '';
                                if (p.index != null && p.length) {
                                    pct = ' ' + p.index + '/' + p.length
                                        + ' (' + Math.round(100 * p.index / p.length) + '%)';
                                } else if (p.progress != null) {
                                    pct = ' ' + Math.round(p.progress * 100) + '%';
                                }
                                const desc = String(p.desc || 'progress');
                                // Авто-распознавание ошибок по маркеру в desc.
                                let level = 'gen';
                                if (desc.includes('❌') || /ошибк/i.test(desc)) level = 'err';
                                else if (desc.includes('✓') || /готов/i.test(desc)) level = 'done';
                                voiceLog('… ' + desc + pct, level);
                            });
                        } else if (d.msg === 'process_completed') {
                            const ok = d.success !== false;
                            // Проверяем выходные данные — статус может быть "❌ ..." при
                            // мягкой валидации, тогда трактуем как ошибку.
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
                            // Если в data есть строки — выведем последнюю (это обычно статус).
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
    app.launch(inbrowser=True, allowed_paths=[VOICES_DIR])
