(() => {
    if (window.__voiceOptInjectorInstalled) return;
    window.__voiceOptInjectorInstalled = true;

    const log = (msg) => { console.log('[voice-play]', msg); };
    log('injector installed');

    const getUrls = () => {
        const ta = document.querySelector('#voice_urls_data textarea, #voice_urls_data input');
        if (!ta) { log('urls textbox NOT FOUND'); return {}; }
        if (!ta.value) { log('urls textbox EMPTY'); return {}; }
        try { return JSON.parse(ta.value); } catch (e) { log('urls parse fail'); return {}; }
    };

    const _ic = window.__ttsIconSvg || {};
    const PLAY_ICON = _ic.play  || '▶';
    const STOP_ICON = _ic.pause || '⏹';

    // ВАЖНО: никакого собственного <audio> здесь больше нет. Воспроизведением
    // владеет window.__ttsAudio (Audio Manager singleton из app.py). Мы только
    // дергаем play(url)/stop() и читаем currentUrl/isPlaying для UI.
    if (!window.__ttsAudio) {
        log('FATAL: __ttsAudio manager not installed');
    }

    // Состояние UI — какое имя голоса сейчас отражено в кнопке как ⏹.
    // Источник истины — __ttsAudio. Это локально-кэшированный маппинг
    // currentUrl → voiceName, чтобы знать какой именно вариант ▶/⏹ показать.
    let playingName = null;

    const refreshButtons = () => {
        document.querySelectorAll('.voice-opt-play').forEach(b => {
            const n = b.dataset.voiceName;
            const isThis = playingName !== null && n === playingName;
            const wantState = isThis ? 'stop' : 'play';
            if (b.dataset.state !== wantState) {
                b.dataset.state = wantState;
                b.innerHTML = isThis ? STOP_ICON : PLAY_ICON;
            }
            if (b.classList.contains('playing') !== isThis) {
                b.classList.toggle('playing', isThis);
            }
        });
    };

    // Подписываемся на состояние Manager-а — он единственный источник истины.
    // Если играет НЕ наш встроенный плеер (т.е. внешний Gradio-источник),
    // либо вообще ничего не играет — все ▶/⏹ кнопки сбрасываем в ▶.
    if (window.__ttsAudio && typeof window.__ttsAudio.subscribe === 'function') {
        window.__ttsAudio.subscribe((state) => {
            const ourPlayer = window.__ttsAudio._player;
            const ownsPlayback = state.isPlaying && state.currentAudio === ourPlayer;
            if (!ownsPlayback) {
                playingName = null;
            }
            refreshButtons();
        });
    }

    const playVoice = (name) => {
        if (!window.__ttsAudio) { log('no audio manager'); return; }
        // Second tap on the same voice while it's playing → stop.
        if (playingName === name && window.__ttsAudio.isPlaying) {
            log('stop ' + name);
            window.__ttsAudio.stop();
            return;
        }
        log('playVoice → ' + name);
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
        const tryNext = () => {
            if (i >= candidates.length) {
                log('all URLs FAILED');
                playingName = null;
                refreshButtons();
                return;
            }
            const u = candidates[i++];
            log('→ ' + u);
            // Оптимистично выставляем UI до резолва промиса —
            // мгновенная обратная связь юзеру.
            playingName = name;
            refreshButtons();
            window.__ttsAudio.play(u)
                .then(() => log('OK ' + u))
                .catch(err => {
                    log('fail ' + (err && err.name || err));
                    tryNext();
                });
        };
        tryNext();
    };
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
            if (name) playVoice(name);
            setTimeout(() => { firedThisGesture = false; }, 400);
        }
    };
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(t => {
        document.addEventListener(t, intercept, true);
        window.addEventListener(t, intercept, true);
    });

    const cleanName = (raw) => {
        // Gradio prefixes the currently-selected option with "✓ ", strip it.
        // Также убираем декоративные символы из нашей собственной кнопки
        // (▶ U+25B6, ⏹ U+23F9), маркеры списков и лишние пробелы. ВАЖНО:
        // если забыть ⏹, то при проигрывании текстовый контент <li> вида
        // "Имя⏹" не совпадёт с playingName="Имя", и иконка отвалится в ▶.
        return (raw || '')
            .replace(/[\u2713\u2714\u2022\u00b7\u25b6\u23f9]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    };

    let observer = null;
    const withObserverPaused = (fn) => {
        if (observer) observer.disconnect();
        try { fn(); } finally {
            if (observer) observer.observe(document.body, { childList: true, subtree: true });
        }
    };

    const inject = () => withObserverPaused(() => {
        const root = document.querySelector('#voice_select');
        if (!root) return;
        const items = root.querySelectorAll('[role="option"], ul.options li, li.item, [data-testid*="option"]');
        let added = 0, refreshed = 0;
        items.forEach(opt => {
            // Prefer Gradio's data-value, else strip "✓" + ▶ from text.
            const raw = opt.getAttribute('data-value') || opt.textContent;
            const name = cleanName(raw);
            if (!name) return;
            let btn = opt.querySelector(':scope > .voice-opt-play');
            if (!btn) {
                btn = document.createElement('span');
                btn.className = 'voice-opt-play';
                btn.setAttribute('role', 'button');
                if (opt.style.position !== 'relative') opt.style.position = 'relative';
                if (opt.style.paddingRight !== '46px') opt.style.paddingRight = '46px';
                opt.appendChild(btn);
                added++;
            }
            if (btn.dataset.voiceName !== name) {
                btn.dataset.voiceName = name;
                btn.setAttribute('aria-label', 'Прослушать ' + name);
                refreshed++;
            }
            const isPlayingThis = (playingName !== null) && (playingName === name);
            const wantState = isPlayingThis ? 'stop' : 'play';
            if (btn.dataset.state !== wantState) {
                btn.dataset.state = wantState;
                btn.innerHTML = isPlayingThis ? STOP_ICON : PLAY_ICON;
            }
            if (btn.classList.contains('playing') !== isPlayingThis) {
                btn.classList.toggle('playing', isPlayingThis);
            }
        });
        if (added) log('injected ' + added + ' button(s)');
        if (refreshed) log('refreshed ' + refreshed + ' name(s)');
    });

    observer = new MutationObserver(inject);
    observer.observe(document.body, { childList: true, subtree: true });
    inject();
})()