/**
 * exp-modal.js — Export Settings Modal (self-contained component)
 * CSS class prefix: expm-   |   Element IDs: ive-exp-* (kept for back-compat)
 */

// ── Data ──────────────────────────────────────────────────────────────────────
const _Q_LEVELS = [
    { val: 'vlow',    label: 'Очень низкое',  crf: 35, size: '~0.5 МБ/мин',  time: 'Очень быстро',  color: '#ef4444', desc: 'Минимальное качество. Подходит только для превью или тестов.' },
    { val: 'low',     label: 'Низкое',        crf: 28, size: '~1.5 МБ/мин',  time: 'Быстро',         color: '#f97316', desc: 'Заметные артефакты. Подходит для устройств с ограниченным объёмом.' },
    { val: 'medium',  label: 'Среднее',       crf: 22, size: '~4 МБ/мин',    time: 'Быстро',         color: '#eab308', desc: 'Хороший баланс между качеством и размером файла.' },
    { val: 'high',    label: 'Высокое',       crf: 18, size: '~8 МБ/мин',    time: 'Умеренно',       color: '#22c55e', desc: 'Высокое качество для YouTube, Instagram и TikTok.' },
    { val: 'vhigh',   label: 'Очень высокое', crf: 14, size: '~15 МБ/мин',   time: 'Медленно',       color: '#06b6d4', desc: 'Рекомендуется для профессиональных проектов.' },
    { val: 'max',     label: 'Максимальное',  crf: 8,  size: '~30 МБ/мин',   time: 'Медленно',       color: '#8b5cf6', desc: 'Почти без потерь. Для архивного хранения.' },
    { val: 'lossless',label: 'Без потерь',    crf: 0,  size: '~100+ МБ/мин', time: 'Очень медленно', color: '#ec4899', desc: 'Полное отсутствие потерь. Огромный размер файла.' },
];

const _RES_PRESETS = [
    { label: '360p',      w: 640,  h: 360,  ar: '16:9', hint: 'Мобильные, медленный интернет' },
    { label: '480p SD',   w: 854,  h: 480,  ar: '16:9', hint: 'Стандартное качество DVD' },
    { label: '720p HD',   w: 1280, h: 720,  ar: '16:9', hint: 'Хороший баланс для YouTube' },
    { label: '1080p FHD', w: 1920, h: 1080, ar: '16:9', hint: 'Идеально для большинства платформ' },
    { label: '1440p 2K',  w: 2560, h: 1440, ar: '16:9', hint: 'Высокое разрешение' },
    { label: '2160p 4K',  w: 3840, h: 2160, ar: '16:9', hint: 'Максимум детализации' },
    { label: '4320p 8K',  w: 7680, h: 4320, ar: '16:9', hint: 'Спецоборудование' },
];

const _SOCIAL_GROUPS = [
    { name: 'YouTube',           items: [{ label: '1080p', w: 1920, h: 1080 }, { label: '1440p', w: 2560, h: 1440 }, { label: '4K', w: 3840, h: 2160 }] },
    { name: 'YouTube Shorts',    items: [{ label: '1080×1920', w: 1080, h: 1920 }] },
    { name: 'TikTok',            items: [{ label: '1080×1920', w: 1080, h: 1920 }] },
    { name: 'Instagram Reels',   items: [{ label: '1080×1920', w: 1080, h: 1920 }] },
    { name: 'Instagram Feed',    items: [{ label: '1:1', w: 1080, h: 1080 }, { label: '4:5', w: 1080, h: 1350 }] },
    { name: 'Instagram Stories', items: [{ label: '9:16', w: 1080, h: 1920 }] },
    { name: 'Facebook',          items: [{ label: '1:1', w: 1080, h: 1080 }, { label: '16:9', w: 1920, h: 1080 }] },
    { name: 'Telegram',          items: [{ label: '720p', w: 1280, h: 720 }, { label: '1080p', w: 1920, h: 1080 }] },
    { name: 'X (Twitter)',       items: [{ label: '720p', w: 1280, h: 720 }, { label: '1080p', w: 1920, h: 1080 }] },
    { name: 'Square (1:1)',      items: [{ label: '720×720', w: 720, h: 720 }, { label: '1080×1080', w: 1080, h: 1080 }] },
    { name: 'Vertical (9:16)',   items: [{ label: '720×1280', w: 720, h: 1280 }, { label: '1080×1920', w: 1080, h: 1920 }] },
    { name: 'Cinema (21:9)',     items: [{ label: '2560×1080', w: 2560, h: 1080 }, { label: '3440×1440', w: 3440, h: 1440 }] },
];

