import { getJSON, putJSON, del, synthesizeStream } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { audioManager } from '../audio-manager.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { openConfirm } from '../modal.js';
import { CustomSelect } from '../custom-select.js';
import { withLoader } from '../loader.js';
import { ICONS } from '../icons.js';

let voicesCache = [];

export async function init() {
    const renameInput = document.getElementById('saved-rename');
    const renameBtn = document.getElementById('saved-rename-btn');
    const deleteBtn = document.getElementById('saved-delete-btn');
    const text = document.getElementById('saved-text');
    const btn = document.getElementById('saved-go');
    const status = document.getElementById('saved-status');

    // Result player — only receives synthesized audio, never touched by preview
    const player = new AudioPlayer(document.querySelector('[data-player="saved"]'));

    // Hidden audio for voice sample previews from the dropdown
    const previewAudio = new Audio();
    const previewPlayer = { pause: () => previewAudio.pause() }; // stable ref for audioManager
    let previewName = null;
    let _switching = false; // true while we're in the middle of changing src

    previewAudio.addEventListener('play', () => {
        _switching = false;
        audioManager.play(previewPlayer); // same object every time — no spurious self-pause
        voiceSel.setActionState(previewName, true);
    });
    previewAudio.addEventListener('pause', () => {
        if (_switching) return; // spurious pause from src change — ignore
        voiceSel.setActionState(previewName, false);
    });
    previewAudio.addEventListener('ended', () => {
        voiceSel.setActionState(previewName, false);
    });

    const voiceSel = new CustomSelect(document.getElementById('saved-voice-mount'), {
        placeholder: 'Нет сохранённых голосов',
        actionIcon: ICONS.play,
        actionActiveIcon: ICONS.pause,
        actionTitle: 'Прослушать образец',

        onClose: () => {
            if (!previewAudio.paused) previewAudio.pause();
        },

        onChange: (name) => {
            renameInput.value = name || '';
            // stop preview without touching the result player
            if (!previewAudio.paused) previewAudio.pause();
            previewName = null;
        },

        onAction: (name) => {
            if (previewName === name) {
                // same voice — toggle play/pause
                if (previewAudio.paused) {
                    previewAudio.play().catch(() => {});
                    voiceSel.setActionState(name, true);
                } else {
                    previewAudio.pause();
                    // pause event fires → setActionState(name, false)
                }
            } else {
                // different voice — reset old icon immediately, load + play new
                if (previewName) voiceSel.setActionState(previewName, false);
                previewName = name;
                _switching = true;
                previewAudio.pause();          // stop current cleanly
                previewAudio.src = `/api/voices/saved/${encodeURIComponent(name)}/audio`;
                previewAudio.load();           // tell browser to fetch now
                previewAudio.play().catch(() => {
                    _switching = false;
                    voiceSel.setActionState(name, false);
                    previewName = null;
                });
                // play event fires → _switching=false + setActionState(name, true)
            }
        },
    });

    const langSel = new CustomSelect(document.getElementById('saved-lang-mount'), {
        placeholder: 'Выберите язык…',
    });

    withLoader(document.getElementById('saved-voice-mount'), () => refresh()).catch(() => {});

    getJSON('/api/xtts/status').then(data => {
        langSel.setOptions(Object.keys(data.languages).map(k => ({ value: k, label: k })));
        if (data.languages['Русский']) langSel.setValue('Русский');
        else if (Object.keys(data.languages).length) langSel.setValue(Object.keys(data.languages)[0]);
    }).catch(() => {});

    async function refresh(selectedName) {
        const data = await getJSON('/api/voices/saved');
        voicesCache = data.voices;
        if (!voicesCache.length) {
            voiceSel.setOptions([]);
            renameInput.value = '';
            return;
        }
        voiceSel.setOptions(voicesCache.map(v => ({ value: v, label: v })));
        const selected = (selectedName && voicesCache.includes(selectedName))
            ? selectedName
            : voicesCache[0];
        voiceSel.setValue(selected, true);
    }

    renameBtn.addEventListener('click', async () => {
        const old = voiceSel.value;
        if (!old) { toast('Выберите голос', 'warn'); return; }
        const newName = renameInput.value.trim();
        if (!newName || newName === old) return;
        try {
            const r = await putJSON(`/api/voices/saved/${encodeURIComponent(old)}`, { new_name: newName });
            toast(`Переименован: ${old} → ${r.new_name}`, 'ok');
            await refresh(r.new_name);
            events.dispatchEvent(new CustomEvent('voices-changed'));
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    deleteBtn.addEventListener('click', async () => {
        const name = voiceSel.value;
        if (!name) { toast('Выберите голос', 'warn'); return; }
        const ok = await openConfirm({
            title: 'Удалить голос',
            message: `Удалить голос «${name}»?`,
            confirmLabel: 'Удалить',
        });
        if (!ok) return;
        try {
            const r = await del(`/api/voices/saved/${encodeURIComponent(name)}`);
            toast(r.status, 'ok');
            if (!previewAudio.paused) previewAudio.pause();
            previewName = null;
            await refresh();
            events.dispatchEvent(new CustomEvent('voices-changed'));
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    btn.addEventListener('click', async () => {
        if (!voiceSel.value)    { toast('Выберите голос', 'warn'); return; }
        if (!text.value.trim()) { toast('Введите текст для синтеза', 'warn'); return; }

        audioManager.stopAll();

        btn.disabled = true;
        player.setLoading(true);
        status.className = 'status busy';
        status.textContent = '[0%] Запуск синтеза…';
        progress.start('Запуск синтеза…');

        try {
            await synthesizeStream(
                '/api/synthesize/saved',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text.value,
                        voice: voiceSel.value,
                        language: langSel.value || '',
                    }),
                },
                {
                    progress: (val, desc) => {
                        const pct = Math.round(val * 100);
                        status.textContent = `[${pct}%] ${desc}`;
                        progress.update(val, desc);
                        log(`⚙ ${desc} (${pct}%)`, 'gen');
                    },
                    done: (data) => {
                        status.className = 'status ok';
                        status.textContent = data.status;
                        player.setSource(data.audio_url, data.filename);
                        progress.finish(true);
                        toast(data.status, 'ok');
                        events.dispatchEvent(new CustomEvent('history-changed'));
                    },
                    error: (msg) => {
                        status.className = 'status err';
                        status.textContent = msg;
                        progress.finish(false);
                        toast(msg, 'err');
                    },
                }
            );
        } finally {
            btn.disabled = false;
            player.setLoading(false);
        }
    });

    events.addEventListener('voices-changed', () => refresh(voiceSel.value));
}
