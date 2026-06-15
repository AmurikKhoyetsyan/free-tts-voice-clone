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
    // ====== АУДИО-МЬЮТЕКС: ставим САМЫМ ПЕРВЫМ в отдельном try ======
    // Гарантия "один audio за раз". Дублирует capture-listener ниже на
    // случай, если ниже что-то упадёт — наша главная страховка.
    try {
        if (!window.__ttsAudioMutexV2) {
            window.__ttsAudioMutexV2 = true;
            const pauseOthers = (target) => {
                if (!target || target.tagName !== 'AUDIO') return;
                document.querySelectorAll('audio').forEach(a => {
                    if (a !== target && !a.paused) {
                        try { a.pause(); } catch(_) {}
                    }
                });
            };
            // Capture-фаза на document — основной перехват.
            document.addEventListener('play', (e) => pauseOthers(e.target), true);
            // Прямые listener-ы на каждом <audio> — страховка для случаев,
            // когда capture не сработал (shadow DOM и т.п.).
            const wireAudio = (el) => {
                if (!el || el.__ttsAudioWired) return;
                el.__ttsAudioWired = true;
                el.addEventListener('play', () => pauseOthers(el));
            };
            const wireAll = (root) => {
                (root || document).querySelectorAll('audio').forEach(wireAudio);
            };
            wireAll();
            new MutationObserver(muts => {
                muts.forEach(m => {
                    m.addedNodes && m.addedNodes.forEach(n => {
                        if (!n || n.nodeType !== 1) return;
                        if (n.tagName === 'AUDIO') wireAudio(n);
                        else if (n.querySelectorAll) wireAll(n);
                    });
                });
            }).observe(document.body, { childList: true, subtree: true });
        }
    } catch (e) {
        try { console.error('[audio-mutex install failed]', e); } catch(_) {}
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
                            voiceLog('⚙ модель работает...', 'gen');
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

    // -------- один audio за раз + стоп при смене вкладки --------
    document.addEventListener('play', (e) => {
        const t = e.target;
        if (!t || t.tagName !== 'AUDIO') return;
        document.querySelectorAll('audio').forEach(a => {
            if (a !== t && !a.paused) a.pause();
        });
    }, true);

    const wireTabs = () => {
        document.querySelectorAll('.tab-nav button').forEach(b => {
            if (b.__ttsWired) return;
            b.__ttsWired = true;
            b.addEventListener('click', () => {
                document.querySelectorAll('audio').forEach(a => a.pause());
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
