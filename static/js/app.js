import './logger.js';
import './tabs.js';

import { init as initWindows } from './tabs/windows.js';
import { init as initCloning } from './tabs/cloning.js';
import { init as initSaved } from './tabs/saved.js';
import { init as initHistory } from './tabs/history.js';

import { log } from './logger.js';

const deleteIcon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6M14 11v6'/><path d='M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2'/></svg>`;
document.documentElement.style.setProperty('--icon-delete',
    `url("data:image/svg+xml;utf8,${encodeURIComponent(deleteIcon)}")`);

async function initOne(name, fn) {
    try {
        await fn();
        log(`${name} tab готов`, 'done');
    } catch (e) {
        log(`${name} tab: ` + e.message, 'err');
    }
}

Promise.all([
    initOne('Windows', initWindows),
    initOne('Cloning', initCloning),
    initOne('Saved',   initSaved),
    initOne('History', initHistory),
]);
