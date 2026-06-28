import { ICONS } from './icons.js';

const docOpenSelects = new Set();

document.addEventListener('click', (e) => {
    docOpenSelects.forEach(s => {
        if (!s.root.contains(e.target)) s.close();
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') docOpenSelects.forEach(s => s.close());
});

export class CustomSelect {
    constructor(host, opts = {}) {
        this.host = host;
        this.opts = opts;
        this.options = [];
        this.value = null;
        this._build();
    }

    _build() {
        this.root = document.createElement('div');
        this.root.className = 'cs';
        this.root.tabIndex = 0;

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'cs-trigger';
        this.trigger.innerHTML = `
            <span class="cs-value">${this.opts.placeholder || 'Выберите...'}</span>
            <span class="cs-chev">
                <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </span>
        `;
        this.valueEl = this.trigger.querySelector('.cs-value');

        this.popup = document.createElement('div');
        this.popup.className = 'cs-popup';
        this.popup.style.display = 'none';

        this.root.append(this.trigger, this.popup);
        this.host.appendChild(this.root);

        this.root.addEventListener('click', (e) => {
            e.stopPropagation();

            // Action button (e.g. preview play): only fire onAction, keep dropdown open
            if (e.target.closest('.cs-opt-action')) {
                const optEl = e.target.closest('.cs-opt');
                if (optEl && this.opts.onAction) {
                    this.opts.onAction(optEl.dataset.value);
                }
                return;
            }

            // Trigger button: toggle open/close
            if (e.target.closest('.cs-trigger')) {
                this.toggle();
                return;
            }

            // Option row: select value and close
            const optEl = e.target.closest('.cs-opt');
            if (!optEl) return;
            this.setValue(optEl.dataset.value, true);
            this.close();
        });
    }

    setOptions(options) {
        this.options = options || [];
        this._renderOptions();
        if (this.value && !this.options.find(o => o.value === this.value)) {
            this.value = null;
            this._renderValue();
        }
    }

    _renderOptions() {
        if (!this.options.length) {
            this.popup.innerHTML = '<div class="cs-empty">Нет вариантов</div>';
            return;
        }
        this.popup.innerHTML = this.options.map(o => `
            <div class="cs-opt${o.value === this.value ? ' cs-opt-active' : ''}" data-value="${escAttr(o.value)}">
                <span class="cs-opt-label">${escHtml(o.label)}</span>
                ${this.opts.onAction ? `<button type="button" class="cs-opt-action" title="${escAttr(this.opts.actionTitle || '')}">${this.opts.actionIcon || ICONS.play}</button>` : ''}
            </div>
        `).join('');
    }

    setValue(value, fire = false) {
        this.value = value;
        this._renderValue();
        this.popup.querySelectorAll('.cs-opt').forEach(el =>
            el.classList.toggle('cs-opt-active', el.dataset.value === value)
        );
        if (fire && this.opts.onChange) this.opts.onChange(value);
    }

    _renderValue() {
        if (this.value == null) {
            this.valueEl.textContent = this.opts.placeholder || 'Выберите...';
            this.valueEl.classList.add('cs-placeholder');
            return;
        }
        const opt = this.options.find(o => o.value === this.value);
        this.valueEl.textContent = opt ? opt.label : this.value;
        this.valueEl.classList.remove('cs-placeholder');
    }

    setActionState(value, isActive) {
        this.popup.querySelectorAll('.cs-opt').forEach(el => {
            const btn = el.querySelector('.cs-opt-action');
            if (!btn) return;
            const isThis = el.dataset.value === value && isActive;
            btn.classList.toggle('cs-opt-action-active', isThis);
            if (this.opts.actionActiveIcon) {
                btn.innerHTML = isThis ? this.opts.actionActiveIcon : (this.opts.actionIcon || '');
            }
        });
    }

    open() {
        this.popup.style.display = 'block';
        this.root.classList.add('cs-open');
        docOpenSelects.add(this);
    }

    close() {
        this.popup.style.display = 'none';
        this.root.classList.remove('cs-open');
        docOpenSelects.delete(this);
        if (this.opts.onClose) this.opts.onClose();
    }

    toggle() {
        if (this.popup.style.display === 'none') this.open();
        else this.close();
    }

    setDisabled(on) {
        this.trigger.disabled = !!on;
        this.root.classList.toggle('cs-disabled', !!on);
    }
}

function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escAttr(s) {
    return escHtml(s).replace(/"/g, '&quot;');
}
