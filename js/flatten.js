/**
 * Mode 3: Flatten to images.
 * Renders each page as a JPEG using pdf.js, then rebuilds the PDF with pdf-lib.
 */

/* global PDFLib, Utils, yieldToUI, canvasToJpegBytes */

/**
 * Flatten a PDF by rendering every page as a JPEG image.
 * @param {Uint8Array} pdfBytes   - Original PDF bytes
 * @param {object}     analysis   - Analysis result
 * @param {number}     quality    - JPEG quality 30-95
 * @param {number}     dpi        - Render DPI (96/120/150/300)
 * @param {function}   onProgress - callback(fraction, statusText)
 * @returns {Promise<Uint8Array>} New PDF bytes
 */
async function compressFlatten(pdfBytes, analysis, quality, dpi, onProgress) {
  var pdfjsLib = await Utils.ensurePDFJS();
  var PDFDocument = PDFLib.PDFDocument;

  onProgress(0.02, 'Loading PDF for rendering\u2026');

  // Load with pdf.js for rendering
  var loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  var pdfJsDoc = await loadingTask.promise;
  var pageCount = pdfJsDoc.numPages;

  // Embed each page immediately after rendering rather than accumulating
  // all JPEGs in memory first. Keeps peak memory at one page's worth.
  var newDoc = await PDFDocument.create();
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

  for (var i = 1; i <= pageCount; i++) {
    onProgress(0.02 + 0.93 * ((i - 1) / pageCount),
      'Rendering page ' + i + '/' + pageCount + '\u2026');

    var page = await pdfJsDoc.getPage(i);

    // pdf.js at scale=1 renders at 72 DPI
    var scale = dpi / 72;
    var viewport = page.getViewport({ scale: scale });

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    // White background (PDFs may have transparent backgrounds)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    var jpegBytes = await canvasToJpegBytes(canvas, quality);
    var origViewport = page.getViewport({ scale: 1.0 });

    var embeddedImage = await newDoc.embedJpg(jpegBytes);
    jpegBytes = null;

    var newPage = newDoc.addPage([origViewport.width, origViewport.height]);
    newPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: origViewport.width,
      height: origViewport.height
    });

    page.cleanup();
    canvas.width = 1;
    canvas.height = 1;

    if (i % 3 === 0) await yieldToUI();
  }

  pdfJsDoc.destroy();

  onProgress(0.96, 'Saving\u2026');

  var resultBytes = await newDoc.save();

  onProgress(1.0, 'Done');

  return resultBytes;
}
