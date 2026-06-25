(...args) => {
    const f = window.__ttsHistFile || '';
    if (window.voiceLog) window.voiceLog('[hist-js] file=' + f);
    return [f];
}
