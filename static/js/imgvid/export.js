// TODO: Export panel functions — to be migrated from image-video.js
//
// Functions intended here:
//   startExport(ctx)          ← _startExport in image-video.js
//   getExportSettings(ctx)    ← _getExportSettings in image-video.js
//   applyExportSettings(s, ctx) ← _applyExportSettings in image-video.js
//   updateExportModePanels()  ← _updateExportModePanels in image-video.js
//
// These functions depend on many local variables inside init() (exportBtn, exportProg,
// exportStatus, progFill, progPct, resEl, resWEl, resHEl, resXEl, _getResolution,
// _updateCustomResVis, _updatePreviewSize, S, $) and are kept in image-video.js
// until a ctx pattern is formally agreed upon.
//
// import { synthesizeStream } from '../api.js';
// import { toast } from '../toast.js';
// import { log } from '../logger.js';
