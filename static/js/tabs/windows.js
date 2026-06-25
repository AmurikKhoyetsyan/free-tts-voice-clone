import { getJSON, synthesizeStream } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';

export async function init() {
    const text = document.getElementById('win-text');
    const voice = document.getElementById('win-voice');
    const rate = document.getElementById('win-rate');
    const vol = document.getElementById('win-vol');
    const rateVal = document.getElementById('win-rate-val');
    const volVal = document.getElementById('win-vol-val');
    const btn = document.getElementById('win-go');
    const status = document.getElementById('win-status');
    const info = document.getElementById('win-info');
    const player = new AudioPlayer(document.querySelector('[data-player="win"]'));

    rate.addEventListener('input', () => rateVal.textContent = rate.value);
    vol.addEventListener('input', () => volVal.textContent = vol.value);

    try {
        const data = await getJSON('/api/voices/windows');
        voice.innerHTML = data.voices.map(v =>
            `<option value="${escapeAttr(v)}"${v === data.default ? ' selected' : ''}>${escapeHtml(v)}</option>`
        ).join('');
        info.textContent = `Офлайн голоса Windows. Доступно: ${data.voices.length}`;
    } catch (e) {
        info.textContent = 'Не удалось загрузить список голосов';
        log('windows: ' + e.message, 'err');
    }

    btn.addEventListener('click', async () => {
        if (!text.value.trim()) { toast('Введите текст для синтеза', 'warn'); return; }
        if (!voice.value)        { toast('Выберите голос', 'warn'); return; }

        btn.disabled = true;
        player.setLoading(true);
        status.className = 'status busy';
        status.textContent = '[0%] Запуск синтеза…';
        progress.start('Запуск синтеза…');

        try {
            await synthesizeStream(
                '/api/synthesize/windows',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text.value,
                        voice: voice.value,
                        rate: parseInt(rate.value, 10),
                        volume: parseInt(vol.value, 10),
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
                        log(data.status, 'done');
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
            toast(e.message, 'err');
        } finally {
            btn.disabled = false;
            player.setLoading(false);
        }
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}
