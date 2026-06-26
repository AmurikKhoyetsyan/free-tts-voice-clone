import { audioManager } from './audio-manager.js';

const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = Array.from(document.querySelectorAll('.tab-panel'));

const switchTo = (name) => {
    audioManager.stopAll();
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle('active', p.dataset.panel === name));
};

tabs.forEach(t => t.addEventListener('click', () => switchTo(t.dataset.tab)));

export const activeTab = () => document.querySelector('.tab.active')?.dataset.tab;
