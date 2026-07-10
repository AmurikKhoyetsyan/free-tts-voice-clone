import { getJSON, postJSON, synthesizeStream } from '../api.js';
import { AudioPlayer } from '../audio-player.js';
import { audioManager } from '../audio-manager.js';
import { log, progress } from '../logger.js';
import { toast } from '../toast.js';
import { CustomSelect } from '../custom-select.js';
import { withLoader } from '../loader.js';
import { events } from '../events.js';

export async function init() {
    const text = document.getElementById('win-text');
    const rate = document.getElementById('win-rate');
    const vol = document.getElementById('win-vol');
    const rateVal = document.getElementById('win-rate-val');
    const volVal = document.getElementById('win-vol-val');
    const btn = document.getElementById('win-go');
    const status = document.getElementById('win-status');
    const info = document.getElementById('win-info');
    const player = new AudioPlayer(document.querySelector('[data-player="win"]'));

    // ── Subtitle panel refs ───────────────────────────────────────────────────
    const subPanel        = document.getElementById('win-sub-panel');
    const subDlBtn        = document.getElementById('win-sub-dl-btn');
    const subSplitEl      = document.getElementById('win-sub-split');
    const subCharsEl      = document.getElementById('win-sub-chars');
    const subEditorEl     = document.getElementById('win-sub-editor');
    const subProgressWrap = document.getElementById('win-sub-progress-wrap');
    const subProgressFill = document.getElementById('win-sub-progress-fill');
    const subProgressPct  = document.getElementById('win-sub-progress-pct');
    const subStatusEl     = document.getElementById('win-sub-status');

    let lastAudioName = null;
    let lastText      = null;

    function _updateSubPreview() {
        if (!lastText || !subEditorEl) return;
        const splitMode = subSplitEl ? subSplitEl.value : 'auto';
        const maxChars  = parseInt(subCharsEl ? subCharsEl.value : '35', 10);
        const subs      = _generateSubs(lastText, 150, maxChars, splitMode);
        subEditorEl.value = _subsToSRT(subs);
    }

    subSplitEl && subSplitEl.addEventListener('change', _updateSubPreview);
    subCharsEl && subCharsEl.addEventListener('input',  _updateSubPreview);

    const voiceSel = new CustomSelect(document.getElementById('win-voice-mount'), {
        placeholder: 'Выберите голос…',
    });

    rate.addEventListener('input', () => rateVal.textContent = rate.value);
    vol.addEventListener('input', () => volVal.textContent = vol.value);

    await withLoader(document.getElementById('win-voice-mount'), async () => {
        try {
            const data = await getJSON('/api/voices/windows');
            voiceSel.setOptions(data.voices.map(v => ({ value: v, label: v })));
            if (data.default) voiceSel.setValue(data.default);
            info.textContent = `Офлайн голоса Windows. Доступно: ${data.voices.length}`;
        } catch (e) {
            info.textContent = 'Не удалось загрузить список голосов';
            log('windows: ' + e.message, 'err');
        }
    });

    btn.addEventListener('click', async () => {
        if (!text.value.trim())  { toast('Введите текст для синтеза', 'warn'); return; }
        if (!voiceSel.value)     { toast('Выберите голос', 'warn'); return; }

        audioManager.stopAll();
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
                        voice: voiceSel.value,
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
                        lastAudioName = data.filename;
                        lastText      = text.value;
                        if (subPanel) subPanel.hidden = false;
                        _updateSubPreview();
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

    // ── Subtitle download (audio → MP4 with subtitles via FFmpeg) ─────────────
    subDlBtn && subDlBtn.addEventListener('click', async () => {
        if (!lastAudioName || !lastText) { toast('Сначала синтезируйте аудио', 'warn'); return; }

        let content;
        if (subEditorEl && subEditorEl.value.trim()) {
            content = subEditorEl.value;
        } else {
            const splitMode = subSplitEl ? subSplitEl.value : 'auto';
            const maxChars  = parseInt(subCharsEl ? subCharsEl.value : '35', 10);
            const subs      = _generateSubs(lastText, 150, maxChars, splitMode);
            if (!subs.length) { toast('Нет текста для субтитров', 'warn'); return; }
            content = _subsToSRT(subs);
        }

        const now = new Date();
        const p   = n => String(n).padStart(2, '0');
        const srtName = `win_sub_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

        subDlBtn.disabled = true;
        if (subProgressWrap) subProgressWrap.hidden = false;
        if (subStatusEl) { subStatusEl.textContent = 'Генерация субтитров…'; subStatusEl.className = 'status busy'; }

        try {
            const r = await postJSON('/api/subtitles', { name: srtName, content });
            const savedSrt = r.name;

            const fd = new FormData();
            fd.append('audio_name', lastAudioName);
            fd.append('srt_name',   savedSrt);

            await synthesizeStream(
                '/api/video/audio-to-video',
                { method: 'POST', body: fd },
                {
                    progress(val, desc) {
                        if (val !== null && isFinite(val)) {
                            const pct = Math.round(val * 100);
                            if (subProgressFill) subProgressFill.style.width = pct + '%';
                            if (subProgressPct)  subProgressPct.textContent  = pct + '%';
                        }
                        if (desc && subStatusEl) subStatusEl.textContent = desc;
                    },
                    done(payload) {
                        subDlBtn.disabled = false;
                        if (subProgressFill) subProgressFill.style.width = '100%';
                        if (subProgressPct)  subProgressPct.textContent  = '100%';
                        if (subStatusEl) { subStatusEl.textContent = '✓ Готово'; subStatusEl.className = 'status ok'; }
                        const a = Object.assign(document.createElement('a'),
                            { href: payload.video_url, download: payload.filename });
                        document.body.appendChild(a); a.click(); a.remove();
                        toast('Видео с субтитрами готово!', 'ok');
                        events.dispatchEvent(new CustomEvent('video-changed'));
                    },
                    error(msg) {
                        subDlBtn.disabled = false;
                        if (subStatusEl) { subStatusEl.textContent = msg; subStatusEl.className = 'status err'; }
                        toast(msg, 'err');
                    },
                }
            );
        } catch (e) {
            subDlBtn.disabled = false;
            if (subStatusEl) { subStatusEl.textContent = '❌ ' + e.message; subStatusEl.className = 'status err'; }
            toast(e.message, 'err');
        }
    });
}

// ── Subtitle generation helpers ───────────────────────────────────────────────

function _srtTime(sec) {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function _generateSubs(text, wpm, maxChars, splitMode) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    let segs = [];
    if (splitMode === 'line') {
        segs = trimmed.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (splitMode === 'sentence') {
        segs = (trimmed.match(/[^.!?…\n]+[.!?…]*/g) || [trimmed]).map(s => s.trim()).filter(Boolean);
    } else {
        const sentences = (trimmed.match(/[^.!?…\n]+[.!?…]*/g) || [trimmed]);
        for (const sent of sentences) {
            const s = sent.trim();
            if (!s) continue;
            if (s.length <= maxChars) { segs.push(s); continue; }
            const words = s.split(/\s+/);
            let cur = '';
            for (const w of words) {
                if (cur && (cur + ' ' + w).length > maxChars) { if (cur) segs.push(cur); cur = w; }
                else { cur = cur ? cur + ' ' + w : w; }
            }
            if (cur) segs.push(cur);
        }
    }
    let t = 0;
    return segs.map((seg, i) => {
        const dur = Math.max(1.0, (seg.split(/\s+/).length / wpm) * 60);
        const start = t;
        t += dur + 0.1;
        return { index: i + 1, start, end: start + dur, text: seg };
    });
}

function _subsToSRT(subs) {
    return subs.map(s => `${s.index}\n${_srtTime(s.start)} --> ${_srtTime(s.end)}\n${s.text}`).join('\n\n') + '\n';
}
