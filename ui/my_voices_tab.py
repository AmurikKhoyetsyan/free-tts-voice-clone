import json
import os

import gradio as gr
from core.tts_xtts import synthesize as xtts_synthesize, LANGUAGES
from core.voice_manager import (
    load_voice, delete_voice, rename_voice, voices_dropdown,
    get_saved_voices, VOICES_DIR,
)


def _synthesize(voice_name, text, language_label):
    if not voice_name:
        return None, "Выберите голос из списка"
    audio_path = load_voice(voice_name)
    if audio_path is None:
        return None, f"Файл голоса «{voice_name}» не найден"
    return xtts_synthesize(text, audio_path, language_label)


def _voice_urls_json():
    voices = get_saved_voices()
    paths = {
        v: os.path.join(VOICES_DIR, f"{v}.wav").replace(os.sep, "/")
        for v in voices
    }
    return json.dumps(paths)


_STOP_ALL_JS = "(...args) => { document.querySelectorAll('audio').forEach(a => { a.pause(); }); return args; }"

_PLAY_PREVIEW_JS = """
(...args) => {
    const root = document.querySelector('#voice_preview_audio');
    if (!root) return args;
    const tryPlay = (attempt = 0) => {
        const el = root.querySelector('audio');
        if (!el || !el.src) {
            if (attempt < 20) setTimeout(() => tryPlay(attempt + 1), 100);
            return;
        }
        document.querySelectorAll('audio').forEach(a => { if (a !== el) a.pause(); });
        el.currentTime = 0;
        el.play().catch(() => {});
    };
    tryPlay();
    return args;
}
"""

_PREVIEW_CSS = """
#voice_preview_audio { display: none !important; }
.voice-opt-play {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 24px;
    background: rgba(99,102,241,0.15);
    border: 1px solid rgba(99,102,241,0.5);
    cursor: pointer !important;
    font-size: 12px;
    line-height: 1;
    border-radius: 4px;
    z-index: 999999;
    user-select: none;
    color: inherit;
    pointer-events: auto !important;
}
.voice-opt-play:hover { background: rgba(99,102,241,0.35); }
.voice-opt-play.active { background: #22c55e !important; color: white; }
#__voiceDebug {
    position: fixed;
    bottom: 8px;
    right: 8px;
    z-index: 1000000;
    background: rgba(0,0,0,0.85);
    color: #fff;
    font: 11px monospace;
    padding: 8px 10px;
    border-radius: 6px;
    max-width: 380px;
    white-space: pre-wrap;
    pointer-events: none;
}
"""