const _CODECS = [
    { val: '',       label: 'Авто',   hint: 'Оптимальный кодек выбирается автоматически' },
    { val: 'h264',   label: 'H.264',  hint: 'Универсальный стандарт. Поддерживается всеми устройствами. Рекомендуется.' },
    { val: 'h265',   label: 'H.265',  hint: 'В 2× эффективнее H.264, медленнее. Не на всех старых устройствах.' },
    { val: 'vp9',    label: 'VP9',    hint: 'Открытый кодек Google. Отлично для WebM и YouTube.' },
    { val: 'av1',    label: 'AV1',    hint: 'Современный, высокая эффективность. Очень медленное кодирование.' },
    { val: 'vp8',    label: 'VP8',    hint: 'Старый кодек Google. Лучше используйте VP9.' },
    { val: 'prores', label: 'ProRes', hint: 'Профессиональный кодек Apple. Большой файл, для постпродакшна.' },
    { val: 'mpeg4',  label: 'MPEG-4', hint: 'Широкая совместимость со старыми устройствами.' },
];

const _FPS_OPTIONS = [
    { val: '24', label: '24', sub: 'Кино' },
    { val: '25', label: '25', sub: 'PAL' },
    { val: '30', label: '30', sub: 'Стандарт' },
    { val: '60', label: '60', sub: 'Плавный' },
];

const _FORMATS = [
    { val: 'mp4',        label: 'MP4',   desc: 'Универсальный', badge: '★' },
    { val: 'mov',        label: 'MOV',   desc: 'Apple · QuickTime' },
    { val: 'mkv',        label: 'MKV',   desc: 'Открытый' },
    { val: 'webm',       label: 'WebM',  desc: 'VP9 · Веб' },
    { val: 'avi',        label: 'AVI',   desc: 'Классика' },
    { val: 'gif',        label: 'GIF',   desc: 'Анимация' },
    { val: 'audio:mp3',  label: 'MP3',   desc: 'Аудио',        isAudio: true },
    { val: 'audio:wav',  label: 'WAV',   desc: 'Без потерь',   isAudio: true },
    { val: 'audio:flac', label: 'FLAC',  desc: 'Без потерь',   isAudio: true },
    { val: 'audio:aac',  label: 'AAC',   desc: 'Качество',     isAudio: true },
    { val: 'audio:ogg',  label: 'OGG',   desc: 'Открытый',     isAudio: true },
    { val: 'audio:opus', label: 'OPUS',  desc: 'Современный',  isAudio: true },
];

const _QUALITY_PRESETS = [
    { key: 'speed',    icon: '⚡', label: 'Максимальная скорость',  desc: 'Минимальное время, сниженное качество', quality: 'vlow',   codec: 'h264', fps: '30', audioBitrate: '128k' },
    { key: 'balanced', icon: '⚖', label: 'Оптимальное',            desc: 'Лучший баланс качества и скорости',    quality: 'medium', codec: '',     fps: '30', audioBitrate: '192k' },
    { key: 'quality',  icon: '🎬', label: 'Максимальное качество',  desc: 'Высокое качество, большой файл',       quality: 'vhigh',  codec: 'h264', fps: '30', audioBitrate: '320k' },
    { key: 'small',    icon: '📦', label: 'Минимальный размер',     desc: 'Малый размер, сниженное качество',     quality: 'low',    codec: 'h264', fps: '24', audioBitrate: '128k' },
    { key: 'social',   icon: '📱', label: 'Для социальных сетей',   desc: 'YouTube, TikTok, Instagram',           quality: 'high',   codec: 'h264', fps: '30', audioBitrate: '192k' },
];

