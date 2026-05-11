/**
 * Size estimation and preflight helpers.
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

function estimateImageCompressSize(analysis, quality, dpi) {
  var imageBytes = analysis.categories.image.size;
  var removable = removableBytes(analysis);
  var nonImageBytes = Math.max(1024, analysis.totalSize - imageBytes - removable);

  var qScale = Math.pow(quality / 95, 0.6);
  var dpiScale = 1.0;
  if (dpi > 0) {
    dpiScale = Math.min(1.0, Math.pow(dpi / 300, 2));
  }

  return Math.round(nonImageBytes + imageBytes * qScale * dpiScale);
}

function estimateFlattenSize(analysis, quality, dpi) {
  var pages = analysis.pageCount || 1;
  var basePerPage = 300 * 1024;
  var dpiScale = Math.pow(dpi / 150, 2);
  var qScale = Math.pow(quality / 75, 0.6);
  return Math.round(pages * basePerPage * dpiScale * qScale);
}

function estimateWasmOptimizerSize(analysis) {
  var structuralBytes = analysis.categories.other.size +
    analysis.categories.vector.size +
    analysis.categories.font.size +
    analysis.categories.metadata.size +
    (analysis.categories.photoshop ? analysis.categories.photoshop.size : 0);
  var likelySavings = Math.min(analysis.totalSize * 0.08, structuralBytes * 0.18);
  return Math.max(1024, Math.round(analysis.totalSize - likelySavings));
}

function removableBytes(analysis) {
  return analysis.categories.metadata.size +
    (analysis.categories.photoshop ? analysis.categories.photoshop.size : 0);
}

function makeEstimateResult(estimate, spread, confidence, details) {
  var min = Math.max(1024, Math.round(estimate * (1 - spread)));
  var max = Math.max(min, Math.round(estimate * (1 + spread)));
  return {
    estimate: Math.round(estimate),
    min: min,
    max: max,
    confidence: confidence,
    details: details || ''
  };
}

function fixedEstimate(bytes, confidence, details) {
  return {
    estimate: Math.round(bytes),
    min: Math.round(bytes),
    max: Math.round(bytes),
    confidence: confidence || 'High',
    details: details || ''
  };
}

function formatEstimateRange(result, originalBytes) {
  var text;
  if (Math.abs(result.max - result.min) < 1024) {
    text = '~' + formatBytes(result.estimate);
  } else {
    text = '~' + formatBytes(result.min) + '-' + formatBytes(result.max);
  }

  var pct = originalBytes > 0 ? (1 - result.estimate / originalBytes) * 100 : 0;
  if (pct >= 1) {
    text += ' (' + pct.toFixed(0) + '%)';
  } else if (pct <= -1) {
    text += ' (' + Math.abs(pct).toFixed(0) + '% larger)';
  } else {
    text += ' (no change)';
  }
  text += ' ' + result.confidence + ' confidence';
  return text;
}

async function estimateFlattenPreflight(pdfBytes, analysis, quality, dpi) {
  var pdfjsLib = await Utils.ensurePDFJS();
  var loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  var pdfJsDoc = await loadingTask.promise;
  var pageCount = pdfJsDoc.numPages;
  var pages = samplePageNumbers(pageCount);
  var sampleRatioSum = 0;
  var sampleAreaSum = 0;
  var sampled = 0;

  try {
    for (var i = 0; i < pages.length; i++) {
      var page = await pdfJsDoc.getPage(pages[i]);
      var origViewport = page.getViewport({ scale: 1 });
      var area = Math.max(1, origViewport.width * origViewport.height);
      var scale = dpi / 72;
      var viewport = page.getViewport({ scale: scale });

      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      var jpegBytes = await canvasToJpegBytes(canvas, quality);
      sampleRatioSum += jpegBytes.byteLength / area;
      sampleAreaSum += area;
      sampled++;

      page.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    pdfJsDoc.destroy();
  }

  // Approximate total area as average sampled area × pageCount, rather than
  // walking every page. Sampling first/middle/last gives a reasonable area
  // average for typical documents, and the estimate is already approximate.
  var avgBytesPerArea = sampleRatioSum / Math.max(1, sampled);
  var avgArea = sampleAreaSum / Math.max(1, sampled);
  var totalArea = avgArea * pageCount;
  var pdfOverhead = 2048 + pageCount * 512;
  var estimate = totalArea * avgBytesPerArea + pdfOverhead;
  var spread = sampled >= 3 ? 0.2 : 0.3;
  return makeEstimateResult(estimate, spread, sampled >= 3 ? 'Medium' : 'Low',
    'Sampled ' + sampled + ' of ' + pageCount + ' pages');
}

function samplePageNumbers(pageCount) {
  if (pageCount <= 1) return [1];
  if (pageCount === 2) return [1, 2];
  var mid = Math.max(2, Math.round(pageCount / 2));
  var pages = [1, mid, pageCount];
  var unique = [];
  for (var i = 0; i < pages.length; i++) {
    if (unique.indexOf(pages[i]) === -1) unique.push(pages[i]);
  }
  return unique;
}
