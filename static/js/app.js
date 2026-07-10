import './logger.js';
import './tabs.js';

import { init as initWindows } from './tabs/windows.js';
import { init as initCloning } from './tabs/cloning.js';
import { init as initSaved } from './tabs/saved.js';
import { init as initHistory } from './tabs/history.js';
import { init as initSubtitles } from './tabs/subtitles.js';
import { init as initVideo } from './tabs/video.js';
import { init as initLogs }     from './tabs/logs.js';
import { init as initImgVid } from './tabs/image-video.js';
import { log } from './logger.js';

const deleteIcon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6M14 11v6'/><path d='M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2'/></svg>`;
document.documentElement.style.setProperty('--icon-delete',
    `url("data:image/svg+xml;utf8,${encodeURIComponent(deleteIcon)}")`);

const inits = {
    windows:   initWindows,
    cloning:   initCloning,
    saved:     initSaved,
    history:   initHistory,
    subtitles: initSubtitles,
    video:     initVideo,
    logs:      initLogs,
    imgvid:    initImgVid,
};

const ready = new Set();

async function launch(name) {
    if (ready.has(name) || !inits[name]) return;
    ready.add(name);
    try {
        await inits[name]();
        log(`${name} tab готов`, 'done');
    } catch (e) {
        log(`${name} tab: ` + e.message, 'err');
    }
}

// Boot only the default (Windows) tab on page load
launch('windows');

// Lazily init other tabs the first time the user clicks on them
document.getElementById('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) launch(tab.dataset.tab);
});
