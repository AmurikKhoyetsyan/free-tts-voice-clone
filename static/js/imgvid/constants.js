// Extracted from image-video.js — do not edit logic
export const TRANSITIONS = [
    { value: 'none', label: 'Нет' }, { value: 'fade', label: 'Fade' },
    { value: 'crossfade', label: 'Cross Fade' }, { value: 'dissolve', label: 'Dissolve' },
    { value: 'fadeblack', label: 'Fade Black' }, { value: 'fadewhite', label: 'Fade White' },
    { value: 'slideleft', label: 'Slide Left' }, { value: 'slideright', label: 'Slide Right' },
    { value: 'slideup', label: 'Slide Up' }, { value: 'slidedown', label: 'Slide Down' },
    { value: 'wipeleft', label: 'Wipe Left' }, { value: 'wiperight', label: 'Wipe Right' },
    { value: 'wipeup', label: 'Wipe Up' }, { value: 'wipedown', label: 'Wipe Down' },
    { value: 'zoomin', label: 'Zoom In' }, { value: 'pixelize', label: 'Pixelize' },
    { value: 'hblur', label: 'Blur' }, { value: 'circlecrop', label: 'Circle' },
    { value: 'radial', label: 'Radial' }, { value: 'fadegrays', label: 'Fade Grays' },
    { value: 'hlslice', label: 'H Slice' }, { value: 'vuslice', label: 'V Slice' },
];

// Color/filter effects applied per-clip (brightness, blur, etc.)
export const EFFECTS_DEF = [
    // Basic adjustments
    { key: 'brightness', label: 'Яркость',    min: -100, max: 100, step: 1,   def: 0, category: 'basic' },
    { key: 'contrast',   label: 'Контраст',   min: -100, max: 100, step: 1,   def: 0, category: 'basic' },
    { key: 'saturation', label: 'Насыщение',  min: -100, max: 100, step: 1,   def: 0, category: 'basic' },
    { key: 'exposure',   label: 'Экспозиция', min: -100, max: 100, step: 1,   def: 0, category: 'basic' },
    { key: 'gamma',      label: 'Гамма',      min: -50,  max: 50,  step: 1,   def: 0, category: 'basic' },
    { key: 'temperature',label: 'Темп-ра',    min: -100, max: 100, step: 1,   def: 0, category: 'basic' },
    // Detail
    { key: 'blur',       label: 'Размытие',   min: 0,    max: 20,  step: 0.5, def: 0, category: 'detail' },
    { key: 'sharpen',    label: 'Резкость',   min: 0,    max: 50,  step: 1,   def: 0, category: 'detail' },
    // Style
    { key: 'filmgrain',  label: 'Зернист.',   min: 0,    max: 50,  step: 1,   def: 0, category: 'style' },
    { key: 'noise',      label: 'Шум',        min: 0,    max: 50,  step: 1,   def: 0, category: 'style' },
    // Toggle effects
    { key: 'grayscale',  label: 'Ч/Б',        toggle: true, def: 0, category: 'toggle' },
    { key: 'sepia',      label: 'Сепия',      toggle: true, def: 0, category: 'toggle' },
    { key: 'vignette',   label: 'Виньетка',   toggle: true, def: 0, category: 'toggle' },
    { key: 'invert',     label: 'Инверсия',   toggle: true, def: 0, category: 'toggle' },
    { key: 'vintage',    label: 'Винтаж',     toggle: true, def: 0, category: 'toggle' },
    { key: 'noir',       label: 'Нуар',       toggle: true, def: 0, category: 'toggle' },
];

export const FONTS = ['Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Impact', 'Trebuchet MS'];
export const ANIMS = ['none', 'fade-in', 'fade-out', 'slide-up', 'slide-down', 'typewriter', 'zoom-in'];

