(...args) => {
    const root = document.querySelector('#voice_preview_audio');
    if (!root) return args;
    const tryPlay = (attempt = 0) => {
        const el = root.querySelector('audio');
        if (!el || !el.src) {
            if (attempt < 20) setTimeout(() => tryPlay(attempt + 1), 100);
            return;
        }
        if (window.__ttsAudio) {
            window.__ttsAudio.play(el.src).catch(() => {});
        }
    };
    tryPlay();
    return args;
}
