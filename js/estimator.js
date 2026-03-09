/**
 * Real-time size estimation formulas.
 * These match the desktop app's estimation logic.
 */

/**
 * Estimate the result size of metadata stripping.
 * Just subtracts metadata stream bytes from total.
 */
function estimateMetadataSize(analysis) {
  var removable = analysis.categories.metadata.size +
                  (analysis.categories.photoshop ? analysis.categories.photoshop.size : 0);
  return Math.max(1024, analysis.totalSize - removable);
}

/**
 * Estimate the result size of image compression.
 * @param {object} analysis - Analysis result
 * @param {number} quality  - JPEG quality 20-95
 * @param {number} dpi      - Max DPI (0 = original, 96/150/300)
 */
function estimateImageCompressSize(analysis, quality, dpi) {
  var imageBytes = analysis.categories.image.size;
  var nonImageBytes = Math.max(1024, analysis.totalSize - imageBytes);

  var qScale = Math.pow(quality / 95, 0.6);
  var dpiScale = 1.0;
  if (dpi > 0) {
    dpiScale = Math.min(1.0, Math.pow(dpi / 300, 2));
  }

  return Math.round(nonImageBytes + imageBytes * qScale * dpiScale);
}

/**
 * Estimate the result size of flatten-to-images.
 * @param {object} analysis - Analysis result
 * @param {number} quality  - JPEG quality 30-95
 * @param {number} dpi      - Render DPI (96/120/150/300)
 */
function estimateFlattenSize(analysis, quality, dpi) {
  var pages = analysis.pageCount;
  // Base: ~300 KB per page at 150 DPI, quality 75
  var basePerPage = 300 * 1024;
  var dpiScale = Math.pow(dpi / 150, 2);
  var qScale = Math.pow(quality / 75, 0.6);
  return Math.round(pages * basePerPage * dpiScale * qScale);
}
