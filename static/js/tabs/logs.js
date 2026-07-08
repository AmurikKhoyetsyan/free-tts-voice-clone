import { getJSON } from '../api.js';
import { toast } from '../toast.js';
import { openConfirm, openPrompt } from '../modal.js';
import { ICONS } from '../icons.js';

export async function init() {
    const listEl      = document.getElementById('logs-list');
    const contentEl   = document.getElementById('logs-content');
    const editorEl    = document.getElementById('logs-editor');
    const emptyEl     = document.getElementById('logs-empty');
    const toolbarEl   = document.getElementById('logs-file-toolbar');
    const fileNameEl  = document.getElementById('logs-file-name');
    const editBtn     = document.getElementById('logs-edit-btn');
    const saveBtn     = document.getElementById('logs-save-btn');
    const renameBtn   = document.getElementById('logs-rename-btn');
    const deleteBtn   = document.getElementById('logs-delete-btn');
    const refreshBtn  = document.getElementById('logs-refresh');

    let currentFile = null;
    let isEditing   = false;

    // ── Helpers ───────────────────────────────────────────────────────────────

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function setEditing(on) {
        isEditing = on;
        contentEl.hidden = on;
        editorEl.hidden  = !on;
        editBtn.hidden   = on;
        saveBtn.hidden   = !on;
    }

    // ── Load file list ────────────────────────────────────────────────────────

    async function loadList() {
        listEl.innerHTML = '<div class="hist-empty">Загрузка…</div>';
        toolbarEl.hidden = true;
        contentEl.hidden = true;
        editorEl.hidden  = true;
        emptyEl.hidden   = false;
        currentFile      = null;
        try {
            const data = await getJSON('/api/logs');
            if (!data.files.length) {
                listEl.innerHTML = '<div class="hist-empty">Нет лог-файлов</div>';
                return;
            }
            listEl.innerHTML = data.files.map(f => `
                <div class="hist-row logs-row" data-file="${f.name}">
                    <div style="overflow:hidden">
                        <div class="hist-name" title="${f.name}">${f.name.replace('.log', '')}</div>
                        <div style="font-size:10px;color:var(--text-dim)">${formatSize(f.size)} · ${f.modified}</div>
                    </div>
                </div>
            `).join('');
            openFile(data.files[0].name);
        } catch (e) {
            listEl.innerHTML = '<div class="hist-empty">Ошибка загрузки</div>';
            toast(e.message, 'err');
        }
    }

    // ── Open file ─────────────────────────────────────────────────────────────

    async function openFile(filename) {
        setEditing(false);
        currentFile = filename;
        listEl.querySelectorAll('.logs-row').forEach(r =>
            r.classList.toggle('active', r.dataset.file === filename));
        toolbarEl.hidden = false;
        fileNameEl.textContent = filename;
        emptyEl.hidden   = true;
        contentEl.hidden = false;
        contentEl.textContent = 'Загрузка…';
        try {
            const data = await getJSON(`/api/logs/${encodeURIComponent(filename)}`);
            contentEl.textContent = data.content.trim() || '(файл пуст)';
            editorEl.value = data.content;
        } catch (e) {
            contentEl.textContent = 'Ошибка: ' + e.message;
        }
    }

    // ── Events ────────────────────────────────────────────────────────────────

    listEl.addEventListener('click', e => {
        const row = e.target.closest('.logs-row');
        if (row) openFile(row.dataset.file);
    });

    editBtn.addEventListener('click', () => {
        if (!currentFile) return;
        setEditing(true);
        editorEl.focus();
    });

    saveBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        try {
            const r = await fetch(`/api/logs/${encodeURIComponent(currentFile)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: editorEl.value }),
            });
            if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
            contentEl.textContent = editorEl.value.trim() || '(файл пуст)';
            setEditing(false);
            toast('Сохранено', 'ok');
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    renameBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        const stem = currentFile.replace('.log', '');
        const newStem = await openPrompt({ title: 'Переименовать лог', initial: stem, placeholder: 'YYYY-MM-DD' });
        if (!newStem) return;
        try {
            const r = await fetch(`/api/logs/${encodeURIComponent(currentFile)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_name: newStem }),
            });
            if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
            const data = await r.json();
            toast(data.status, 'ok');
            await loadList();
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    deleteBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        const ok = await openConfirm({
            title: 'Удалить лог',
            message: `Удалить файл «${currentFile}»?`,
            confirmLabel: 'Удалить',
        });
        if (!ok) return;
        try {
            const r = await fetch(`/api/logs/${encodeURIComponent(currentFile)}`, { method: 'DELETE' });
            if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
            toast('Удалено', 'ok');
            await loadList();
        } catch (e) {
            toast(e.message, 'err');
        }
    });

    refreshBtn.addEventListener('click', loadList);

    await loadList();
}
