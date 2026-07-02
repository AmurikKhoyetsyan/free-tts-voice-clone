import { getJSON, postJSON, putJSON, del } from '../api.js';
import { toast } from '../toast.js';
import { log } from '../logger.js';
import { events } from '../events.js';
import { openPrompt } from '../modal.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectStyle() {
    const g = id => document.getElementById(id);
    return {
        fontFamily:      (g('vid-font-family')    || {}).value       || 'Arial',
        fontSize:        (g('vid-font-size-n')     || {}).value       || '24',
        fontColor:       (g('vid-font-color')      || {}).value       || '#ffffff',
        bold:            (g('vid-bold')            || {}).checked     || false,
        position:        (g('vid-position')        || {}).value       || 'bottom',
        bgOpacity:       (g('vid-bg-opacity-n')    || {}).value       || '50',
        bgColor:         (g('vid-bg-color')        || {}).value       || '#000000',
        bgPadX:          (g('vid-bg-pad-x')        || {}).value       || '12',
        bgPadY:          (g('vid-bg-pad-y')        || {}).value       || '6',
        bgRadius:        (g('vid-bg-radius')       || {}).value       || '4',
        outlineSize:     (g('vid-outline-size-n')  || {}).value       || '1',
        outlineColor:    (g('vid-outline-color')   || {}).value       || '#000000',
        shadowSize:      (g('vid-shadow-size-n')   || {}).value       || '0',
        shadowColor:     (g('vid-shadow-color')    || {}).value       || '#000000',
        lineHeight:      (g('vid-line-height')     || {}).value       || '1.35',
        maxWidth:        (g('vid-max-width')       || {}).value       || '90',
        marginV:         (g('vid-margin-v')        || {}).value       || '10',
        karaokeColor:    (g('vid-karaoke-color')   || {}).value       || '#ffdd00',
        karaokeEnabled:  (g('vid-karaoke-enable')  || {}).checked     || false,
    };
}

