/* ── Shared PDF Thumbnail Renderer ──────────────────────────────────── */
/* Uses pdf.js to render page thumbnails on canvas elements              */

var PDFThumbnails = (function () {
  'use strict';

  /**
   * Render a single page thumbnail onto a canvas
   * @param {Object} pdfDoc - pdf.js document proxy
   * @param {number} pageNum - 1-based page number
   * @param {HTMLCanvasElement} canvas - target canvas
   * @param {number} [maxSize=160] - max width or height in px
   * @returns {Promise<void>}
   */
  async function renderThumbnail(pdfDoc, pageNum, canvas, maxSize) {
    maxSize = maxSize || 160;
    var page = await pdfDoc.getPage(pageNum);
    var vp = page.getViewport({ scale: 1 });

    // Scale so the longest side fits within maxSize
    var scale = maxSize / Math.max(vp.width, vp.height);
    var scaled = page.getViewport({ scale: scale });

    canvas.width = Math.floor(scaled.width);
    canvas.height = Math.floor(scaled.height);

    var ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  }

  /**
   * Render thumbnails for all pages and return an array of canvas elements
   * @param {ArrayBuffer} pdfBytes - raw PDF bytes
   * @param {number} [maxSize=160] - max thumbnail dimension
   * @param {Function} [onProgress] - called with (rendered, total)
   * @returns {Promise<{canvases: HTMLCanvasElement[], pageCount: number}>}
   */
  async function renderAll(pdfBytes, maxSize, onProgress) {
    maxSize = maxSize || 160;

    // Ensure pdf.js worker is set
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // Copy bytes so pdf.js worker doesn't detach the caller's buffer
    var loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes).slice() });
    var pdfDoc = await loadingTask.promise;
    var total = pdfDoc.numPages;
    var canvases = [];

    for (var i = 1; i <= total; i++) {
      var canvas = document.createElement('canvas');
      await renderThumbnail(pdfDoc, i, canvas, maxSize);
      canvases.push(canvas);
      if (onProgress) onProgress(i, total);
    }

    // Release pdf.js document to free memory
    pdfDoc.destroy();

    return { canvases: canvases, pageCount: total };
  }

  return {
    renderThumbnail: renderThumbnail,
    renderAll: renderAll
  };
})();
