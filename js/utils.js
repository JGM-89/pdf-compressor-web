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
