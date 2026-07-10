# TTS Studio — Полная документация

> Локальный офлайн-инструмент для синтеза речи, клонирования голоса, транскрипции, редактирования субтитров и монтажа видео.

---

## Содержание

1. [Быстрый старт](#1-быстрый-старт)
2. [Архитектура](#2-архитектура)
3. [Вкладки — руководство пользователя](#3-вкладки--руководство-пользователя)
   - 3.1 [Windows голоса](#31-windows-голоса)
   - 3.2 [Клонирование (XTTS v2)](#32-клонирование-xtts-v2)
   - 3.3 [Мои голоса](#33-мои-голоса)
   - 3.4 [История](#34-история)
   - 3.5 [Субтитры](#35-субтитры)
   - 3.6 [Видео](#36-видео)
   - 3.7 [Логи](#37-логи)
   - 3.8 [Image Video Editor](#38-image-video-editor)
4. [API Reference](#4-api-reference)
5. [Форматы данных](#5-форматы-данных)
6. [FFmpeg & субтитры](#6-ffmpeg--субтитры)
7. [Структура файлов проекта](#7-структура-файлов-проекта)
8. [Зависимости](#8-зависимости)
9. [Разработка](#9-разработка)

---

## 1. Быстрый старт

### Требования

| Компонент | Минимум |
|---|---|
| Python | 3.10+ |
| ОС | Windows 10/11 (основная), Linux/macOS (частичная поддержка) |
| FFmpeg | Входит в комплект (`./ffmpeg/`) или установлен глобально |
| VRAM | 4 GB+ для XTTS v2 (опционально) |

### Установка

```bash
# 1. Установить зависимости
pip install -r requirements.txt

# 2. (Опционально) XTTS v2 — клонирование голоса
install_xtts.bat

# 3. (Опционально) Дополнительные OneCore-голоса Windows
add_voices_admin.bat   # требует запуска от администратора
```

### Запуск

```bash
python app.py
# Сервер стартует на http://127.0.0.1:7860 и открывается в браузере
```

---

## 2. Архитектура

```
app.py
├── middleware/no_cache.py        # Отключает кэш для JS/CSS
├── routers/
│   ├── voices.py          /api/voices        — Windows и сохранённые голоса
│   ├── synthesis.py       /api/synthesize    — SSE-синтез (Windows, XTTS, Saved)
│   ├── xtts.py            /api/xtts          — Статус установки XTTS
│   ├── history.py         /api/history       — Браузер аудиофайлов
│   ├── subtitles.py       /api/subtitles     — CRUD для SRT-файлов
│   ├── video.py           /api/video         — Загрузка видео + прожиг субтитров
│   ├── transcribe.py      /api/transcribe    — Whisper транскрипция
│   ├── templates.py       /api/templates     — Пресеты стилей субтитров
│   ├── log_router.py      /api/logs          — Просмотр и редактирование логов
│   └── image_video.py     /api/imgvid        — Слайд-шоу редактор (Image Video)
├── services/
│   ├── tts_windows.py     — pyttsx3 / SAPI5 синтез
│   ├── tts_xtts.py        — Coqui XTTS v2 синтез
│   └── sse.py             — SSE-стриминг (поток прогресса)
├── core/
│   ├── audio.py           — WAV ввод/вывод
│   ├── history_manager.py — Управление аудиофайлами
│   ├── voice_manager.py   — Управление профилями голосов
│   ├── log.py             — Логирование + прогресс-бар в терминале
│   └── schemas.py         — Pydantic-модели
└── static/
    ├── index.html         — SPA (одна страница, 8 вкладок)
    ├── css/               — Стили (base, tabs, forms, audio, ...)
    └── js/
        ├── app.js         — Вход, ленивая инициализация вкладок
        ├── api.js         — fetch-хелперы + SSE-парсер
        ├── tabs/          — Логика каждой вкладки
        └── ...            — Компоненты (audio-player, modal, toast, ...)
```

### SSE-поток (стриминг синтеза)

Все эндпоинты синтеза возвращают `text/event-stream`. Формат кадров:

```
event: progress
data: {"value": 0.45, "desc": "Синтез слова 5/10"}

event: done
data: {"audio_url": "/api/history/audio-2024-07-10_12-00-00.wav/audio",
       "filename": "audio-2024-07-10_12-00-00.wav",
       "status": "✓ Готово — 3.2 сек"}

event: error
data: {"status": "❌ Ошибка: голос не найден"}
```

### Ленивая инициализация вкладок

При загрузке страницы инициализируется только вкладка **Windows голоса**. Остальные вкладки инициализируются при первом клике и запоминаются в `Set ready`. Это ускоряет первоначальную загрузку.

---

## 3. Вкладки — руководство пользователя

### 3.1 Windows голоса

Синтез речи через системные SAPI5-голоса Windows (pyttsx3).

**Элементы управления:**

| Элемент | Описание |
|---|---|
| Выбор голоса | Выпадающий список всех SAPI5-голосов; русские голоса (Irina, Pavel) идут первыми |
| Скорость | 50–350 слов/мин (по умолчанию 200) |
| Громкость | 0–100% |
| Текст | Многострочное текстовое поле |
| Кнопка «Синтез» | Запускает генерацию; прогресс отображается в Logger-панели |

**После синтеза:**
- Появляется аудиоплеер с результатом
- Автоматически обновляется раздел **История → Аудио**
- Можно сгенерировать субтитры к озвученному тексту (кнопка «Субтитры»)

**Генерация субтитров (из Windows голоса):**

| Параметр | Описание |
|---|---|
| Режим разбивки | По предложению / по строке / авто |
| Макс. символов | Максимальная длина одного субтитра |
| Пауза между субтитрами | Задержка в секундах между блоками |

После генерации субтитры можно отредактировать в визуальном таймлайне и сохранить в SRT.

---

### 3.2 Клонирование (XTTS v2)

Синтез речи с клонированием голоса по аудиообразцу (Coqui XTTS v2, ~2 GB модель).

> **Требование:** XTTS v2 должен быть установлен (`install_xtts.bat`).  
> Статус установки отображается в шапке вкладки.

**Шаги:**

1. Загрузить образец голоса (WAV/MP3, **10–30 секунд**, чистая речь без музыки)
2. Выбрать язык синтеза
3. Ввести текст
4. Нажать «Синтез»

**Поддерживаемые языки:**

| Код | Язык |
|---|---|
| ru | Русский |
| en | English |
| de | Deutsch |
| fr | Français |
| es | Español |
| it | Italiano |
| pl | Polski |
| uk | Українська |

**Сохранение голоса:**  
После синтеза образец можно сохранить как профиль (кнопка «Сохранить голос»). Сохранённые голоса доступны во вкладке **Мои голоса**.

---

### 3.3 Мои голоса

Управление сохранёнными голосовыми профилями и синтез с их использованием.

**Возможности:**

- Просмотр списка сохранённых голосов
- Предпрослушивание образца (кнопка воспроизведения рядом с именем)
- Переименование / удаление профиля
- Синтез текста с выбранным голосом и языком
- Автоматическое обновление списка при изменениях в других вкладках (событие `voices-changed`)

---

### 3.4 История

Централизованный браузер всех созданных материалов. Состоит из пяти разделов (переключение кнопками):

#### Аудио
- Список всех синтезированных WAV-файлов (новые сверху)
- Встроенный плеер для каждого файла
- Переименование, удаление
- Обновляется автоматически после каждого синтеза

#### Субтитры
- Список сохранённых SRT-файлов
- Предпросмотр содержимого
- Загрузить в редактор субтитров
- Скачать как `.srt`

#### Видео
- Список видео с прожжёнными субтитрами
- Встроенный плеер
- Скачать, удалить

#### Шаблоны
- Список сохранённых пресетов стиля субтитров
- Предпросмотр параметров (JSON)
- Применить шаблон в редакторе видео

#### Проекты
- Список проектов Image Video Editor
- Метаданные: дата создания/обновления, количество слайдов, общая длительность

---

### 3.5 Субтитры

Редактор SRT-файлов с поддержкой автоматической транскрипции через Whisper.

#### Редактор

- Ввод текста и ручное редактирование SRT-блоков
- Визуальный таймлайн: перетаскивание краёв блоков для настройки времён
- Параметры авторазбивки:
  - Режим: по предложению / по строке / авто
  - Максимальное количество символов на блок
  - Пауза между блоками (сек)
- Сохранение как `.srt` файл (POST `/api/subtitles`)
- Загрузка существующего SRT

#### Транскрипция (Whisper)

> **Требование:** `openai-whisper` должен быть установлен. Первый запуск скачивает модель `base` (~140 MB).

1. Загрузить аудио- или видеофайл
2. Выбрать язык (ru / en / uk / de / fr / es / zh / ja)
3. Нажать «Транскрибировать»
4. Результат автоматически заполняет редактор субтитров

Для видеофайлов FFmpeg автоматически извлекает аудио (16 кГц, моно, WAV).

---

### 3.6 Видео

Прожиг субтитров в видеофайл через FFmpeg с расширенными параметрами стиля.

#### Шаги

1. Загрузить видео (MP4, WebM, MKV, AVI)
2. Загрузить или написать SRT-субтитры
3. Настроить стиль
4. Выбрать выходной формат и разрешение
5. Нажать «Прожечь субтитры»

#### Параметры стиля

**Шрифт:**

| Параметр | Диапазон | По умолчанию |
|---|---|---|
| Семейство | Arial, Times New Roman, Calibri, … | Arial |
| Размер | 8–120 px | 48 |
| Цвет | HEX | #ffffff |
| Жирный / Курсив / Подчёркнутый | bool | false |

**Позиция:**

| Параметр | Описание |
|---|---|
| Пресет | top / middle / bottom + left / center / right |
| X / Y (px) | Явные координаты (в пространстве ASS PlayRes) |
| Вертикальный отступ | Отступ от края экрана (px) |

**Фон (Box):**

| Параметр | Описание |
|---|---|
| Прозрачность | 0–100% |
| Цвет | HEX |
| Отступ X / Y | Горизонтальный / вертикальный padding (px) |

**Контур и тень:**

| Параметр | Диапазон |
|---|---|
| Размер контура | 0–15 px |
| Цвет контура | HEX |
| Размер тени | 0–15 px |
| Цвет тени | HEX |

**Ширина текста:**

| Параметр | Описание |
|---|---|
| Макс. ширина % | Процент от ширины видео (по умолчанию 90%) |
| Ширина субтитра (px) | Явная ширина в ASS-пространстве |

**Анимация (на каждый субтитр):**

| Тип | Описание |
|---|---|
| none | Без анимации |
| fade-in | Появление (затухание из прозрачного) |
| fade-out | Исчезновение (затухание в прозрачное) |
| slide-up | Выезд снизу |
| slide-down | Выезд сверху |
| typewriter | Побуквенное появление |
| zoom-in | Масштаб 5% → 100% |

**Подсветка слов (Karaoke):**

| Параметр | Описание |
|---|---|
| Включить | bool |
| Цвет подсветки | HEX (по умолчанию #ffdd00) |
| Режим | `word` — только текущее слово; `cumulative` — все предыдущие слова |

#### Выходные параметры

| Параметр | Варианты |
|---|---|
| Формат | MP4, MKV, WebM, MOV |
| Разрешение | 16:9 (1920×1080), 9:16 (1080×1920), 1:1 (1080×1080), 4:3, Оригинал |
| Режим ресайза | Pad (letterbox), Crop, Stretch |

---

### 3.7 Логи

Просмотр и редактирование серверных логов.

- Список файлов `YYYY-MM-DD.log` с размером и датой
- Выбор файла → отображение содержимого
- Режим редактирования (кнопка «Редактировать»)
- Сохранение изменений (PUT `/api/logs/{filename}`)
- Переименование (формат имени `YYYY-MM-DD.log` обязателен)
- Удаление файла

---

### 3.8 Image Video Editor

Полнофункциональный редактор слайд-шоу с переходами, эффектами, субтитрами, PIP-слоями и многодорожечным аудио.

#### Интерфейс

```
┌─────────────────────────────────────────────────────────────────┐
│  Временна́я шкала (Timeline)  ←  drag-and-drop слайды           │
├──────────────────────┬──────────────────────────────────────────┤
│   Превью (Preview)   │   Панель свойств (Properties)            │
│   (видео + оверлеи)  │   зависит от выбранного объекта          │
└──────────────────────┴──────────────────────────────────────────┘
```

#### Слайды

Каждый слайд — изображение или видеоклип.

**Параметры слайда:**

| Параметр | Описание |
|---|---|
| Длительность | Время отображения (сек) |
| Скорость (видео) | 0.25×–4×; изменяет темп клипа |
| Trim In | Начало клипа (сек) — обрезка с начала |
| Переход | Тип и длительность перехода к следующему слайду |

**Эффекты изображения:**

| Эффект | Диапазон |
|---|---|
| Яркость | −100 … +100 |
| Контрастность | −100 … +100 |
| Насыщенность | −100 … +100 |
| Размытие | 0 … 20 |
| Резкость | 0 … 100 |
| Оттенки серого | 0–1 (bool) |
| Сепия | 0–1 |
| Виньетка | 0 … 100 |
| Зерно плёнки | 0 … 50 |
| Инвертировать | bool |

**Переходы (xfade):**

| Группа | Типы |
|---|---|
| Базовые | fade, crossfade, dissolve, fadeblack, fadewhite |
| Сдвиг | slideleft, slideright, slideup, slidedown |
| Вытеснение | wipeleft, wiperight, wipeup, wipedown |
| Специальные | circlecrop, pixelize, zoomin, hblur, fadegrays |
| Радиальные | radial, hlslice, hrslice, vuslice, vdslice |

#### Аудиодорожки

Можно добавить несколько независимых аудиодорожек.

| Параметр | Описание |
|---|---|
| Файл | MP3, WAV, AAC, FLAC, OGG |
| Громкость | 0 … 200% |
| Начальный сдвиг | Задержка старта дорожки (сек) |
| Trim In | Обрезка начала дорожки |
| Fade In / Fade Out | Плавное появление / исчезновение (сек) |

#### Субтитры (независимый трек)

Субтитры задаются абсолютными таймингами (не привязаны к конкретному слайду).

**Базовые параметры:**

| Параметр | Описание |
|---|---|
| Текст | Содержимое субтитра; `\n` становится переносом строки в ASS |
| Начало / Конец | Абсолютное время (сек) |
| X% / Y% | Положение центра субтитра (% от ширины/высоты видео) |
| Width% | Ширина области переноса строк (0 = авто 90%) |
| Размер шрифта | px в пространстве экспортного разрешения |
| Шрифт | Любой системный шрифт |
| Цвет | HEX |
| Жирный / Курсив / Подчёркнутый | bool |
| Контур | 0–15 px |
| Тень | 0–15 px |
| Вращение | −180 … +180° |
| Межстрочный интервал | 0.5 … 4.0 |

**Фон:**

| Параметр | Описание |
|---|---|
| Цвет фона | HEX |
| Прозрачность | 0–100% |
| Отступ X / Y | Padding (px) |
| Радиус скругления | px |

**Подсветка слов (Karaoke):**

| Параметр | Описание |
|---|---|
| Включить | Чекбокс |
| Режим | `word` (только текущее слово) / `cumulative` (накопительно) |
| Цвет подсветки | HEX (по умолчанию #ffdd00) |

**Анимация:** те же типы, что и в вкладке Видео.

> **Важно:** Субтитры автоматически обрезаются до реальной длительности видео (с учётом переходов). Это гарантирует, что последнее слово каждого субтитра всегда попадает в диапазон рендера.

#### PIP-слои (Picture-in-Picture)

Наложение дополнительных изображений или видеоклипов поверх основного видео.

| Параметр | Описание |
|---|---|
| Тип | Изображение или видеоклип |
| X% / Y% | Позиция верхнего левого угла (% от видео) |
| W% / H% | Ширина / высота (% от видео) |
| Непрозрачность | 0–100% |
| Начало / Конец | Время появления/исчезновения (сек) |
| Скорость (видео) | Изменение темпа PIP-клипа |
| Trim In | Обрезка начала PIP-клипа |

#### Экспорт

| Параметр | Варианты |
|---|---|
| Формат | MP4, MOV, MKV, WebM |
| Разрешение | 1920×1080 / 1280×720 / 1080×1920 / 1080×1080 / Custom |
| FPS | 24, 25, 30, 60 |
| Качество | Низкое (CRF 28) / Среднее (CRF 22) / Высокое (CRF 18) / Без потерь (CRF 0) |

Прогресс отображается в Logger-панели. Готовый файл сохраняется в `.output/imgvid/output/`.

#### Проекты

| Действие | Описание |
|---|---|
| Сохранить | Сохраняет проект на сервере (JSON, UUID-имя) |
| Загрузить | Открыть существующий проект |
| Переименовать | Изменить отображаемое имя |
| Экспортировать `.project` | ZIP-архив с проектом и всеми медиафайлами |
| Импортировать `.project` | Распаковать `.project`-архив и загрузить проект |
| Сохранить на диск | Сохранить `.project` в произвольный путь ФС |
| Загрузить с диска | Открыть `.project` с произвольного пути |

---

## 4. API Reference

### Базовый URL

```
http://127.0.0.1:7860
```

---

### 4.1 Голоса

#### `GET /api/voices/windows`
Список системных SAPI5-голосов.

```json
{ "voices": ["Irina", "Pavel", "..."], "default": "Irina" }
```

#### `GET /api/voices/saved`
Список сохранённых голосовых профилей.

```json
{ "voices": ["Голос1", "Голос2"], "urls": { "Голос1": "/api/voices/saved/Голос1/audio" } }
```

#### `GET /api/voices/saved/{name}/audio`
Скачать WAV-образец сохранённого голоса.

#### `POST /api/voices/saved`
Загрузить и сохранить голосовой образец.

```
Form: audio=<file>, name=<str>
Response: { "voices": [...], "urls": {...} }
```

#### `PUT /api/voices/saved/{name}`
Переименовать голос.

```json
Body: { "new_name": "НовоеИмя" }
```

#### `DELETE /api/voices/saved/{name}`
Удалить голос.

---

### 4.2 Синтез (SSE)

Все эндпоинты возвращают `Content-Type: text/event-stream`.

#### `POST /api/synthesize/windows`

```json
Body: {
  "text": "Привет, мир!",
  "voice": "Irina",
  "rate": 200,
  "volume": 100
}
```

#### `POST /api/synthesize/xtts`

```
Form:
  audio=<file>   WAV/MP3, 10–30 сек
  text=<str>
  language=<str> ru|en|de|fr|es|it|pl|uk
```

#### `POST /api/synthesize/saved`

```json
Body: {
  "text": "Текст",
  "voice": "ИмяПрофиля",
  "language": "ru"
}
```

---

### 4.3 XTTS

#### `GET /api/xtts/status`

```json
{
  "status": "XTTS v2 установлен",
  "languages": { "Русский": "ru", "English": "en", ... }
}
```

---

### 4.4 История аудио

#### `GET /api/history`
```json
{ "files": ["audio-2024-07-10_12-00-00.wav", ...] }
```

#### `GET /api/history/{name}/audio`
Стриминг WAV-файла (поддерживает Range-запросы).

#### `PUT /api/history/{name}`
```json
Body: { "new_name": "новое-имя.wav" }
```

#### `DELETE /api/history/{name}`
Удалить аудиофайл.

---

### 4.5 Субтитры (SRT)

#### `GET /api/subtitles`
```json
{ "files": ["project.srt", "interview.srt"] }
```

#### `GET /api/subtitles/{name}`
```json
{ "name": "project.srt", "content": "1\n00:00:00,000 --> ...\nТекст\n\n" }
```

#### `GET /api/subtitles/{name}/download`
Скачать как файл.

#### `GET /api/subtitles/{name}/vtt`
Конвертировать и вернуть как WebVTT.

#### `POST /api/subtitles`
```json
Body: { "name": "project", "content": "1\n00:00:00,000 --> 00:00:03,000\nТекст\n" }
```

#### `PUT /api/subtitles/{name}` / `DELETE /api/subtitles/{name}`
Переименовать / удалить.

---

### 4.6 Видео

#### `GET /api/video/ffmpeg-status`
```json
{ "available": true, "version": "ffmpeg version 6.0..." }
```

#### `POST /api/video/upload`
```
Form: file=<video_file>
Response: { "name": "video.mp4", "url": "/api/video/file/video.mp4" }
```

#### `GET /api/video/history`
```json
{ "files": [{ "name": "output.mp4", "url": "...", "size": 1234567 }] }
```

#### `POST /api/video/burn` (SSE)

Полный список параметров:

```
Form (все поля):
  video_name         str   — имя загруженного видео
  srt_name           str   — имя SRT-файла (или srt_content для прямого ввода)

  # Шрифт
  font_family        str   (Arial)
  font_size          int   (48)
  font_color         str   (#ffffff)
  bold               bool
  italic             bool
  underline          bool

  # Позиция
  position           str   bottom|middle|top
  text_align         str   left|center|right
  pos_x_px           int   (0 = авто)
  pos_y_px           int   (0 = авто)
  margin_v           int   (30)

  # Фон
  bg_opacity         float 0–100
  bg_color           str   (#000000)
  bg_pad_x           int   (12)
  bg_pad_y           int   (6)

  # Контур
  outline_size       float (2.0)
  outline_color      str   (#000000)

  # Тень
  shadow_size        float (1.0)
  shadow_color       str   (#000000)

  # Ширина
  max_width_pct      int   (90)
  sub_width_px       int   (0 = авто)
  sub_height_px      int   (0 = авто)

  # Анимация (JSON-массив с per-subtitle данными)
  subs_json          str   (JSON)

  # Karaoke
  karaoke_enabled    bool
  karaoke_color      str   (#ffdd00)
  karaoke_mode       str   word|cumulative

  # Вывод
  output_format      str   mp4|mkv|webm|mov
  output_width       int
  output_height      int
  resize_mode        str   pad|crop|stretch
```

---

### 4.7 Транскрипция (Whisper, SSE)

#### `POST /api/transcribe/audio`
```
Form: file=<audio_file>, language=<str>
SSE done: { "srt": "1\n00:00:00,000 --> ...\n" }
```

#### `POST /api/transcribe/video`
```
Form: video_name=<str>, language=<str>
```

---

### 4.8 Шаблоны стилей

#### `GET /api/templates`
```json
{ "templates": ["Белый субтитр", "Жёлтый karaoke"] }
```

#### `GET /api/templates/{name}`
```json
{ "name": "Белый субтитр", "settings": { "font_size": 48, "font_color": "#ffffff", ... } }
```

#### `POST /api/templates`
```json
Body: { "name": "МойПресет", "settings": { ... } }
```

#### `PUT` / `DELETE /api/templates/{name}` — переименование / удаление.

---

### 4.9 Логи

#### `GET /api/logs`
```json
{ "files": [{ "name": "2024-07-10.log", "size": 4096, "modified": "2024-07-10 15:30:00" }] }
```

#### `GET /api/logs/{filename}` — получить содержимое.
#### `PUT /api/logs/{filename}` — сохранить изменения (`Body: { "content": "..." }`).
#### `PATCH /api/logs/{filename}` — переименовать (`Body: { "new_name": "2024-07-11.log" }`).
#### `DELETE /api/logs/{filename}` — удалить.

---

### 4.10 Image Video Editor

#### Медиафайлы

```
POST /api/imgvid/images          — загрузить изображение
GET  /api/imgvid/images/{name}   — получить изображение
DELETE /api/imgvid/images/{name}

POST /api/imgvid/clips           — загрузить видеоклип
GET  /api/imgvid/clips/{name}
GET  /api/imgvid/thumbs/{name}   — миниатюра клипа
DELETE /api/imgvid/clips/{name}

POST /api/imgvid/audio           — загрузить аудиодорожку
GET  /api/imgvid/audio/{name}
```

#### Проекты

```
GET    /api/imgvid/projects            — список проектов
POST   /api/imgvid/projects            — создать/сохранить проект
GET    /api/imgvid/projects/{pid}      — получить проект
PUT    /api/imgvid/projects/{pid}      — обновить проект
PATCH  /api/imgvid/projects/{pid}      — переименовать
DELETE /api/imgvid/projects/{pid}      — удалить
GET    /api/imgvid/projects/{pid}/pack — скачать как .project (ZIP)
```

#### Работа с файловой системой

```
POST /api/imgvid/project/unpack         — импорт .project ZIP
POST /api/imgvid/project/save-to-path   — сохранить .project на диск
GET  /api/imgvid/project/browse         — обзор .project на диске
POST /api/imgvid/project/load-from-path — загрузить .project с диска
```

#### Экспорт (SSE)

```
POST /api/imgvid/export

Form:
  project_json   str   — полный JSON проекта
  output_format  str   — mp4|mov|mkv|webm
  resolution     str   — 1920x1080|1280x720|1080x1920|1080x1080|WxH
  fps            int   — 24|25|30|60
  quality        str   — low|medium|high|lossless
```

#### Извлечение аудио из клипа

```
POST /api/imgvid/extract-audio
Body: { "file": "clip_uuid.mp4" }
Response: { "name": "...", "url": "...", "duration": 12.5 }
```

#### Готовые видео

```
GET /api/imgvid/output/{name}   — скачать экспортированное видео
```

---

## 5. Форматы данных

### Слайд (Slide)

```json
{
  "type": "image",
  "file": "550e8400-e29b-41d4-a716-446655440000.jpg",
  "duration": 5.0,
  "speed": 1.0,
  "trimIn": 0.0,
  "effects": [
    { "type": "brightness", "value": 20 },
    { "type": "contrast",   "value": -10 }
  ],
  "transition": {
    "type": "fade",
    "duration": 0.5
  }
}
```

Для видеоклипа `"type": "video"`.

### Аудиодорожка (AudioTrack)

```json
{
  "file": "550e8400.mp3",
  "volume": 1.0,
  "startOffset": 2.0,
  "trimIn": 0.5,
  "duration": null,
  "fadeIn": 1.0,
  "fadeOut": 1.0
}
```

### Субтитр (Subtitle)

```json
{
  "id": "abc123",
  "text": "Привет, мир!",
  "start": 1.0,
  "end": 4.0,
  "x": 50,
  "y": 88,
  "w": 0,
  "fontFamily": "Arial",
  "fontSize": 40,
  "color": "#ffffff",
  "bold": false,
  "italic": false,
  "underline": false,
  "outline": 2.0,
  "outlineColor": "#000000",
  "shadow": 1.0,
  "shadowColor": "#000000",
  "bgColor": "#000000",
  "bgOpacity": 0.0,
  "bgPadX": 12,
  "bgPadY": 6,
  "bgRadius": 4,
  "lineHeight": 1.35,
  "animation": "none",
  "animDuration": 0.6,
  "rotation": 0,
  "karaokeEnable": false,
  "karaokeColor": "#ffdd00",
  "karaokeMode": "word",
  "aboveEffects": false
}
```

### PIP-слой

```json
{
  "type": "image",
  "file": "logo.png",
  "x": 5,
  "y": 5,
  "w": 20,
  "h": 15,
  "opacity": 0.9,
  "startTime": 0.0,
  "endTime": 10.0,
  "speed": 1.0,
  "trimIn": 0.0
}
```

### Проект (Project JSON)

```json
{
  "id": "uuid-v4",
  "name": "Мой проект",
  "slides": [ /* массив Slide */ ],
  "audio": [ /* массив AudioTrack */ ],
  "subtitles": [ /* массив Subtitle */ ],
  "pip": [ /* массив PIP */ ],
  "export_settings": {
    "format": "mp4",
    "resolution": "1920x1080",
    "fps": 30,
    "quality": "medium"
  }
}
```

---

## 6. FFmpeg & субтитры

### ASS-формат

Субтитры рендерятся через libass (FFmpeg `subtitles` фильтр). Генерируемый `.ass` файл использует:

- `PlayResX` / `PlayResY` — соответствуют разрешению экспорта
- `ScaledBorderAndShadow: yes` — масштабируемые границы/тени
- Per-event `MarginL`, `MarginR` — задают ширину переноса строк для каждого субтитра

### Ширина субтитра

Для субтитра с `w=0` (авто): оба отступа рассчитываются как 90% ширины, центрированной по `x%`.  
Для явного `w>0`: `half_w_px = w/200 * PlayResX`, затем:
```
MarginL = max(0, px - half_w_px)
MarginR = max(0, PlayResX - px - half_w_px)
```

### Подсветка слов (Karaoke)

Каждое слово получает **отдельный Dialogue-эвент** с временным интервалом:

```
word_dur = (abs_end - abs_start) / n_words

word[i].start = abs_start + i * word_dur       (целые сантисекунды)
word[i].end   = abs_start + (i+1) * word_dur   (для последнего — abs_end)
```

Тайминги вычисляются в **целых сантисекундах** (избегая накопления ошибок плавающей точки).  
Последнее слово всегда заканчивается ровно в `abs_end`.

`abs_end` каждого субтитра автоматически ограничивается реальной длительностью видео (с учётом переходов xfade).

### Pipeline экспорта (Image Video)

```
[img/clip 0] → scale+effects → [v0]
[img/clip 1] → scale+effects → [v1]
...
[v0][v1] → xfade → [xf1]
[xf1][v2] → xfade → [xf2]
...
[xfN] → subtitles filter → [vout_base]
[vout_base][pip0] → overlay → [vout_pip0]
...
[vout_pipN] → audio mix → output
```

---

## 7. Структура файлов проекта

```
tts/
├── app.py                   # Точка входа
├── requirements.txt
├── CLAUDE.md                # Инструкции для Claude Code
├── install_xtts.bat         # Установка XTTS v2
├── add_voices_admin.bat     # Регистрация OneCore-голосов (admin)
│
├── routers/                 # FastAPI-роутеры
├── services/                # TTS-сервисы (Windows, XTTS, SSE)
├── core/                    # Утилиты (audio, history, voice, log, schemas)
├── middleware/              # ASGI-middleware
│
├── static/
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── app.js
│       ├── api.js
│       ├── audio-manager.js
│       ├── audio-player.js
│       ├── custom-select.js
│       ├── events.js
│       ├── file-upload.js
│       ├── icons.js
│       ├── logger.js
│       ├── modal.js
│       ├── tabs.js
│       ├── toast.js
│       └── tabs/
│           ├── windows.js
│           ├── cloning.js
│           ├── saved.js
│           ├── history.js
│           ├── subtitles.js
│           ├── video.js
│           ├── logs.js
│           └── image-video.js
│
├── ffmpeg/                  # Локальный FFmpeg (авто-добавляется в PATH)
│   └── ffmpeg.exe
│
├── saved_voices/            # XTTS голосовые образцы (.wav)
│
└── .output/
    ├── audio/               # Синтезированные WAV-файлы
    ├── subtitle/            # SRT-файлы
    ├── video/
    │   └── src/             # Загруженные исходные видео
    ├── templates/           # JSON-пресеты стилей
    ├── logs/                # Серверные логи (YYYY-MM-DD.log)
    └── imgvid/
        ├── images/          # Изображения для слайд-шоу (UUID)
        ├── clips/           # Видеоклипы (UUID)
        ├── audio/           # Аудиодорожки (UUID)
        ├── thumbs/          # Миниатюры клипов
        ├── projects/        # JSON-проекты
        ├── output/          # Экспортированные видео
        └── saved_projects/  # .project ZIP-архивы
```

---

## 8. Зависимости

### Обязательные

| Пакет | Назначение |
|---|---|
| `fastapi >= 0.110` | Web-фреймворк |
| `uvicorn[standard] >= 0.27` | ASGI-сервер |
| `python-multipart >= 0.0.9` | Парсинг form-data |
| `pyttsx3 >= 2.90` | Windows SAPI5 TTS |
| `soundfile >= 0.12.0` | WAV ввод/вывод |
| `numpy >= 1.22.0` | Аудиомассивы |

### Опциональные

| Пакет | Назначение | Размер |
|---|---|---|
| `openai-whisper >= 20230314` | Транскрипция речи | ~140 MB (модель base) |
| `TTS` (Coqui) | XTTS v2 клонирование голоса | ~2 GB (модель) |
| `torch` | Зависимость TTS (GPU опционально) | ~1–3 GB |

### Системные

| Компонент | Назначение |
|---|---|
| FFmpeg 4.4+ | Прожиг субтитров, монтаж видео, транскодирование |
| Windows SAPI5 | Голоса (Irina, Pavel + OneCore) |

---

## 9. Разработка

### Запуск в режиме разработки

```bash
python app.py
# hot-reload отсутствует; перезапускать вручную после изменений бэкенда
```

Фронтенд автоматически перезагружается при обновлении страницы (кэш JS/CSS отключён через `NoCacheStaticMiddleware`).

### Добавление нового роутера

1. Создать `routers/my_router.py` с `router = APIRouter()`
2. Добавить в `app.py`:
   ```python
   from routers.my_router import router as my_router
   app.include_router(my_router, prefix="/api/my-feature")
   ```

### Добавление новой вкладки

1. Создать `static/js/tabs/my-tab.js` с функцией `export function init() { ... }`
2. Добавить HTML-панель в `index.html`
3. В `app.js` добавить таб-кнопку в массив и ленивый импорт:
   ```js
   case 'my-tab': { const { init } = await import('./tabs/my-tab.js'); init(); break; }
   ```

### SSE-эндпоинт (шаблон)

```python
from services.sse import run_synth_stream
from fastapi.responses import StreamingResponse

@router.post("/my-synthesis")
async def my_synthesis(body: MyBody):
    def core_fn(text, progress=None):
        # ... выполнить работу ...
        if progress: progress(0.5, "Половина готова")
        # ... завершить ...
        return result

    return StreamingResponse(
        run_synth_stream(core_fn, (body.text,)),
        media_type="text/event-stream"
    )
```

### Кросс-вкладочные события

```js
import { emitEvent } from '../events.js';

// Отправить событие
emitEvent('history-changed');

// Подписаться (в другой вкладке)
import { onEvent } from '../events.js';
onEvent('history-changed', () => loadAudioList());
```

Доступные события: `voices-changed`, `history-changed`, `video-changed`.

### Логирование

```python
from core.log import app_log

app_log("Синтез завершён", level="INFO", source="Windows")
app_log("Файл не найден", level="ERROR", source="Video")
```

Логи пишутся в stdout и в `.output/logs/YYYY-MM-DD.log`.

---

*Документация актуальна для коммита на ветке `images`. Сгенерировано: 2026-07-10.*
