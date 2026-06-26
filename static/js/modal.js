// Simple promise-based modals.

export function openConfirm({ title, message, confirmLabel = 'Удалить', danger = true }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-delete');
        const textEl = document.getElementById('modal-delete-text');
        const confirmBtn = document.getElementById('modal-delete-confirm');
        const h3 = modal.querySelector('h3');

        h3.textContent = title;
        textEl.textContent = message;
        confirmBtn.textContent = confirmLabel;
        confirmBtn.classList.toggle('btn-danger', danger);
        confirmBtn.classList.toggle('btn-primary', !danger);

        const close = (val) => {
            modal.hidden = true;
            confirmBtn.removeEventListener('click', onYes);
            modal.querySelectorAll('[data-modal-close]').forEach(b => b.removeEventListener('click', onNo));
            modal.removeEventListener('click', onBg);
            document.removeEventListener('keydown', onEsc);
            resolve(val);
        };
        const onYes = () => close(true);
        const onNo = () => close(false);
        const onBg = (e) => { if (e.target === modal) close(false); };
        const onEsc = (e) => { if (e.key === 'Escape') close(false); };

        confirmBtn.addEventListener('click', onYes);
        modal.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', onNo));
        modal.addEventListener('click', onBg);
        document.addEventListener('keydown', onEsc);

        modal.hidden = false;
    });
}

export function openPrompt({ title, initial = '', confirmLabel = 'Сохранить' }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-rename');
        const input = document.getElementById('modal-rename-input');
        const confirmBtn = document.getElementById('modal-rename-confirm');
        const h3 = modal.querySelector('h3');

        h3.textContent = title;
        input.value = initial;
        confirmBtn.textContent = confirmLabel;

        const close = (val) => {
            modal.hidden = true;
            confirmBtn.removeEventListener('click', onYes);
            modal.querySelectorAll('[data-modal-close]').forEach(b => b.removeEventListener('click', onNo));
            modal.removeEventListener('click', onBg);
            document.removeEventListener('keydown', onKey);
            resolve(val);
        };
        const onYes = () => close(input.value.trim() || null);
        const onNo = () => close(null);
        const onBg = (e) => { if (e.target === modal) close(null); };
        const onKey = (e) => {
            if (e.key === 'Escape') close(null);
            if (e.key === 'Enter' && document.activeElement === input) onYes();
        };

        confirmBtn.addEventListener('click', onYes);
        modal.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', onNo));
        modal.addEventListener('click', onBg);
        document.addEventListener('keydown', onKey);

        modal.hidden = false;
        setTimeout(() => { input.focus(); input.select(); }, 50);
    });
}
