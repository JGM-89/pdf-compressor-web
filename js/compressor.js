/**
 * Compression orchestrator - delegates to the correct mode function.
 */

/* global compressMetadata, compressImages, compressFlatten */

/**
 * Run compression with the selected mode.
 * @param {string}     mode       - 'metadata' | 'image-compress' | 'flatten'
 * @param {Uint8Array} pdfBytes   - Original PDF bytes
 * @param {object}     analysis   - Analysis result
 * @param {object}     options    - { quality, dpi } for lossy modes
 * @param {function}   onProgress - callback(fraction, statusText)
 * @returns {Promise<Uint8Array>} Compressed PDF bytes
 */
async function compress(mode, pdfBytes, analysis, options, onProgress) {
  switch (mode) {
    case 'metadata':
      return compressMetadata(pdfBytes, analysis, onProgress);

    case 'image-compress':
      return compressImages(pdfBytes, analysis, options.quality, options.dpi, onProgress);

    case 'flatten':
      return compressFlatten(pdfBytes, analysis, options.quality, options.dpi, onProgress);

    default:
      throw new Error('Unknown compression mode: ' + mode);
  }
}
