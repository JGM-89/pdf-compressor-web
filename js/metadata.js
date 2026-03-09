/**
 * Mode 1: Lossless metadata stripping.
 * Removes XMP metadata streams and clears the Info dictionary.
 */

/* global PDFLib, yieldToUI */

/**
 * Strip metadata from a PDF.
 * @param {Uint8Array} pdfBytes   - Original PDF bytes
 * @param {object}     analysis   - Analysis result (unused here but kept for API consistency)
 * @param {function}   onProgress - callback(fraction, statusText)
 * @returns {Promise<Uint8Array>} Compressed PDF bytes
 */
async function compressMetadata(pdfBytes, analysis, onProgress) {
  var PDFDocument = PDFLib.PDFDocument;
  var PDFName = PDFLib.PDFName;

  onProgress(0.1, 'Loading PDF\u2026');

  var pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });

  onProgress(0.2, 'Stripping metadata\u2026');

  // Clear the Info dictionary
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');

  // Remove XMP metadata from catalog
  var catalog = pdfDoc.catalog;
  if (catalog.has(PDFName.of('Metadata'))) {
    catalog.delete(PDFName.of('Metadata'));
  }

  onProgress(0.4, 'Removing page metadata\u2026');

  // Remove page-level metadata
  var pageCount = pdfDoc.getPageCount();
  for (var i = 0; i < pageCount; i++) {
    var page = pdfDoc.getPage(i);
    if (page.node.has(PDFName.of('Metadata'))) {
      page.node.delete(PDFName.of('Metadata'));
    }

    // Remove metadata from page resources/properties
    try {
      var resources = page.node.get(PDFName.of('Resources'));
      if (resources) {
        var resDict = pdfDoc.context.lookup(resources);
        if (resDict && resDict.get) {
          var props = resDict.get(PDFName.of('Properties'));
          if (props) {
            var propsDict = pdfDoc.context.lookup(props);
            if (propsDict && propsDict.entries) {
              for (var entry of propsDict.entries()) {
                var val = pdfDoc.context.lookup(entry[1]);
                if (val && val.dict && val.dict.get && val.dict.get(PDFName.of('Metadata'))) {
                  val.dict.delete(PDFName.of('Metadata'));
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Skip pages that can't be processed
    }

    if (i % 50 === 0) {
      await yieldToUI();
    }
  }

  onProgress(0.8, 'Saving\u2026');

  var resultBytes = await pdfDoc.save();

  onProgress(1.0, 'Done');

  return resultBytes;
}
