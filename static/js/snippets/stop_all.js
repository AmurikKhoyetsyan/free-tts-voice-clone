(...args) => {
    if (window.__ttsAudio) {
        window.__ttsAudio.stop();
    } else {
        document.querySelectorAll('audio').forEach(a => {
            try { a.pause(); a.currentTime = 0; } catch (_) {}
        });
    }
    return args;
}
