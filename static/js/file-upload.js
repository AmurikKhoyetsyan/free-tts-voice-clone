import { ICONS } from './icons.js';

// Custom drag-and-drop file uploader.
//
// Usage:
//   const fu = new FileUpload(hostEl, {
//       accept: 'audio/*',
//       label: 'Перетащи аудио или нажми',
//       onChange: (file | null) => {},
//   });
//   fu.file;            // current File or null
//   fu.clear();
//   fu.setFile(file);   // programmatic

export class FileUpload {
    constructor(host, opts = {}) {
        this.host = host;
        this.opts = opts;
        this.file = null;
        this._build();
    }

    _build() {
        this.input = document.createElement('input');
        this.input.type = 'file';
        if (this.opts.accept) this.input.accept = this.opts.accept;
        this.input.style.display = 'none';

        this.root = document.createElement('div');
        this.root.className = 'fu';
        this.root.tabIndex = 0;
        this.root.innerHTML = `
            <div class="fu-empty">
                <div class="fu-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                </div>
                <div class="fu-label">${escHtml(this.opts.label || 'Перетащи файл или нажми')}</div>
                <div class="fu-hint">${escHtml(this.opts.hint || (this.opts.accept || ''))}</div>
            </div>
            <div class="fu-filled" hidden>
                <div class="fu-file-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                </div>
                <div class="fu-file-meta">
                    <div class="fu-file-name"></div>
                    <div class="fu-file-size"></div>
                </div>
                <button type="button" class="fu-clear" title="Убрать файл" aria-label="Убрать файл">${ICONS.trash}</button>
            </div>
        `;
        this.host.append(this.root, this.input);

        this.emptyEl = this.root.querySelector('.fu-empty');
        this.filledEl = this.root.querySelector('.fu-filled');
        this.nameEl = this.root.querySelector('.fu-file-name');
        this.sizeEl = this.root.querySelector('.fu-file-size');
        this.clearBtn = this.root.querySelector('.fu-clear');

        // click anywhere on root → open picker (except clear btn)
        this.root.addEventListener('click', (e) => {
            if (e.target.closest('.fu-clear')) return;
            this.input.click();
        });

        // keyboard
        this.root.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.input.click();
            }
        });

        this.input.addEventListener('change', () => {
            const f = this.input.files && this.input.files[0];
            this.setFile(f || null);
        });

        this.clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clear();
        });

        // drag-and-drop
        ['dragenter', 'dragover'].forEach(t => {
            this.root.addEventListener(t, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.root.classList.add('fu-drag');
            });
        });
        ['dragleave', 'dragend'].forEach(t => {
            this.root.addEventListener(t, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.root.classList.remove('fu-drag');
            });
        });
        this.root.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.root.classList.remove('fu-drag');
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) this.setFile(f);
        });
    }

    setFile(file) {
        this.file = file;
        if (!file) {
            this.emptyEl.hidden = false;
            this.filledEl.hidden = true;
            this.input.value = '';
        } else {
            this.emptyEl.hidden = true;
            this.filledEl.hidden = false;
            this.nameEl.textContent = file.name;
            this.sizeEl.textContent = fmtSize(file.size);
        }
        if (this.opts.onChange) this.opts.onChange(file);
    }

    clear() {
        this.setFile(null);
    }
}

function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