// ── HTML builder ──────────────────────────────────────────────────────────────
function _buildHTML() {
    const qLabels = _Q_LEVELS.map(q =>
        `<span class="expm-q-lbl" style="color:${q.color}">${q.label}</span>`
    ).join('');

    const resGrid = _RES_PRESETS.map(p =>
        `<div class="expm-res-card" data-w="${p.w}" data-h="${p.h}">
            <div class="expm-res-label">${p.label}</div>
            <div class="expm-res-sub">${p.w}×${p.h} · ${p.ar}</div>
            <div class="expm-res-hint">${p.hint}</div>
        </div>`
    ).join('');

    const social = _SOCIAL_GROUPS.map(g =>
        `<div class="expm-social-group">
            <div class="expm-social-plat">${g.name}</div>
            <div class="expm-social-items">${g.items.map(it =>
                `<button class="expm-social-btn" data-w="${it.w}" data-h="${it.h}">${it.label}</button>`
            ).join('')}</div>
        </div>`
    ).join('');

    const codecGrid = _CODECS.map(c =>
        `<button class="expm-codec-btn" data-codec="${c.val}">${c.label}</button>`
    ).join('');

    const fpsRow = _FPS_OPTIONS.map(f =>
        `<button class="expm-fps-btn" data-fps="${f.val}">
            <span class="expm-fps-num">${f.label}</span>
            <span class="expm-fps-sub">${f.sub}</span>
        </button>`
    ).join('');

    const fmtGrid = _FORMATS.map(f =>
        `<button class="expm-fmt-btn${f.isAudio ? ' is-audio' : ''}" data-fmt="${f.val}">
            <div class="expm-fmt-name">${f.label}</div>
            <div class="expm-fmt-desc">${f.desc}</div>
            ${f.badge ? `<div class="expm-fmt-badge">${f.badge}</div>` : ''}
            ${f.isAudio ? '<div class="expm-fmt-audio-tag">Аудио</div>' : ''}
        </button>`
    ).join('');

    const presets = _QUALITY_PRESETS.map(p =>
        `<button class="expm-preset-btn" data-preset="${p.key}">
            <span class="expm-preset-icon">${p.icon}</span>
            <div class="expm-preset-body">
                <div class="expm-preset-name">${p.label}</div>
                <div class="expm-preset-desc">${p.desc}</div>
            </div>
        </button>`
    ).join('');

    return `
<div id="ive-exp-modal" class="expm-overlay" hidden>
  <div class="expm-box">
    <div class="expm-hdr">
      <span class="expm-title">⚙ Настройки экспорта</span>
      <button id="ive-exp-modal-close" class="expm-close">✕</button>
    </div>
    <div class="expm-layout">
      <nav class="expm-nav">
        <button class="expm-tab active" data-exptab="quality">Качество</button>
        <button class="expm-tab" data-exptab="resolution">Разрешение</button>
        <button class="expm-tab" data-exptab="video">Видео</button>
        <button class="expm-tab" data-exptab="audio">Аудио</button>
        <button class="expm-tab" data-exptab="format">Формат</button>
      </nav>
      <div class="expm-content">

        <!-- Quality pane -->
        <div class="expm-pane active" data-exppane="quality">
          <div class="expm-section">
            <div class="expm-sh">Качество видео</div>
            <div class="expm-q-track">
              <input type="range" id="ive-exp-q-slider" class="expm-q-slider"
                     min="0" max="6" step="1" value="2">
              <div class="expm-q-labels">${qLabels}</div>
            </div>
            <div class="expm-q-card" id="ive-exp-q-card">
              <div class="expm-q-card-top">
                <span class="expm-q-badge" id="ive-exp-q-badge">Среднее</span>
                <span class="expm-q-meta" id="ive-exp-q-meta">CRF 22 · ~4 МБ/мин · Быстро</span>
              </div>
              <div class="expm-q-desc" id="ive-exp-q-desc">Хороший баланс между качеством и размером файла.</div>
            </div>
          </div>
          <div class="expm-section">
            <div class="expm-sh">Готовые пресеты</div>
            <div class="expm-preset-list" id="ive-exp-preset-list">${presets}</div>
          </div>
        </div>

        <!-- Resolution pane -->
        <div class="expm-pane" data-exppane="resolution">
          <div class="expm-section">
            <div class="expm-sh">Стандартные разрешения</div>
            <div class="expm-res-grid" id="ive-exp-res-grid">${resGrid}</div>
          </div>
          <div class="expm-section">
            <div class="expm-sh">Социальные сети</div>
            <div class="expm-social" id="ive-exp-social">${social}</div>
          </div>
          <div class="expm-section">
            <div class="expm-sh">Своё разрешение</div>
            <div class="expm-custom-res">
              <label class="expm-lbl">Ширина
                <input type="number" id="ive-exp-res-w" class="ive-input"
                       min="1" max="15360" value="1920" style="width:80px">
              </label>
              <span class="expm-res-sep">×</span>
              <label class="expm-lbl">Высота
                <input type="number" id="ive-exp-res-h" class="ive-input"
                       min="1" max="15360" value="1080" style="width:80px">
              </label>
              <button class="btn btn-sm" id="ive-exp-res-apply">Применить</button>
            </div>
            <div class="expm-res-cur" id="ive-exp-res-cur">Текущее: 1920 × 1080 (16:9)</div>
          </div>
        </div>

        <!-- Video pane -->
        <div class="expm-pane" data-exppane="video">
          <div class="expm-section">
            <div class="expm-sh">Видеокодек</div>
            <div class="expm-codec-grid" id="ive-exp-codec-grid">${codecGrid}</div>
            <div class="expm-codec-hint" id="ive-exp-codec-hint"></div>
          </div>
          <div class="expm-section">
            <div class="expm-sh">Частота кадров</div>
            <div class="expm-fps-row" id="ive-exp-fps-row">${fpsRow}</div>
          </div>
        </div>

        <!-- Audio pane -->
        <div class="expm-pane" data-exppane="audio">
          <div class="expm-section">
            <div class="expm-sh">Настройки аудио</div>
            <div class="expm-audio-grid">
              <div class="expm-field">
                <span class="expm-field-lbl">Аудио кодек</span>
                <select class="ive-select" id="ive-exp-audio-codec">
                  <option value="aac" selected>AAC (рекомендуется)</option>
                  <option value="mp3">MP3</option>
                  <option value="opus">Opus</option>
                  <option value="vorbis">Vorbis (OGG)</option>
                  <option value="pcm">PCM (без потерь)</option>
                </select>
              </div>
              <div class="expm-field">
                <span class="expm-field-lbl">Битрейт</span>
                <select class="ive-select" id="ive-exp-audio-bitrate">
                  <option value="96k">96 kbps</option>
                  <option value="128k">128 kbps</option>
                  <option value="192k" selected>192 kbps (стандарт)</option>
                  <option value="256k">256 kbps</option>
                  <option value="320k">320 kbps (макс.)</option>
                </select>
              </div>
              <div class="expm-field">
                <span class="expm-field-lbl">Частота дискретизации</span>
                <select class="ive-select" id="ive-exp-audio-sr">
                  <option value="44100" selected>44 100 Гц (CD)</option>
                  <option value="48000">48 000 Гц (Видео)</option>
                </select>
              </div>
              <div class="expm-field">
                <span class="expm-field-lbl">Каналы</span>
                <select class="ive-select" id="ive-exp-audio-ch">
                  <option value="2" selected>Стерео (2.0)</option>
                  <option value="1">Моно (1.0)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Format pane -->
        <div class="expm-pane" data-exppane="format">
          <div class="expm-section">
            <div class="expm-sh">Формат контейнера</div>
            <div class="expm-fmt-grid" id="ive-exp-fmt-grid">${fmtGrid}</div>
          </div>
        </div>

      </div><!-- /.expm-content -->
    </div><!-- /.expm-layout -->

    <div class="expm-footer">
      <div id="ive-exp-footer-sum" class="expm-footer-sum"></div>
      <!-- Hidden selects keep original IDs for back-compat -->
      <select id="ive-exp-format" style="display:none">
        <optgroup label="Видео">
          <option value="mp4" selected>MP4</option><option value="mov">MOV</option>
          <option value="mkv">MKV</option><option value="m4v">M4V</option>
          <option value="avi">AVI</option><option value="webm">WebM</option>
          <option value="ogv">OGV</option><option value="flv">FLV</option>
          <option value="wmv">WMV</option><option value="mpeg">MPEG</option>
          <option value="gif">GIF</option>
        </optgroup>
        <optgroup label="Только аудио">
          <option value="audio:mp3">MP3</option><option value="audio:wav">WAV</option>
          <option value="audio:flac">FLAC</option><option value="audio:aac">AAC</option>
          <option value="audio:ogg">OGG</option><option value="audio:m4a">M4A</option>
          <option value="audio:opus">OPUS</option>
        </optgroup>
      </select>
      <select id="ive-exp-quality" style="display:none">
        <option value="vlow">Очень низкое</option>
        <option value="low">Низкое</option>
        <option value="medium" selected>Среднее</option>
        <option value="high">Высокое</option>
        <option value="vhigh">Очень высокое</option>
        <option value="max">Максимальное</option>
        <option value="lossless">Без потерь</option>
      </select>
      <select id="ive-exp-codec" style="display:none">
        <option value="" selected>Авто</option><option value="h264">H.264</option>
        <option value="h265">H.265</option><option value="vp9">VP9</option>
        <option value="vp8">VP8</option><option value="av1">AV1</option>
        <option value="prores">ProRes</option><option value="mpeg4">MPEG-4</option>
      </select>
      <select id="ive-exp-fps" style="display:none">
        <option value="24">24</option><option value="25">25</option>
        <option value="30" selected>30</option><option value="60">60</option>
      </select>
      <button class="btn" id="ive-exp-modal-cancel">Отмена</button>
      <button class="btn accent" id="ive-exp-modal-ok">✓ Применить</button>
    </div>
  </div>
</div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _gcd(a, b) { return b === 0 ? a : _gcd(b, a % b); }
function _aspectRatio(w, h) {
    if (!w || !h) return '';
    const g = _gcd(w, h);
    const ar = `${w/g}:${h/g}`;
    const known = { '16:9':'16:9','9:16':'9:16','4:3':'4:3','3:4':'3:4',
                    '1:1':'1:1','4:5':'4:5','5:4':'5:4','21:9':'21:9','2:1':'2:1' };
    return known[ar] || ar;
}

// ── Factory ───────────────────────────────────────────────────────────────────
/**
 * createExpModal({ summaryEl, onResolutionChange })
 *
 * Injects the modal HTML into document.body, wires all events, and returns
 * an API object with: open(), close(), getResolution(), getSettings(),
 * applySettings(s), updateSummary().
 */
export function createExpModal({ summaryEl, onResolutionChange } = {}) {
    // Inject HTML
    const tmp = document.createElement('div');
    tmp.innerHTML = _buildHTML();
    const modal = tmp.firstElementChild;
    document.body.appendChild(modal);

    // Shorthand
    const $ = id => document.getElementById(id);

    // ── Internal sync helpers ───────────────────────────────────────────────
    function _updateQCard(idx) {
        const info = _Q_LEVELS[idx] || _Q_LEVELS[2];
        const badge = $('ive-exp-q-badge');
        if (badge) { badge.textContent = info.label; badge.style.background = info.color; }
        const meta = $('ive-exp-q-meta');
        if (meta) meta.textContent = `CRF ${info.crf} · ${info.size} · ${info.time}`;
        const desc = $('ive-exp-q-desc');
        if (desc) desc.textContent = info.desc;
        const card = $('ive-exp-q-card');
        if (card) card.style.borderLeftColor = info.color;
        const qualEl = $('ive-exp-quality');
        if (qualEl) qualEl.value = info.val;
        // Update slider thumb color via CSS custom property
        const slider = $('ive-exp-q-slider');
        if (slider) slider.style.setProperty('--expm-thumb-color', info.color);
    }

    function _syncQSlider() {
        const qualEl = $('ive-exp-quality');
        const slider = $('ive-exp-q-slider');
        if (!qualEl || !slider) return;
        const idx = _Q_LEVELS.findIndex(q => q.val === qualEl.value);
        const resolved = idx >= 0 ? idx : 2;
        slider.value = resolved;
        _updateQCard(resolved);
    }

    function _syncResCards() {
        const w = parseInt($('ive-exp-res-w')?.value) || 1920;
        const h = parseInt($('ive-exp-res-h')?.value) || 1080;
        modal.querySelectorAll('.expm-res-card').forEach(card => {
            card.classList.toggle('active', +card.dataset.w === w && +card.dataset.h === h);
        });
        modal.querySelectorAll('.expm-social-btn').forEach(btn => {
            btn.classList.toggle('active', +btn.dataset.w === w && +btn.dataset.h === h);
        });
    }

    function _syncCodecCards() {
        const val = $('ive-exp-codec')?.value ?? '';
        modal.querySelectorAll('.expm-codec-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.codec === val);
        });
        const info = _CODECS.find(c => c.val === val);
        const hint = $('ive-exp-codec-hint');
        if (hint) hint.textContent = info?.hint || '';
    }

    function _syncFpsCards() {
        const val = $('ive-exp-fps')?.value || '30';
        modal.querySelectorAll('.expm-fps-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fps === val);
        });
    }

    function _syncFmtCards() {
        const val = $('ive-exp-format')?.value || 'mp4';
        modal.querySelectorAll('.expm-fmt-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fmt === val);
        });
    }

    function _updateResCur() {
        const w = parseInt($('ive-exp-res-w')?.value) || 1920;
        const h = parseInt($('ive-exp-res-h')?.value) || 1080;
        const el = $('ive-exp-res-cur');
        if (el) el.textContent = `Текущее: ${w} × ${h} (${_aspectRatio(w, h)})`;
        _syncResCards();
        _updateSummary();
    }

    function _updateSummary() {
        const fmt    = $('ive-exp-format')?.value || 'mp4';
        const fmtLbl = fmt.startsWith('audio:') ? fmt.slice(6).toUpperCase() : fmt.toUpperCase();
        const w      = parseInt($('ive-exp-res-w')?.value) || 1920;
        const h      = parseInt($('ive-exp-res-h')?.value) || 1080;
        const fps    = $('ive-exp-fps')?.value || '30';
        const qVal   = $('ive-exp-quality')?.value || 'medium';
        const qInfo  = _Q_LEVELS.find(q => q.val === qVal) || _Q_LEVELS[2];
        const text   = fmt.startsWith('audio:')
            ? `${fmtLbl} · ${$('ive-exp-audio-bitrate')?.value || '192k'}`
            : `${fmtLbl} · ${w}×${h} · ${fps}fps · ${qInfo.label}`;
        if (summaryEl) summaryEl.textContent = text;
        const footEl = $('ive-exp-footer-sum');
        if (footEl) footEl.textContent = text;
    }

    function _setResolution(w, h) {
        const rw = $('ive-exp-res-w'); if (rw) rw.value = w;
        const rh = $('ive-exp-res-h'); if (rh) rh.value = h;
        _updateResCur();
        if (onResolutionChange) onResolutionChange();
    }

    function _syncAll() {
        _syncQSlider(); _syncResCards(); _syncCodecCards(); _syncFpsCards(); _syncFmtCards();
        _updateResCur(); _updateSummary();
    }

    // ── Tab switching ───────────────────────────────────────────────────────
    modal.querySelectorAll('.expm-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.expm-tab').forEach(t => t.classList.remove('active'));
            modal.querySelectorAll('.expm-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const pane = modal.querySelector(`[data-exppane="${tab.dataset.exptab}"]`);
            if (pane) pane.classList.add('active');
        });
    });

    // ── Quality slider ──────────────────────────────────────────────────────
    $('ive-exp-q-slider')?.addEventListener('input', e => {
        _updateQCard(+e.target.value);
        _updateSummary();
    });

    // ── Resolution grid ─────────────────────────────────────────────────────
    $('ive-exp-res-grid')?.addEventListener('click', e => {
        const card = e.target.closest('.expm-res-card');
        if (!card) return;
        _setResolution(+card.dataset.w, +card.dataset.h);
    });

    // ── Social presets ──────────────────────────────────────────────────────
    $('ive-exp-social')?.addEventListener('click', e => {
        const btn = e.target.closest('.expm-social-btn');
        if (!btn) return;
        _setResolution(+btn.dataset.w, +btn.dataset.h);
    });

    // ── Custom resolution apply ─────────────────────────────────────────────
    $('ive-exp-res-apply')?.addEventListener('click', () => {
        const w = parseInt($('ive-exp-res-w')?.value) || 1920;
        const h = parseInt($('ive-exp-res-h')?.value) || 1080;
        _setResolution(w, h);
    });

    // ── Res w/h inputs direct change ────────────────────────────────────────
    $('ive-exp-res-w')?.addEventListener('change', () => { _updateResCur(); if (onResolutionChange) onResolutionChange(); });
    $('ive-exp-res-h')?.addEventListener('change', () => { _updateResCur(); if (onResolutionChange) onResolutionChange(); });

    // ── Codec cards ─────────────────────────────────────────────────────────
    $('ive-exp-codec-grid')?.addEventListener('click', e => {
        const btn = e.target.closest('.expm-codec-btn');
        if (!btn) return;
        const codecEl = $('ive-exp-codec');
        if (codecEl) codecEl.value = btn.dataset.codec;
        _syncCodecCards();
        _updateSummary();
    });

    // ── FPS tiles ───────────────────────────────────────────────────────────
    $('ive-exp-fps-row')?.addEventListener('click', e => {
        const btn = e.target.closest('.expm-fps-btn');
        if (!btn) return;
        const fpsEl = $('ive-exp-fps');
        if (fpsEl) fpsEl.value = btn.dataset.fps;
        _syncFpsCards();
        _updateSummary();
    });

    // ── Format grid ─────────────────────────────────────────────────────────
    $('ive-exp-fmt-grid')?.addEventListener('click', e => {
        const btn = e.target.closest('.expm-fmt-btn');
        if (!btn) return;
        const fmtEl = $('ive-exp-format');
        if (fmtEl) fmtEl.value = btn.dataset.fmt;
        _syncFmtCards();
        _updateSummary();
    });

    // ── Presets ─────────────────────────────────────────────────────────────
    $('ive-exp-preset-list')?.addEventListener('click', e => {
        const btn = e.target.closest('.expm-preset-btn');
        if (!btn) return;
        const preset = _QUALITY_PRESETS.find(p => p.key === btn.dataset.preset);
        if (!preset) return;
        const qIdx = _Q_LEVELS.findIndex(q => q.val === preset.quality);
        if (qIdx >= 0) { const sl = $('ive-exp-q-slider'); if (sl) sl.value = qIdx; _updateQCard(qIdx); }
        const codecEl = $('ive-exp-codec'); if (codecEl) codecEl.value = preset.codec;
        const fpsEl   = $('ive-exp-fps');   if (fpsEl)   fpsEl.value   = preset.fps;
        const abEl    = $('ive-exp-audio-bitrate'); if (abEl) abEl.value = preset.audioBitrate;
        _syncCodecCards(); _syncFpsCards(); _updateSummary();
    });

    // ── Audio bitrate → summary ─────────────────────────────────────────────
    $('ive-exp-audio-bitrate')?.addEventListener('change', _updateSummary);

    // ── Close buttons ───────────────────────────────────────────────────────
    const _hide = () => { modal.hidden = true; };
    $('ive-exp-modal-close')?.addEventListener('click', _hide);
    $('ive-exp-modal-cancel')?.addEventListener('click', _hide);
    $('ive-exp-modal-ok')?.addEventListener('click', () => {
        if (onResolutionChange) onResolutionChange();
        modal.hidden = true;
        _updateSummary();
    });
    modal.addEventListener('click', e => { if (e.target === modal) _hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) _hide(); });

    // Initial sync
    _syncAll();

    // ── Public API ───────────────────────────────────────────────────────────
    return {
        open() {
            _syncAll();
            modal.hidden = false;
        },

        close() {
            modal.hidden = true;
        },

        getResolution() {
            const w = parseInt($('ive-exp-res-w')?.value) || 1920;
            const h = parseInt($('ive-exp-res-h')?.value) || 1080;
            return { w, h };
        },

        getSettings() {
            const { w, h } = this.getResolution();
            return {
                format:       $('ive-exp-format')?.value        || 'mp4',
                codec:        $('ive-exp-codec')?.value         || '',
                resolution:   `${w}x${h}`,
                fps:          $('ive-exp-fps')?.value           || '30',
                quality:      $('ive-exp-quality')?.value       || 'medium',
                audioCodec:   $('ive-exp-audio-codec')?.value  || 'aac',
                audioBitrate: $('ive-exp-audio-bitrate')?.value || '192k',
                audioSR:      $('ive-exp-audio-sr')?.value      || '44100',
                audioCh:      $('ive-exp-audio-ch')?.value      || '2',
            };
        },

        applySettings(s) {
            if (!s) return;
            const fmtEl   = $('ive-exp-format');
            const codecEl = $('ive-exp-codec');
            const fpsEl   = $('ive-exp-fps');
            const qualEl  = $('ive-exp-quality');
            if (s.format  && fmtEl)                  fmtEl.value   = s.format;
            if (s.codec   !== undefined && codecEl)   codecEl.value = s.codec || '';
            if (s.fps     && fpsEl)                   fpsEl.value   = String(s.fps);
            if (s.quality && qualEl)                  qualEl.value  = s.quality;
            if (s.resolution) {
                const [w, h] = s.resolution.split('x').map(Number);
                const rw = $('ive-exp-res-w'); if (rw && w) rw.value = w;
                const rh = $('ive-exp-res-h'); if (rh && h) rh.value = h;
                if (onResolutionChange) onResolutionChange();
            }
            if (s.audioCodec   && $('ive-exp-audio-codec'))   $('ive-exp-audio-codec').value   = s.audioCodec;
            if (s.audioBitrate && $('ive-exp-audio-bitrate')) $('ive-exp-audio-bitrate').value = s.audioBitrate;
            if (s.audioSR      && $('ive-exp-audio-sr'))      $('ive-exp-audio-sr').value      = s.audioSR;
            if (s.audioCh      && $('ive-exp-audio-ch'))      $('ive-exp-audio-ch').value      = s.audioCh;
            _syncAll();
        },

        updateSummary() {
            _updateSummary();
        },
    };
}
