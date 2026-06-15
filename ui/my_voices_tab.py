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
    width: 26px;
    height: 22px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    border-radius: 4px;
    z-index: 10;
    user-select: none;
    color: inherit;
}
.voice-opt-play:hover { background: rgba(127,127,127,0.25); }
"""

INJECT_OPTIONS_PLAY_JS = """
() => {
    if (window.__voiceOptInjectorInstalled) return;
    window.__voiceOptInjectorInstalled = true;
    console.log('[voice-play] injector installed');

    const getUrls = () => {
        const ta = document.querySelector('#voice_urls_data textarea, #voice_urls_data input');
        if (!ta) { console.warn('[voice-play] urls textbox not found'); return {}; }
        if (!ta.value) { console.warn('[voice-play] urls textbox empty'); return {}; }
        try { return JSON.parse(ta.value); } catch (e) { console.warn('[voice-play] urls parse fail', e); return {}; }
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

    const playVoice = (name) => {
        console.log('[voice-play] playVoice called', name);
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
        console.log('[voice-play] candidates', candidates);
        let i = 0;
        const next = () => {
            if (i >= candidates.length) { console.warn('[voice-play] all URLs failed'); return; }
            const u = candidates[i++];
            player.src = u;
            player.currentTime = 0;
            player.play().then(() => console.log('[voice-play] OK', u))
                         .catch(err => { console.warn('[voice-play] failed', u, err); next(); });
        };
        next();
    };
    window.__playVoice = playVoice;

    // Capture-phase listeners on document — fire BEFORE Gradio's dropdown
    // handlers, so the option doesn't get selected / popup doesn't close
    // when the ▶ button is clicked inside an option.
    const intercept = (e) => {
        const btn = e.target && e.target.closest && e.target.closest('.voice-opt-play');
        if (!btn) return;
        console.log('[voice-play] intercept', e.type, btn.dataset.voiceName);
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (e.type === 'click') {
            const name = btn.dataset.voiceName;
            if (name) playVoice(name);
        }
    };
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(t => {
        document.addEventListener(t, intercept, true);
    });

    const inject = () => {
        const root = document.querySelector('#voice_select');
        if (!root) return;
        const items = root.querySelectorAll('[role="option"], ul.options li, li.item');
        if (items.length) console.log('[voice-play] inject: found', items.length, 'options');
        items.forEach(opt => {
            if (opt.dataset.playInjected) return;
            const name = opt.textContent.trim();
            if (!name) return;
            opt.dataset.playInjected = '1';
            const btn = document.createElement('span');
            btn.textContent = '▶';
            btn.className = 'voice-opt-play';
            btn.dataset.voiceName = name;
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', 'Прослушать ' + name);
            opt.style.position = 'relative';
            opt.style.paddingRight = '40px';
            opt.appendChild(btn);
            console.log('[voice-play] injected button for', name);
        });
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