// START effects for video/image clips (full-canvas slide, zoom, etc.)
export const START_EFFECTS = [
    // Appearance
    { value: 'none',          label: 'Нет',               category: 'appearance' },
    { value: 'fade-in',       label: 'Fade In',            category: 'appearance' },
    { value: 'zoom-in',       label: 'Zoom In',            category: 'appearance' },
    { value: 'zoom-out',      label: 'Zoom Out',           category: 'appearance' },
    { value: 'pop',           label: 'Pop',                category: 'appearance' },
    { value: 'bounce-in',     label: 'Bounce In',          category: 'appearance' },
    { value: 'elastic-in',    label: 'Elastic In',         category: 'appearance' },
    // Movement (full canvas slide — for clips)
    { value: 'slide-left',    label: 'Slide from Left',    category: 'movement' },
    { value: 'slide-right',   label: 'Slide from Right',   category: 'movement' },
    { value: 'slide-up',      label: 'Slide from Top',     category: 'movement' },
    { value: 'slide-down',    label: 'Slide from Bottom',  category: 'movement' },
    // Special
    { value: 'blur-in',       label: 'Blur In',            category: 'special' },
    { value: 'rotate-in',     label: 'Rotate In',          category: 'special' },
    { value: 'flip-h-in',     label: 'Flip H In',          category: 'special' },
    { value: 'flip-v-in',     label: 'Flip V In',          category: 'special' },
    { value: 'reveal-center', label: 'Reveal Center',      category: 'special' },
];

// END effects for video/image clips
export const END_EFFECTS = [
    { value: 'none',          label: 'Нет',                category: 'appearance' },
    { value: 'fade-out',      label: 'Fade Out',           category: 'appearance' },
    { value: 'zoom-in',       label: 'Zoom In',            category: 'appearance' },
    { value: 'zoom-out',      label: 'Zoom Out',           category: 'appearance' },
    { value: 'pop-out',       label: 'Pop Out',            category: 'appearance' },
    { value: 'bounce-out',    label: 'Bounce Out',         category: 'appearance' },
    { value: 'elastic-out',   label: 'Elastic Out',        category: 'appearance' },
    { value: 'slide-left',    label: 'Slide to Left',      category: 'movement' },
    { value: 'slide-right',   label: 'Slide to Right',     category: 'movement' },
    { value: 'slide-up',      label: 'Slide to Top',       category: 'movement' },
    { value: 'slide-down',    label: 'Slide to Bottom',    category: 'movement' },
    { value: 'blur-out',      label: 'Blur Out',           category: 'special' },
    { value: 'rotate-out',    label: 'Rotate Out',         category: 'special' },
    { value: 'flip-h-out',    label: 'Flip H Out',         category: 'special' },
    { value: 'flip-v-out',    label: 'Flip V Out',         category: 'special' },
    { value: 'hide-center',   label: 'Hide Center',        category: 'special' },
];

// CONTINUOUS (loop) effects for video/image clips
export const CONTINUOUS_EFFECTS = [
    { value: 'none',          label: 'Нет' },
    // Ken Burns
    { value: 'ken-burns-in',  label: 'Ken Burns (приближение)' },
    { value: 'ken-burns-out', label: 'Ken Burns (удаление)' },
    { value: 'ken-burns-lr',  label: 'Ken Burns (лево→право)' },
    { value: 'ken-burns-rl',  label: 'Ken Burns (право→лево)' },
    // Scale
    { value: 'zoom-breathe',  label: 'Дыхание' },
    { value: 'pulse',         label: 'Пульсация' },
    { value: 'heartbeat',     label: 'Сердцебиение' },
    // Movement
    { value: 'shake',         label: 'Тряска' },
    { value: 'wiggle',        label: 'Покачивание' },
    { value: 'float',         label: 'Парение' },
    { value: 'drift',         label: 'Дрейф' },
    // Rotation
    { value: 'rotate-slow',   label: 'Вращение' },
    { value: 'swing',         label: 'Маятник' },
    { value: 'spin-fast',     label: 'Быстрое вращение' },
];

