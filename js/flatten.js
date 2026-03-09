/**
 * Mode 3: Flatten to images.
 * Renders each page as a JPEG using pdf.js, then rebuilds the PDF with pdf-lib.
 */

/* global PDFLib, yieldToUI, canvasToJpegBytes */

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
  var pdfjsLib = window['pdfjs-dist/build/pdf'];
  var PDFDocument = PDFLib.PDFDocument;

  onProgress(0.02, 'Loading PDF for rendering\u2026');

  // Load with pdf.js for rendering
  var loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  var pdfJsDoc = await loadingTask.promise;
  var pageCount = pdfJsDoc.numPages;

  var pageImages = []; // { jpegBytes, widthPt, heightPt }

  for (var i = 1; i <= pageCount; i++) {
    onProgress(0.02 + 0.78 * ((i - 1) / pageCount),
      'Rendering page ' + i + '/' + pageCount + '\u2026');

    var page = await pdfJsDoc.getPage(i);

    // Scale factor: pdf.js at scale=1 renders at 72 DPI
    var scale = dpi / 72;
    var viewport = page.getViewport({ scale: scale });

    // Create offscreen canvas
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    var ctx = canvas.getContext('2d');

    // White background (PDFs may have transparent backgrounds)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render page
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    // Export to JPEG
    var jpegBytes = await canvasToJpegBytes(canvas, quality);

    // Get original page dimensions in points
    var origViewport = page.getViewport({ scale: 1.0 });

    pageImages.push({
      jpegBytes: jpegBytes,
      widthPt: origViewport.width,
      heightPt: origViewport.height
    });

    // Cleanup to free memory
    page.cleanup();
    canvas.width = 1;
    canvas.height = 1;

    await yieldToUI();
  }

  pdfJsDoc.destroy();

  // Build new PDF from JPEG images using pdf-lib
  onProgress(0.85, 'Building PDF\u2026');

  var newDoc = await PDFDocument.create();

  for (var j = 0; j < pageImages.length; j++) {
    var img = pageImages[j];
    var embeddedImage = await newDoc.embedJpg(img.jpegBytes);

    var newPage = newDoc.addPage([img.widthPt, img.heightPt]);
    newPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: img.widthPt,
      height: img.heightPt
    });

    // Free the JPEG bytes from memory
    pageImages[j].jpegBytes = null;

    if (j % 5 === 0) {
      await yieldToUI();
    }
  }

  onProgress(0.95, 'Saving\u2026');

  var resultBytes = await newDoc.save();

  onProgress(1.0, 'Done');

  return resultBytes;
}
