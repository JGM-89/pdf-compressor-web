/**
 * Shared utility functions for PDF Compressor Web.
 */

/* global */

/**
 * Format bytes to a human-readable string (KB or MB).
 */
function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb >= 1024) {
    return (kb / 1024).toFixed(1) + ' MB';
  }
  if (kb >= 1) {
    return Math.round(kb).toLocaleString() + ' KB';
  }
  return bytes + ' bytes';
}

/**
 * Format a reduction comparison: "X.X MB (↓YY%)" or "(no change)" etc.
 * Returns { text, color } where color is a CSS variable name.
 */
function formatReduction(origBytes, newBytes, estimate) {
  const prefix = estimate ? '~' : '';
  if (newBytes >= origBytes) {
    const pct = (newBytes / origBytes - 1) * 100;
    if (pct < 1) {
      return { text: prefix + formatBytes(newBytes) + '  (no change)', cssClass: '' };
    }
    return { text: prefix + formatBytes(newBytes) + '  (\u2191' + pct.toFixed(0) + '% larger)', cssClass: 'warning' };
  }
  const pct = (1 - newBytes / origBytes) * 100;
  if (pct < 1) {
    return { text: prefix + formatBytes(newBytes) + '  (no change)', cssClass: '' };
  }
  return { text: prefix + formatBytes(newBytes) + '  (\u2193' + pct.toFixed(0) + '%)', cssClass: 'success' };
}

/**
 * Yield control to the browser event loop so the UI can update.
 */
function yieldToUI() {
  return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

/**
 * Create a Blob from a Uint8Array and trigger a browser download.
 */
function downloadBlob(uint8Array, filename) {
  var blob = new Blob([uint8Array], { type: 'application/pdf' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
}

var PDF_FILE_LIMITS = {
  defaultMaxBytes: 200 * 1024 * 1024,
  mergeMaxTotalBytes: 200 * 1024 * 1024,
  renderWarningBytes: 80 * 1024 * 1024
};

function confirmLargePDFWork(bytes, label, options) {
  options = options || {};
  var limit = options.limitBytes || PDF_FILE_LIMITS.defaultMaxBytes;
  var renderWarning = options.renderWarning || false;

  if (bytes <= limit && !(renderWarning && bytes > PDF_FILE_LIMITS.renderWarningBytes)) {
    return true;
  }

  var message = label + ' is ' + formatBytes(bytes) + '.\n\n' +
    'Large PDFs may make your browser slow down, freeze, or run out of memory because all processing happens on your device.';

  if (renderWarning) {
    message += '\n\nThis tool also renders pages to images for previews or output, which uses extra memory.';
  }

  message += '\n\nContinue?';
  return confirm(message);
}

function confirmFilesWithinLimit(files, options) {
  options = options || {};
  var total = 0;
  for (var i = 0; i < files.length; i++) {
    total += files[i].size || 0;
  }
  var label = options.label || (files.length + ' selected PDF files');
  var limit = options.limitBytes || PDF_FILE_LIMITS.defaultMaxBytes;
  return confirmLargePDFWork(total, label, {
    limitBytes: limit,
    renderWarning: !!options.renderWarning
  });
}

/**
 * Convert a canvas to JPEG bytes using toBlob (async).
 */
function canvasToJpegBytes(canvas, quality) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(blob) {
      if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
      blob.arrayBuffer().then(function(buf) {
        resolve(new Uint8Array(buf));
      });
    }, 'image/jpeg', quality / 100);
  });
}

function ensurePDFJS() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (window.PDFJS_READY) return window.PDFJS_READY;
  return Promise.reject(new Error('PDF renderer failed to load. Please refresh and try again.'));
}

/* ── Namespace for tool sub-pages ────────────────────────────────────── */
var Utils = {
  formatBytes: formatBytes,
  formatReduction: formatReduction,
  yieldToUI: yieldToUI,
  downloadBlob: downloadBlob,
  canvasToJpegBytes: canvasToJpegBytes,
  ensurePDFJS: ensurePDFJS,
  PDF_FILE_LIMITS: PDF_FILE_LIMITS,
  confirmLargePDFWork: confirmLargePDFWork,
  confirmFilesWithinLimit: confirmFilesWithinLimit
};