// PIP-specific START effects (no full-canvas slide — the PIP is a small overlay)
export const PIP_START_EFFECTS = [
    { value: 'none',          label: 'Нет',           category: 'appearance' },
    { value: 'fade-in',       label: 'Fade In',        category: 'appearance' },
    { value: 'zoom-in',       label: 'Zoom In',        category: 'appearance' },
    { value: 'zoom-out',      label: 'Zoom Out',       category: 'appearance' },
    { value: 'pop',           label: 'Pop',            category: 'appearance' },
    { value: 'bounce-in',     label: 'Bounce In',      category: 'appearance' },
    { value: 'elastic-in',    label: 'Elastic In',     category: 'appearance' },
    { value: 'blur-in',       label: 'Blur In',        category: 'special' },
    { value: 'rotate-in',     label: 'Rotate In',      category: 'special' },
    { value: 'flip-h-in',     label: 'Flip H In',      category: 'special' },
    { value: 'reveal-center', label: 'Reveal Center',  category: 'special' },
];

// PIP-specific END effects
export const PIP_END_EFFECTS = [
    { value: 'none',          label: 'Нет',            category: 'appearance' },
    { value: 'fade-out',      label: 'Fade Out',        category: 'appearance' },
    { value: 'zoom-in',       label: 'Zoom In',         category: 'appearance' },
    { value: 'zoom-out',      label: 'Zoom Out',        category: 'appearance' },
    { value: 'pop-out',       label: 'Pop Out',         category: 'appearance' },
    { value: 'bounce-out',    label: 'Bounce Out',      category: 'appearance' },
    { value: 'elastic-out',   label: 'Elastic Out',     category: 'appearance' },
    { value: 'blur-out',      label: 'Blur Out',        category: 'special' },
    { value: 'rotate-out',    label: 'Rotate Out',      category: 'special' },
    { value: 'flip-h-out',    label: 'Flip H Out',      category: 'special' },
    { value: 'hide-center',   label: 'Hide Center',     category: 'special' },
];

// PIP-specific CONTINUOUS effects
export const PIP_CONTINUOUS_EFFECTS = [
    { value: 'none',          label: 'Нет' },
    { value: 'zoom-breathe',  label: 'Дыхание' },
    { value: 'pulse',         label: 'Пульсация' },
    { value: 'heartbeat',     label: 'Сердцебиение' },
    { value: 'shake',         label: 'Тряска' },
    { value: 'wiggle',        label: 'Покачивание' },
    { value: 'float',         label: 'Парение' },
    { value: 'rotate-slow',   label: 'Вращение' },
    { value: 'swing',         label: 'Маятник' },
];

// Track type definitions for the Add Track modal
export const TRACK_TYPES = [
    { type: 'video',      icon: '🎬', label: 'Video',      desc: 'Видеоклип на основной дорожке',      action: 'upload-video' },
    { type: 'image',      icon: '🖼',  label: 'Image',      desc: 'Изображение на основной дорожке',    action: 'upload-image' },
    { type: 'audio',      icon: '🎵', label: 'Audio',      desc: 'Звуковая дорожка (музыка, голос)',    action: 'upload-audio' },
    { type: 'subtitle',   icon: '📝', label: 'Subtitle',   desc: 'Текстовые субтитры на таймлайне',    action: 'add-subtitle' },
    { type: 'pip',        icon: '📺', label: 'PIP',        desc: 'Наложение картинки/видео поверх',    action: 'upload-pip' },
    { type: 'effect',     icon: '✨', label: 'Effect',     desc: 'Визуальный эффект для всего видео',  action: 'add-effect' },
    { type: 'overlay',    icon: '🎨', label: 'Overlay',    desc: 'Полупрозрачный слой/наложение',     action: 'upload-overlay' },
    { type: 'background', icon: '🌄', label: 'Background', desc: 'Фоновое изображение или видео',      action: 'upload-background' },
];