function applyStyle(settings) {
    const g = id => document.getElementById(id);
    function setVal(id, val) {
        const el = g(id);
        if (!el) return;
        el.value = val;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function setCheck(id, val) {
        const el = g(id);
        if (!el) return;
        el.checked = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setVal('vid-font-family',   settings.fontFamily   ?? 'Arial');
    setVal('vid-font-size',     settings.fontSize     ?? '24');
    setVal('vid-font-size-n',   settings.fontSize     ?? '24');
    setVal('vid-font-color',    settings.fontColor    ?? '#ffffff');
    setCheck('vid-bold',        settings.bold         ?? false);
    setVal('vid-position',      settings.position     ?? 'bottom');
    setVal('vid-bg-opacity',    settings.bgOpacity    ?? '50');
    setVal('vid-bg-opacity-n',  settings.bgOpacity    ?? '50');
    setVal('vid-bg-color',      settings.bgColor      ?? '#000000');
    setVal('vid-bg-pad-x',      settings.bgPadX       ?? '12');
    setVal('vid-bg-pad-y',      settings.bgPadY       ?? '6');
    setVal('vid-bg-radius',     settings.bgRadius     ?? '4');
    setVal('vid-outline-size',  settings.outlineSize  ?? '1');
    setVal('vid-outline-size-n',settings.outlineSize  ?? '1');
    setVal('vid-outline-color', settings.outlineColor ?? '#000000');
    setVal('vid-shadow-size',   settings.shadowSize   ?? '0');
    setVal('vid-shadow-size-n', settings.shadowSize   ?? '0');
    setVal('vid-shadow-color',  settings.shadowColor  ?? '#000000');
    setVal('vid-line-height',   settings.lineHeight   ?? '1.35');
    setVal('vid-max-width',     settings.maxWidth     ?? '90');
    setVal('vid-margin-v',      settings.marginV      ?? '10');
    setVal('vid-karaoke-color', settings.karaokeColor ?? '#ffdd00');
    setCheck('vid-karaoke-enable', settings.karaokeEnabled ?? false);
}

function settingsHtml(settings) {
    const labels = {
        fontFamily: 'Шрифт', fontSize: 'Размер', fontColor: 'Цвет текста',
        bold: 'Жирный', position: 'Позиция', bgOpacity: 'Фон %',
        bgColor: 'Цвет фона', bgPadX: 'Отступ X', bgPadY: 'Отступ Y',
        bgRadius: 'Радиус', outlineSize: 'Обводка', outlineColor: 'Цвет обв.',
        shadowSize: 'Тень', shadowColor: 'Цвет тени', lineHeight: 'Межстрочный',
        maxWidth: 'Ширина %', marginV: 'Отступ V', karaokeColor: 'Karaoke цвет',
        karaokeEnabled: 'Karaoke',
    };
    return Object.entries(settings).map(([k, v]) => {
        const lbl = labels[k] || k;
        const val = typeof v === 'boolean' ? (v ? 'да' : 'нет') : v;
        return `<span>${lbl}:</span><b>${escHtml(String(val))}</b>`;
    }).join('');
}

function escHtml(s) {
    return String(s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── Tab init ──────────────────────────────────────────────────────────────────

export async function init() {
    const saveNameEl  = document.getElementById('tmpl-save-name');
    const saveBtnEl   = document.getElementById('tmpl-save-btn');
    const saveStatusEl= document.getElementById('tmpl-save-status');
    const refreshBtnEl= document.getElementById('tmpl-refresh-btn');
    const listEl      = document.getElementById('tmpl-list');
    const statusEl    = document.getElementById('tmpl-status');
    const previewPanel= document.getElementById('tmpl-preview-panel');
    const previewGrid = document.getElementById('tmpl-preview-settings');

    async function loadList() {
        try {
            const data = await getJSON('/api/templates');
            renderList(data.templates || []);
        } catch (e) {
            if (statusEl) { statusEl.textContent = '❌ ' + e.message; statusEl.className = 'status err'; }
        }
    }

    function renderList(templates) {
        if (!listEl) return;
        if (!templates.length) {
            listEl.innerHTML = '<div class="sub-empty">Нет сохранённых шаблонов</div>';
            return;
        }
        listEl.innerHTML = templates.map(name => `
            <div class="tmpl-card" data-name="${escHtml(name)}">
                <span class="tmpl-card-name" title="${escHtml(name)}">${escHtml(name)}</span>
                <button class="btn btn-sm tmpl-apply-btn"   data-name="${escHtml(name)}" title="Применить шаблон">Применить</button>
                <button class="btn btn-sm tmpl-update-btn"  data-name="${escHtml(name)}" title="Обновить из текущих настроек">Обновить</button>
                <button class="btn btn-sm tmpl-rename-btn"  data-name="${escHtml(name)}" title="Переименовать">Переименовать</button>
                <button class="btn btn-sm btn-danger tmpl-delete-btn" data-name="${escHtml(name)}" title="Удалить">Удалить</button>
            </div>
        `).join('');
    }

    // Delegation
    listEl && listEl.addEventListener('click', async e => {
        const applyBtn  = e.target.closest('.tmpl-apply-btn');
        const updateBtn = e.target.closest('.tmpl-update-btn');
        const renameBtn = e.target.closest('.tmpl-rename-btn');
        const deleteBtn = e.target.closest('.tmpl-delete-btn');

        if (applyBtn) {
            const name = applyBtn.dataset.name;
            try {
                const data = await getJSON(`/api/templates/${encodeURIComponent(name)}`);
                applyStyle(data.settings);
                // Show preview
                if (previewPanel && previewGrid) {
                    previewGrid.innerHTML = settingsHtml(data.settings);
                    previewPanel.hidden = false;
                }
                toast(`Шаблон применён: ${name}`, 'ok');
                events.dispatchEvent(new CustomEvent('template-apply', { detail: { name, settings: data.settings } }));
            } catch (err) {
                toast('Ошибка: ' + err.message, 'err');
            }
            return;
        }

        if (updateBtn) {
            const name = updateBtn.dataset.name;
            try {
                const settings = collectStyle();
                await postJSON('/api/templates', { name, settings });
                toast(`Шаблон обновлён: ${name}`, 'ok');
                events.dispatchEvent(new CustomEvent('template-changed'));
            } catch (err) {
                toast('Ошибка: ' + err.message, 'err');
            }
            return;
        }

        if (renameBtn) {
            const name = renameBtn.dataset.name;
            const newName = await openPrompt({ title: `Переименовать шаблон "${name}"`, initial: name });
            if (!newName || newName.trim() === name) return;
            try {
                await putJSON(`/api/templates/${encodeURIComponent(name)}`, { new_name: newName.trim() });
                toast(`Переименован: ${name} → ${newName.trim()}`, 'ok');
                events.dispatchEvent(new CustomEvent('template-changed'));
                await loadList();
            } catch (err) {
                toast('Ошибка: ' + err.message, 'err');
            }
            return;
        }

        if (deleteBtn) {
            const name = deleteBtn.dataset.name;
            if (!confirm(`Удалить шаблон «${name}»?`)) return;
            try {
                await del(`/api/templates/${encodeURIComponent(name)}`);
                toast(`Удалён: ${name}`, 'ok');
                events.dispatchEvent(new CustomEvent('template-changed'));
                await loadList();
            } catch (err) {
                toast('Ошибка: ' + err.message, 'err');
            }
        }
    });

    saveBtnEl && saveBtnEl.addEventListener('click', async () => {
        const name = saveNameEl.value.trim();
        if (!name) { toast('Введите название шаблона', 'warn'); return; }
        const settings = collectStyle();
        try {
            const r = await postJSON('/api/templates', { name, settings });
            toast(r.status || 'Сохранено', 'ok');
            if (saveStatusEl) { saveStatusEl.textContent = r.status; saveStatusEl.className = 'status ok'; }
            log('Шаблон сохранён: ' + name, 'done');
            events.dispatchEvent(new CustomEvent('template-changed'));
            await loadList();
        } catch (e) {
            toast(e.message, 'err');
            if (saveStatusEl) { saveStatusEl.textContent = '❌ ' + e.message; saveStatusEl.className = 'status err'; }
        }
    });

    refreshBtnEl && refreshBtnEl.addEventListener('click', loadList);

    events.addEventListener('template-changed', loadList);

    await loadList();
}
