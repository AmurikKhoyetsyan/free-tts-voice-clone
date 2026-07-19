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

export const EFFECTS_DEF = [
    { key: 'brightness', label: 'Яркость',   min: -100, max: 100, step: 1,   def: 0 },
    { key: 'contrast',   label: 'Контраст',  min: -100, max: 100, step: 1,   def: 0 },
    { key: 'saturation', label: 'Насыщение', min: -100, max: 100, step: 1,   def: 0 },
    { key: 'blur',       label: 'Размытие',  min: 0,    max: 20,  step: 0.5, def: 0 },
    { key: 'sharpen',    label: 'Резкость',  min: 0,    max: 50,  step: 1,   def: 0 },
    { key: 'filmgrain',  label: 'Зернист.',  min: 0,    max: 50,  step: 1,   def: 0 },
    { key: 'grayscale',  label: 'Ч/Б',       toggle: true, def: 0 },
    { key: 'sepia',      label: 'Сепия',     toggle: true, def: 0 },
    { key: 'vignette',   label: 'Виньетка',  toggle: true, def: 0 },
    { key: 'invert',     label: 'Инверсия',  toggle: true, def: 0 },
];

export const FONTS = ['Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Impact', 'Trebuchet MS'];
export const ANIMS = ['none', 'fade-in', 'fade-out', 'slide-up', 'slide-down', 'typewriter', 'zoom-in'];

export const START_EFFECTS = [
    { value: 'none',          label: 'Нет' },
    { value: 'fade-in',       label: 'Fade In' },
    { value: 'zoom-in',       label: 'Zoom In' },
    { value: 'zoom-out',      label: 'Zoom Out' },
    { value: 'slide-left',    label: 'Slide from Left' },
    { value: 'slide-right',   label: 'Slide from Right' },
    { value: 'slide-up',      label: 'Slide from Top' },
    { value: 'slide-down',    label: 'Slide from Bottom' },
    { value: 'blur-in',       label: 'Blur In' },
    { value: 'rotate-in',     label: 'Rotate In' },
    { value: 'flip-h-in',     label: 'Flip H In' },
    { value: 'reveal-center', label: 'Reveal Center' },
    { value: 'bounce-in',     label: 'Bounce In' },
];

export const END_EFFECTS = [
    { value: 'none',          label: 'Нет' },
    { value: 'fade-out',      label: 'Fade Out' },
    { value: 'zoom-in',       label: 'Zoom In' },
    { value: 'zoom-out',      label: 'Zoom Out' },
    { value: 'slide-left',    label: 'Slide to Left' },
    { value: 'slide-right',   label: 'Slide to Right' },
    { value: 'slide-up',      label: 'Slide to Top' },
    { value: 'slide-down',    label: 'Slide to Bottom' },
    { value: 'blur-out',      label: 'Blur Out' },
    { value: 'rotate-out',    label: 'Rotate Out' },
    { value: 'flip-h-out',    label: 'Flip H Out' },
    { value: 'hide-center',   label: 'Hide Center' },
    { value: 'bounce-out',    label: 'Bounce Out' },
];

export const CONTINUOUS_EFFECTS = [
    { value: 'none',          label: 'Нет' },
    { value: 'ken-burns-in',  label: 'Ken Burns (приближение)' },
    { value: 'ken-burns-out', label: 'Ken Burns (удаление)' },
    { value: 'ken-burns-lr',  label: 'Ken Burns (лево→право)' },
    { value: 'ken-burns-rl',  label: 'Ken Burns (право→лево)' },
    { value: 'pulse',         label: 'Пульсация' },
    { value: 'shake',         label: 'Тряска' },
    { value: 'float',         label: 'Парение' },
    { value: 'zoom-breathe',  label: 'Дыхание' },
    { value: 'rotate-slow',   label: 'Вращение' },
];
