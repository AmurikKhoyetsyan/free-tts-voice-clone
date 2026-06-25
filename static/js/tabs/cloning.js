import { getJSON, uploadForm, synthesizeStream } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';
import { events } from '../events.js';
import { CustomSelect } from '../custom-select.js';
import { FileUpload } from '../file-upload.js';
import { withLoader } from '../loader.js';

export async function init() {
    const text = document.getElementById('xtts-text');
    const saveName = document.getElementById('xtts-save-name');
    const saveBtn = document.getElementById('xtts-save-btn');
    const btn = document.getElementById('xtts-go');
    const status = document.getElementById('xtts-status');
    const info = document.getElementById('xtts-info');
    const samplePlayer = new AudioPlayer(document.querySelector('[data-player="xtts-sample"]'));
    const outPlayer = new AudioPlayer(document.querySelector('[data-player="xtts"]'));

    const upload = new FileUpload(document.getElementById('xtts-upload-mount'), {
        accept: 'audio/*',
        label: 'Перетащи аудио или нажми',
        hint: 'WAV, MP3, OGG — 10–30 секунд',
        onChange: (file) => {
            if (file) {
                samplePlayer.setSource(URL.createObjectURL(file), file.name);
            } else {
                samplePlayer.setSource(null);
            }
        },
    });

    const langSel = new CustomSelect(document.getElementById('xtts-lang-mount'), {
        placeholder: 'Выберите язык…',
    });

    await withLoader(document.getElementById('xtts-lang-mount'), async () => {
        try {
            const data = await getJSON('/api/xtts/status');
            info.textContent = data.status;
            langSel.setOptions(Object.keys(data.languages).map(k => ({ value: k, label: k })));
            if (data.languages['Русский']) langSel.setValue('Русский');
            else if (Object.keys(data.languages).length) langSel.setValue(Object.keys(data.languages)[0]);
        } catch (e) {
            info.textContent = 'XTTS статус недоступен';
        }
    });

    saveBtn.addEventListener('click', async () => {
        const f = upload.file;
        if (!f) { toast('Сначала выберите файл-образец', 'warn'); return; }
        if (!saveName.value.trim()) { toast('Введите имя голоса', 'warn'); return; }
        const fd = new FormData();
        fd.append('audio', f);
        fd.append('name', saveName.value);
        try {
            const r = await uploadForm('/api/voices/saved', fd);
            toast(r.status, 'ok');
            log(r.status, 'done');
            saveName.value = '';
            events.dispatchEvent(new CustomEvent('voices-changed'));
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    btn.addEventListener('click', async () => {
        const f = upload.file;
        if (!text.value.trim()) { toast('Введите текст для синтеза', 'warn'); return; }
        if (!f)                 { toast('Загрузите аудио-образец', 'warn'); return; }

        const fd = new FormData();
        fd.append('audio', f);
        fd.append('text', text.value);
        fd.append('language', langSel.value || '');

        btn.disabled = true;
        outPlayer.setLoading(true);
        status.className = 'status busy';
        status.textContent = '[0%] Запуск синтеза…';
        progress.start('Запуск синтеза…');

        try {
            await synthesizeStream(
                '/api/synthesize/xtts',
                { method: 'POST', body: fd },
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
                        outPlayer.setSource(data.audio_url, data.filename);
                        progress.finish(true);
                        toast(data.status, 'ok');
                        log(data.status, 'done');
                        events.dispatchEvent(new CustomEvent('history-changed'));
                    },
                    error: (msg) => {
                        status.className = 'status err';
                        status.textContent = msg;
                        progress.finish(false);
                        toast(msg, 'err');
                        log(msg, 'err');
                    },
                }
            );
        } catch (e) {
            status.className = 'status err';
            status.textContent = '❌ ' + e.message;
            progress.finish(false);
        } finally {
            btn.disabled = false;
            outPlayer.setLoading(false);
        }
    });
}