INJECT_OPTIONS_PLAY_JS = """
() => {
    if (window.__voiceOptInjectorInstalled) return;
    window.__voiceOptInjectorInstalled = true;

    // ---- on-screen debug panel ----
    const dbg = document.createElement('div');
    dbg.id = '__voiceDebug';
    dbg.textContent = 'voice-play: ждём dropdown...';
    document.body.appendChild(dbg);
    const log = (msg) => {
        const t = new Date().toLocaleTimeString();
        dbg.textContent = `[${t}] ${msg}\\n` + dbg.textContent;
        if (dbg.textContent.length > 1500) dbg.textContent = dbg.textContent.slice(0, 1500);
        console.log('[voice-play]', msg);
    };
    log('injector installed');

    const getUrls = () => {
        const ta = document.querySelector('#voice_urls_data textarea, #voice_urls_data input');
        if (!ta) { log('urls textbox NOT FOUND'); return {}; }
        if (!ta.value) { log('urls textbox EMPTY'); return {}; }
        try { return JSON.parse(ta.value); } catch (e) { log('urls parse fail'); return {}; }
    };

    const getPlayer = () => {
        let p = document.getElementById('__voicePlayer');
        if (!p) {
            p = document.createElement('audio');
            p.id = '__voicePlayer';
            p.style.display = 'none';
            document.body.appendChild(p);
        }
        return p;
    };

    const playVoice = (name, btn) => {
        log('playVoice → ' + name);
        if (btn) { btn.classList.add('active'); setTimeout(() => btn.classList.remove('active'), 600); }
        const player = getPlayer();
        document.querySelectorAll('audio').forEach(a => { if (a !== player) a.pause(); });
        const map = getUrls();
        const abs = map[name];
        const candidates = [];
        if (abs) {
            candidates.push(`/gradio_api/file=${abs}`);
            candidates.push(`/file=${abs}`);
        }
        candidates.push(`/gradio_api/file=saved_voices/${encodeURIComponent(name)}.wav`);
        candidates.push(`/file=saved_voices/${encodeURIComponent(name)}.wav`);
        log('try URLs: ' + candidates.length);
        let i = 0;
        const next = () => {
            if (i >= candidates.length) { log('all URLs FAILED'); return; }
            const u = candidates[i++];
            log('→ ' + u);
            player.src = u;
            player.currentTime = 0;
            player.play().then(() => log('OK ' + u))
                         .catch(err => { log('fail ' + (err && err.name || err)); next(); });
        };
        next();
    };
    window.__playVoice = playVoice;

    // Capture-phase listeners on document, BEFORE Gradio's dropdown handlers.
    // Trigger playback on pointerdown so we don't lose the gesture if the
    // dropdown later tears down the button DOM before click fires.
    let firedThisGesture = false;
    const intercept = (e) => {
        const btn = e.target && e.target.closest && e.target.closest('.voice-opt-play');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (e.type === 'pointerdown' || e.type === 'mousedown') {
            if (firedThisGesture) return;
            firedThisGesture = true;
            const name = btn.dataset.voiceName;
            log('intercept ' + e.type + ' for ' + name);
            if (name) playVoice(name, btn);
            setTimeout(() => { firedThisGesture = false; }, 400);
        }
    };
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(t => {
        document.addEventListener(t, intercept, true);
        window.addEventListener(t, intercept, true);
    });

    const cleanName = (raw) => {
        // Gradio prefixes the currently-selected option with "✓ ", strip it.
        // Also strip any other decorative chars (▶ from our own button if
        // re-injected, bullets, etc.) and surrounding whitespace.
        return (raw || '')
            .replace(/[\\u2713\\u2714\\u2022\\u00b7\\u25b6]/g, '')
            .replace(/\\s+/g, ' ')
            .trim();
    };

    const inject = () => {
        const root = document.querySelector('#voice_select');
        if (!root) return;
        const items = root.querySelectorAll('[role="option"], ul.options li, li.item, [data-testid*="option"]');
        let added = 0, refreshed = 0;
        items.forEach(opt => {
            // Prefer Gradio's data-value if present, otherwise strip the button's
            // own text + the "✓" Gradio adds to the currently-selected option.
            const raw = opt.getAttribute('data-value') || opt.textContent;
            const name = cleanName(raw);
            if (!name) return;
            let btn = opt.querySelector(':scope > .voice-opt-play');
            if (!btn) {
                btn = document.createElement('span');
                btn.textContent = '▶';
                btn.className = 'voice-opt-play';
                btn.setAttribute('role', 'button');
                opt.style.position = 'relative';
                opt.style.paddingRight = '46px';
                opt.appendChild(btn);
                added++;
            } else if (btn.dataset.voiceName !== name) {
                refreshed++;
            }
            btn.dataset.voiceName = name;
            btn.setAttribute('aria-label', 'Прослушать ' + name);
        });
        if (added) log('injected ' + added + ' button(s)');
        if (refreshed) log('refreshed ' + refreshed + ' button name(s)');
    };

    new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
    inject();
}
"""


def _on_voice_change(name):
    return (name or ""), load_voice(name)


def build():
    with gr.Tab("Мои голоса"):
        gr.HTML(f"<style>{_PREVIEW_CSS}</style>")
        with gr.Row():
            with gr.Column(scale=3):
                voice = gr.Dropdown(choices=[], value=None, label="Выберите голос", elem_id="voice_select")
                voice_urls_data = gr.Textbox(value=_voice_urls_json(), elem_id="voice_urls_data", visible=False)
                preview = gr.Audio(type="filepath", interactive=False, show_label=False, elem_id="voice_preview_audio")
                with gr.Row():
                    rename_input = gr.Textbox(placeholder="Новое имя...", show_label=False, scale=3)
                    rename_btn   = gr.Button("Переименовать", scale=2)
                    refresh_btn  = gr.Button("⟳", scale=1, min_width=48)
                    del_btn      = gr.Button("🗑", variant="stop", scale=1, min_width=48)
                text = gr.Textbox(label="Текст", placeholder="Введите текст...", lines=6)
                lang = gr.Dropdown(choices=list(LANGUAGES.keys()), value="Русский", label="Язык")
                btn  = gr.Button("Синтезировать", variant="primary", size="lg")
            with gr.Column(scale=2):
                audio  = gr.Audio(label="Результат")
                status = gr.Textbox(label="Статус", interactive=False)

        voice.change(
            fn=_on_voice_change, inputs=[voice], outputs=[rename_input, preview]
        ).then(fn=None, inputs=None, outputs=None, js=_PLAY_PREVIEW_JS)
        refresh_btn.click(fn=voices_dropdown, outputs=[voice]).then(
            fn=_voice_urls_json, outputs=[voice_urls_data]
        )
        del_btn.click(fn=delete_voice, inputs=[voice], outputs=[status, voice]).then(
            fn=_voice_urls_json, outputs=[voice_urls_data]
        )
        rename_btn.click(fn=rename_voice, inputs=[voice, rename_input], outputs=[status, voice]).then(
            fn=_voice_urls_json, outputs=[voice_urls_data]
        )
        btn.click(fn=_synthesize, inputs=[voice, text, lang], outputs=[audio, status], js=_STOP_ALL_JS)

    return voice, voice_urls_data
