/**
 * Mode 2: Image compression.
 * Re-encodes embedded raster images at lower JPEG quality,
 * optionally downsampling to a target DPI.
 * Grayscale images are detected and written as DeviceGray + FlateDecode
 * for much better compression on mask/layer images from Photoshop.
 * Handles FlateDecode streams with TIFF/PNG Predictor (DecodeParms).
 * Text, vectors, and fonts are untouched.
 */

/* global PDFLib, yieldToUI, canvasToJpegBytes */

/** Compression log — populated during compressImages, read by app.js */
var _compressLog = [];

/**
 * Compress images in a PDF by re-encoding them as JPEG (or Flate for grayscale).
 * Also strips metadata and Photoshop data.
 * @param {Uint8Array} pdfBytes   - Original PDF bytes
 * @param {object}     analysis   - Analysis result (contains .images array)
 * @param {number}     quality    - JPEG quality 20-95
 * @param {number}     targetDPI  - Max DPI (0 = no downsampling)
 * @param {function}   onProgress - callback(fraction, statusText)
 * @returns {Promise<Uint8Array>} Compressed PDF bytes
 */
async function compressImages(pdfBytes, analysis, quality, targetDPI, onProgress) {
  var PDFDocument = PDFLib.PDFDocument;
  var PDFName = PDFLib.PDFName;
  var PDFRawStream = PDFLib.PDFRawStream;

  _compressLog = [];
  _compressLog.push('=== Image Compression Log ===');
  _compressLog.push('Quality: ' + quality + ', Target DPI: ' + (targetDPI || 'original'));
  _compressLog.push('Analysis found ' + analysis.images.length + ' images total');
  _compressLog.push('');

  onProgress(0.02, 'Loading PDF\u2026');

  var pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });

  // Log all images from analysis before filtering
  for (var a = 0; a < analysis.images.length; a++) {
    var ai = analysis.images[a];
    _compressLog.push('  Image ' + (a + 1) + ': ref=' + ai.ref + ' ' + ai.width + 'x' + ai.height +
      ' filter=' + ai.filter + ' cs=' + ai.colorSpace + ' size=' + ai.rawSize + 'b' +
      (ai.isMask ? ' MASK' : ''));
  }
  _compressLog.push('');

  // Filter to compressible images (skip tiny icons and unsupported formats)
  var images = analysis.images.filter(function(img) {
    return isImageCompressionCandidate(pdfDoc, img, _compressLog);
  });

  _compressLog.push('');
  _compressLog.push(images.length + ' images passed filter, processing...');
  _compressLog.push('');

  var total = images.length;
  var processed = 0;
  var replaced = 0;

  for (var i = 0; i < total; i++) {
    var imgInfo = images[i];
    onProgress(0.02 + 0.88 * (i / total),
      'Compressing image ' + (i + 1) + '/' + total + '\u2026');

    _compressLog.push('--- Image ' + (i + 1) + '/' + total + ': ref=' + imgInfo.ref +
      ' ' + imgInfo.width + 'x' + imgInfo.height + ' filter=' + imgInfo.filter +
      ' size=' + imgInfo.rawSize + 'b ---');

    try {
      var didReplace = await reencodeImage(pdfDoc, imgInfo, quality, targetDPI, analysis);
      if (didReplace) {
        replaced++;
        _compressLog.push('  \u2713 REPLACED');
      } else {
        _compressLog.push('  \u2717 SKIPPED (returned false)');
      }
    } catch (e) {
      _compressLog.push('  \u2717 ERROR: ' + (e.message || e));
      _compressLog.push('  Stack: ' + (e.stack || 'n/a'));
    }

    _compressLog.push('');
    processed++;
    if (processed % 3 === 0) {
      await yieldToUI();
    }
  }

  // Also strip metadata and Photoshop data (same as lossless cleanup)
  onProgress(0.92, 'Stripping metadata\u2026');

  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');

  var catalog = pdfDoc.catalog;
  if (catalog.has(PDFName.of('Metadata'))) {
    catalog.delete(PDFName.of('Metadata'));
  }

  // Remove Photoshop resource data streams
  if (analysis.photoshopRefs && analysis.photoshopRefs.length > 0) {
    onProgress(0.94, 'Removing Photoshop data\u2026');
    for (var j = 0; j < analysis.photoshopRefs.length; j++) {
      try {
        pdfDoc.context.delete(analysis.photoshopRefs[j]);
      } catch (e) { /* skip */ }
    }
    _compressLog.push('Stripped ' + analysis.photoshopRefs.length + ' Photoshop streams');
  }

  _compressLog.push('');
  _compressLog.push('=== Summary ===');
  _compressLog.push('Processed: ' + processed + ', Replaced: ' + replaced);

  onProgress(0.96, 'Saving (' + replaced + ' images compressed)\u2026');

  var resultBytes = await pdfDoc.save();

  _compressLog.push('Output size: ' + resultBytes.byteLength + ' bytes (' +
    (resultBytes.byteLength / 1024).toFixed(1) + ' KB)');

  onProgress(1.0, 'Done');

  return resultBytes;
}

function isImageCompressionCandidate(pdfDoc, img, log) {
  log = log || [];
    if (img.width < 8 || img.height < 8) {
      log.push('SKIP ' + img.ref + ': too small (' + img.width + 'x' + img.height + ')');
      return false;
    }
    if (img.isMask) {
      log.push('SKIP ' + img.ref + ': image mask');
      return false;
    }
    if (img.hasSMask || img.hasMask || img.hasDecode) {
      log.push('SKIP ' + img.ref + ': transparency/mask/decode fields require preservation');
      return false;
    }
    if (hasRiskyImageDictionary(pdfDoc, img)) {
      log.push('SKIP ' + img.ref + ': risky image dictionary fields');
      return false;
    }
    if (img.filter !== 'DCTDecode' && img.filter !== 'FlateDecode' && img.filter !== '') {
      log.push('SKIP ' + img.ref + ': unsupported filter "' + img.filter + '"');
      return false;
    }
    if (img.colorSpace === 'DeviceCMYK') {
      log.push('SKIP ' + img.ref + ': CMYK not supported');
      return false;
    }
    return true;
}

async function estimateImageCompressPreflight(pdfBytes, analysis, quality, targetDPI) {
  var PDFDocument = PDFLib.PDFDocument;
  var oldLog = _compressLog;
  var tempLog = [];
  _compressLog = tempLog;

  try {
    var pdfDoc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false
    });

    var candidates = [];
    var eligibleBytes = 0;
    var skippedBytes = 0;
    for (var i = 0; i < analysis.images.length; i++) {
      var img = analysis.images[i];
      if (isImageCompressionCandidate(pdfDoc, img, tempLog)) {
        candidates.push(img);
        eligibleBytes += img.rawSize || 0;
      } else {
        skippedBytes += img.rawSize || 0;
      }
    }

    var sampleLimit = 8;
    var byteLimit = 25 * 1024 * 1024;
    var sampledBytes = 0;
    var sampleSavings = 0;
    var sampled = 0;

    for (var j = 0; j < candidates.length; j++) {
      if (sampled >= sampleLimit || sampledBytes >= byteLimit) break;
      var item = candidates[j];
      var originalSize = item.rawSize || 0;
      sampledBytes += originalSize;
      sampled++;

      try {
        var didReplace = await reencodeImage(pdfDoc, item, quality, targetDPI, analysis);
        if (didReplace) {
          var obj = pdfDoc.context.lookup(item.ref);
          var newSize = obj && obj.contents ? (obj.contents.length || obj.contents.byteLength || 0) : originalSize;
          sampleSavings += Math.max(0, originalSize - newSize);
        }
      } catch (e) {
        // Failed samples are treated as unchanged, matching compressor behavior.
      }

      if (sampled % 2 === 0) await yieldToUI();
    }

    var removable = analysis.categories.metadata.size +
      (analysis.categories.photoshop ? analysis.categories.photoshop.size : 0);
    var savingsRate = sampledBytes > 0 ? sampleSavings / sampledBytes : 0;
    var projectedSavings = Math.min(eligibleBytes, eligibleBytes * savingsRate);
    var estimate = Math.max(1024, analysis.totalSize - removable - projectedSavings);

    var coverage = eligibleBytes > 0 ? sampledBytes / eligibleBytes : 1;
    var skippedShare = analysis.categories.image.size > 0 ? skippedBytes / analysis.categories.image.size : 0;
    var confidence = 'Low';
    var spread = 0.4;
    if (sampled > 0 && (coverage >= 0.6 || sampled >= sampleLimit) && skippedShare < 0.35) {
      confidence = 'High';
      spread = 0.15;
    } else if (sampled > 0 && skippedShare < 0.6) {
      confidence = 'Medium';
      spread = 0.25;
    }

    return makeEstimateResult(estimate, spread, confidence,
      'Sampled ' + sampled + ' of ' + candidates.length + ' eligible images');
  } finally {
    _compressLog = oldLog;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function hasRiskyImageDictionary(pdfDoc, imgInfo) {
  var PDFName = PDFLib.PDFName;
  try {
    var obj = pdfDoc.context.lookup(imgInfo.ref);
    if (!obj || !obj.dict || !obj.dict.get) return true;

    if (obj.dict.get(PDFName.of('SMask')) ||
        obj.dict.get(PDFName.of('Mask')) ||
        obj.dict.get(PDFName.of('ImageMask')) ||
        obj.dict.get(PDFName.of('Decode'))) {
      return true;
    }

    var filter = obj.dict.get(PDFName.of('Filter'));
    filter = resolveVal(filter, pdfDoc.context);
    if (filter && typeof filter.size === 'function' && filter.size() > 1) {
      return true;
    }
  } catch (e) {
    return true;
  }
  return false;
}

/**
 * Resolve a pdf-lib dictionary value, following indirect references.
 */
function resolveVal(val, ctx) {
  if (!val) return val;
  if (typeof val.objectNumber === 'number' && ctx) {
    try { return ctx.lookup(val); } catch (e) { return val; }
  }
  return val;
}

/**
 * Read a numeric value from a pdf-lib object.
 */
function numVal(obj) {
  if (!obj) return 0;
  if (typeof obj === 'number') return obj;
  // pdf-lib minified: .value may be a method, not a property
  var v = (typeof obj.value === 'function') ? obj.value() : obj.value;
  if (typeof v === 'number') return v;
  return parseFloat(obj.toString()) || 0;
}

/**
 * Read DecodeParms from a stream dictionary.
 * Returns { predictor, colors, columns, bpc } or null.
 */
function readDecodeParms(dict, ctx) {
  var PDFName = PDFLib.PDFName;
  var dp = dict.get(PDFName.of('DecodeParms'));
  dp = resolveVal(dp, ctx);
  if (!dp || !dp.get) return null;

  return {
    predictor: numVal(resolveVal(dp.get(PDFName.of('Predictor')), ctx)) || 1,
    colors:    numVal(resolveVal(dp.get(PDFName.of('Colors')), ctx)) || 1,
    columns:   numVal(resolveVal(dp.get(PDFName.of('Columns')), ctx)) || 1,
    bpc:       numVal(resolveVal(dp.get(PDFName.of('BitsPerComponent')), ctx)) || 8
  };
}

/**
 * Undo TIFF Predictor 2 (horizontal differencing) in-place.
 * Each sample = (delta + previous_sample) mod 256.
 */
function undoTIFFPredictor(bytes, width, components) {
  var rowSize = width * components;
  var rows = Math.floor(bytes.length / rowSize);
  for (var y = 0; y < rows; y++) {
    var off = y * rowSize;
    // First pixel in each row is absolute; remaining are deltas
    for (var x = components; x < rowSize; x++) {
      bytes[off + x] = (bytes[off + x] + bytes[off + x - components]) & 0xFF;
    }
  }
}

/**
 * Undo PNG Predictors (types 10-15) in-place.
 * Each row starts with a filter-type byte, followed by filtered pixel data.
 */
function undoPNGPredictors(bytes, rowWidth, components) {
  // rowWidth = columns * components (bytes per row EXCLUDING the filter byte)
  var stride = rowWidth + 1; // +1 for the filter-type byte
  var rows = Math.floor(bytes.length / stride);
  // We'll decode in-place; need to read from bottom up or use a temporary row
  // Actually, we must decode top-down because Up/Average/Paeth reference the prior row
  var prev = new Uint8Array(rowWidth); // previous decoded row (starts as zeros)
  var outputOffset = 0;

  for (var y = 0; y < rows; y++) {
    var inputOffset = y * stride;
    var filterType = bytes[inputOffset];
    var rowStart = inputOffset + 1;

    for (var x = 0; x < rowWidth; x++) {
      var raw = bytes[rowStart + x];
      var a = x >= components ? bytes[outputOffset + x - components] : 0; // left
      var b = prev[x]; // above
      var c = (x >= components) ? prev[x - components] : 0; // upper-left
      var val;

      switch (filterType) {
        case 0: val = raw; break;                               // None
        case 1: val = (raw + a) & 0xFF; break;                  // Sub
        case 2: val = (raw + b) & 0xFF; break;                  // Up
        case 3: val = (raw + ((a + b) >>> 1)) & 0xFF; break;    // Average
        case 4: val = (raw + paeth(a, b, c)) & 0xFF; break;     // Paeth
        default: val = raw;
      }

      // Write decoded byte at the output position (packed, no filter byte)
      bytes[outputOffset + x] = val;
    }

    // Save current decoded row as prev for next iteration
    prev.set(bytes.subarray(outputOffset, outputOffset + rowWidth));
    outputOffset += rowWidth;
  }

  // Return a view of just the decoded data (rows × rowWidth, no filter bytes)
  return bytes.subarray(0, rows * rowWidth);
}

/** Paeth predictor helper */
function paeth(a, b, c) {
  var p = a + b - c;
  var pa = Math.abs(p - a);
  var pb = Math.abs(p - b);
  var pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Pipe a Uint8Array through a web stream transform and collect output.
 * Used by both deflateBytes and inflateBytes.
 *
 * Key fix: if the reader throws AFTER some chunks were already produced
 * (e.g. zlib checksum error at end of valid data), we keep the partial
 * output instead of discarding it. Many Photoshop-created PDFs have
 * valid deflate data but non-standard zlib trailers.
 */
async function pipeStream(input, transformStream) {
  var writer = transformStream.writable.getWriter();
  // Suppress unhandled rejections — errors propagate to the readable side
  writer.write(input).catch(function() {});
  writer.close().catch(function() {});

  var reader = transformStream.readable.getReader();
  var chunks = [];
  try {
    while (true) {
      var result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
    }
  } catch (e) {
    // If we already collected chunks, the decompressed data is likely valid
    // despite a trailing checksum error. Keep what we have.
    if (chunks.length === 0) throw e;
    // Otherwise fall through — use the chunks we got
  }

  var totalLen = 0;
  for (var i = 0; i < chunks.length; i++) totalLen += chunks[i].length;
  var output = new Uint8Array(totalLen);
  var offset = 0;
  for (var i = 0; i < chunks.length; i++) {
    output.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return output;
}

/**
 * Compress a Uint8Array using the native Compression Streams API (zlib).
 * Returns null if CompressionStream is not available.
 */
async function deflateBytes(input) {
  if (typeof CompressionStream === 'undefined') return null;
  return pipeStream(input, new CompressionStream('deflate'));
}

/**
 * Decompress a zlib/Flate-encoded Uint8Array using the native Decompression Streams API.
 * Multiple strategies to handle non-standard zlib streams (common in Photoshop PDFs):
 *   1. Standard zlib ('deflate') — handles checksums via pipeStream's partial-data recovery
 *   2. Strip zlib header + Adler32 checksum, use raw deflate — bypasses all validation
 *   3. Raw deflate as-is — for streams stored without zlib wrapper
 * Returns null if DecompressionStream is not available or all attempts fail.
 */
async function inflateBytes(input) {
  if (typeof DecompressionStream === 'undefined') return null;

  // Try 1: Standard zlib format (pipeStream now recovers partial data on checksum errors)
  try {
    var result = await pipeStream(input, new DecompressionStream('deflate'));
    if (result && result.length > 0) return result;
  } catch (e) { /* try alternatives */ }

  // Try 2: Strip zlib header and checksum, use raw deflate
  // This completely bypasses checksum validation and window-size issues
  if (input.length > 6) {
    var cmf = input[0];
    var flg = input[1];
    // Verify it looks like a zlib header (deflate method, valid FCHECK)
    if ((cmf & 0x0F) === 8 && ((cmf * 256 + flg) % 31 === 0)) {
      var headerSize = 2;
      if (flg & 0x20) headerSize += 4; // FDICT present
      // Strip header and trailing 4-byte Adler32 checksum
      var rawDeflate = input.subarray(headerSize, input.length - 4);
      try {
        var result2 = await pipeStream(rawDeflate, new DecompressionStream('deflate-raw'));
        if (result2 && result2.length > 0) return result2;
      } catch (e) { /* try next */ }

      // Try 2b: strip header only (in case checksum isn't exactly 4 bytes)
      var rawDeflate2 = input.subarray(headerSize);
      try {
        var result3 = await pipeStream(rawDeflate2, new DecompressionStream('deflate-raw'));
        if (result3 && result3.length > 0) return result3;
      } catch (e) { /* try next */ }
    }
  }

  // Try 3: Raw deflate as-is (for streams without zlib wrapper)
  try {
    var result4 = await pipeStream(input, new DecompressionStream('deflate-raw'));
    if (result4 && result4.length > 0) return result4;
  } catch (e) { /* all failed */ }

  return null;
}

/**
 * Parse a JPEG's SOF marker to get the number of colour components.
 * Returns 1 (gray), 3 (YCbCr/RGB), or 4 (CMYK/YCCK).
 */
function getJpegComponentCount(data) {
  // Scan for any SOF marker (FFC0–FFCF, excluding FFC4 DHT and FFC8 JPG)
  for (var i = 0; i < data.length - 10; i++) {
    if (data[i] === 0xFF) {
      var m = data[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8) {
        // SOF found — byte 9 (offset i+9) is Nf (number of components)
        return data[i + 9];
      }
      // Skip over marker segment (length field at i+2)
      if (m !== 0x00 && m !== 0xFF && m !== 0xD0 && m !== 0xD8 && m !== 0xD9
          && !(m >= 0xD0 && m <= 0xD7)) {
        var segLen = (data[i + 2] << 8) | data[i + 3];
        i += 1 + segLen; // skip segment (loop will add 1 more)
      }
    }
  }
  return 3; // default
}

/**
 * Convert CMYK pixel data (stored as RGBA by the browser) to proper RGB.
 * Handles both standard CMYK (0=no ink) and inverted/Adobe CMYK (255=no ink).
 * Modifies the ImageData in-place and sets alpha to 255.
 */
function cmykPixelsToRGB(imageData) {
  var px = imageData.data;

  // Heuristic: sample corners and centre to decide if values are inverted.
  // In standard CMYK, white = (0,0,0,0).  In inverted (Adobe), white = (255,255,255,255).
  // A typical document page is mostly white, so check the average of the K channel.
  var kSum = 0, samples = 0;
  var step = Math.max(4, Math.floor(px.length / 4000) * 4);
  for (var s = 3; s < px.length; s += step) { kSum += px[s]; samples++; }
  var kAvg = kSum / samples;
  // If K averages high (>128), values are likely inverted (Adobe convention)
  var inverted = kAvg > 128;

  for (var i = 0; i < px.length; i += 4) {
    var c = px[i], m = px[i + 1], y = px[i + 2], k = px[i + 3];
    if (inverted) {
      // Inverted Adobe CMYK: 255 = no ink → convert to standard first
      c = 255 - c; m = 255 - m; y = 255 - y; k = 255 - k;
    }
    // Standard CMYK to RGB:  R = (1-C)(1-K)*255
    px[i]     = ((255 - c) * (255 - k) + 127) / 255 | 0; // R
    px[i + 1] = ((255 - m) * (255 - k) + 127) / 255 | 0; // G
    px[i + 2] = ((255 - y) * (255 - k) + 127) / 255 | 0; // B
    px[i + 3] = 255; // opaque
  }
}

/**
 * Check if pixel data is degenerate (all one colour — blank canvas).
 * Returns true if all sampled pixels share the same RGB value (within tolerance).
 */
function isDegeneratePixels(pixels) {
  var pixelCount = pixels.length / 4;
  if (pixelCount === 0) return true;
  var step = Math.max(1, Math.floor(pixelCount / 2000));
  var r0 = pixels[0], g0 = pixels[1], b0 = pixels[2];
  for (var i = 4 * step; i < pixels.length; i += 4 * step) {
    if (Math.abs(pixels[i] - r0) > 3 ||
        Math.abs(pixels[i + 1] - g0) > 3 ||
        Math.abs(pixels[i + 2] - b0) > 3) {
      return false;
    }
  }
  return true;
}

/**
 * Check if canvas pixel data is effectively grayscale (R ≈ G ≈ B).
 * Samples up to 1000 pixels for speed.
 */
function isGrayscalePixels(pixels) {
  var pixelCount = pixels.length / 4;
  var step = Math.max(1, Math.floor(pixelCount / 1000));
  for (var i = 0; i < pixels.length; i += 4 * step) {
    if (Math.abs(pixels[i] - pixels[i + 1]) > 2 ||
        Math.abs(pixels[i] - pixels[i + 2]) > 2) {
      return false;
    }
  }
  return true;
}

/**
 * Extract the gray channel from RGBA pixel data.
 */
function extractGrayChannel(pixels, count) {
  var gray = new Uint8Array(count);
  for (var i = 0; i < count; i++) {
    gray[i] = pixels[i * 4];
  }
  return gray;
}

// ── Core re-encode logic ────────────────────────────────────────────

/**
 * Re-encode a single image in the PDF.
 * Handles TIFF/PNG Predictor in FlateDecode streams.
 * Detects grayscale images and writes them as DeviceGray + FlateDecode.
 * @returns {boolean} true if the image was replaced
 */
async function reencodeImage(pdfDoc, imgInfo, quality, targetDPI, analysis) {
  var PDFName = PDFLib.PDFName;
  var PDFRawStream = PDFLib.PDFRawStream;
  var log = _compressLog;

  // /Matte indicates pre-multiplied alpha — the image itself IS the
  // visible content.  Process it normally (do NOT replace with a stub).

  var obj = pdfDoc.context.lookup(imgInfo.ref);
  if (!obj) { log.push('  lookup(' + imgInfo.ref + ') returned null'); return false; }
  if (!obj.contents) { log.push('  obj has no .contents (type: ' + (obj.constructor ? obj.constructor.name : typeof obj) + ')'); return false; }

  var originalSize = obj.contents.length || obj.contents.byteLength;
  var width = imgInfo.width;
  var height = imgInfo.height;

  log.push('  obj.contents: ' + originalSize + 'b, first4=[' +
    (originalSize > 3 ? [obj.contents[0], obj.contents[1], obj.contents[2], obj.contents[3]].map(function(b) { return '0x' + b.toString(16).padStart(2, '0'); }).join(' ') : 'n/a') + ']');

  // Step 1: Get pixel data on a canvas
  var canvas = document.createElement('canvas');
  var ctx;

  if (imgInfo.isJpeg || imgInfo.filter === 'DCTDecode') {
    // JPEG: decode via <img> element (more robust than createImageBitmap
    // for Photoshop-generated JPEGs with Adobe APP14 markers).
    // Copy bytes to a fresh buffer to avoid ArrayBuffer view issues.
    var jpegCopy = new Uint8Array(obj.contents.length);
    jpegCopy.set(obj.contents);
    var blob = new Blob([jpegCopy], { type: 'image/jpeg' });
    var url = URL.createObjectURL(blob);
    log.push('  JPEG path: <img> decode...');

    try {
      var img = document.createElement('img');
      await new Promise(function(resolve, reject) {
        img.onload = resolve;
        img.onerror = function() { reject(new Error('img decode failed')); };
        img.src = url;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;

      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    } finally {
      URL.revokeObjectURL(url);
    }

    // Spot-check: verify decode produced opaque pixels
    var spot = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
    log.push('  img decoded: ' + width + 'x' + height +
      ' midPixel=rgba(' + spot[0] + ',' + spot[1] + ',' + spot[2] + ',' + spot[3] + ')');

    // If <img> also produces transparent pixels, try createImageBitmap as fallback
    if (spot[3] === 0) {
      log.push('  <img> transparent — trying createImageBitmap fallback...');
      var blob2 = new Blob([jpegCopy], { type: 'image/jpeg' });
      var bitmap = await createImageBitmap(blob2);
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      width = canvas.width;
      height = canvas.height;

      spot = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
      log.push('  bitmap decoded: midPixel=rgba(' + spot[0] + ',' + spot[1] + ',' + spot[2] + ',' + spot[3] + ')');

      // If STILL transparent and 4-component JPEG, try CMYK→RGB conversion
      if (spot[3] === 0) {
        var nComp = getJpegComponentCount(jpegCopy);
        if (nComp === 4) {
          log.push('  4-ch JPEG — converting CMYK→RGB');
          var cmykData = ctx.getImageData(0, 0, width, height);
          cmykPixelsToRGB(cmykData);
          ctx.putImageData(cmykData, 0, 0);
        } else {
          log.push('  JPEG decode failed: all pixels transparent (components=' + nComp + ')');
        }
      }
    }
  } else {
    // FlateDecode or unfiltered: decode the raw stream bytes
    var rawBytes = null;

    // Step A: Try native inflate (multiple strategies for non-standard zlib)
    log.push('  Step A: native inflate...');
    try {
      rawBytes = await inflateBytes(obj.contents);
      log.push('  Step A result: ' + (rawBytes ? rawBytes.length + 'b' : 'null'));
    } catch (e) {
      log.push('  Step A error: ' + (e.message || e));
    }

    // Step B: Fallback to pdf-lib decoder
    if (!rawBytes || rawBytes.length === 0) {
      log.push('  Step B: pdf-lib decodePDFRawStream...');
      try {
        var decoded = PDFLib.decodePDFRawStream(obj);
        rawBytes = decoded.decode();
        if (!(rawBytes instanceof Uint8Array)) rawBytes = new Uint8Array(rawBytes);
        log.push('  Step B result: ' + rawBytes.length + 'b');
      } catch (e) {
        log.push('  Step B error: ' + (e.message || e));
        log.push('  FAILED: cannot decode stream');
        return false;
      }
    }

    if (!(rawBytes instanceof Uint8Array)) rawBytes = new Uint8Array(rawBytes);

    // Step C: Handle DecodeParms with Predictor
    var dp = readDecodeParms(obj.dict, pdfDoc.context);
    log.push('  DecodeParms: ' + (dp ? JSON.stringify(dp) : 'none'));
    if (dp && dp.predictor > 1) {
      var components = dp.colors;
      if (dp.predictor === 2) {
        undoTIFFPredictor(rawBytes, dp.columns, components);
        log.push('  TIFF Predictor 2 undone (cols=' + dp.columns + ' comp=' + components + ')');
      } else if (dp.predictor >= 10 && dp.predictor <= 15) {
        var rowWidth = dp.columns * components;
        rawBytes = undoPNGPredictors(rawBytes, rowWidth, components);
        log.push('  PNG Predictor ' + dp.predictor + ' undone');
      }
    }

    // Step D: Auto-detect component count
    var pixelCount = width * height;
    var channelsIn;
    if (rawBytes.length >= pixelCount * 3 * 0.9 && rawBytes.length <= pixelCount * 3 * 1.1) {
      channelsIn = 3;
    } else if (rawBytes.length >= pixelCount * 0.9 && rawBytes.length <= pixelCount * 1.1) {
      channelsIn = 1;
    } else if (rawBytes.length >= pixelCount * 4 * 0.9 && rawBytes.length <= pixelCount * 4 * 1.1) {
      channelsIn = 4;
    } else {
      log.push('  FAILED: bad decoded size ' + rawBytes.length +
        ' for ' + width + 'x' + height + ' (expected ' + pixelCount * 3 + ' or ' + pixelCount + ' or ' + pixelCount * 4 + ')');
      return false;
    }
    log.push('  channels=' + channelsIn + ', building ImageData ' + width + 'x' + height);

    // Step E: Build ImageData
    var imageData = rawPixelsToImageData(rawBytes, width, height, channelsIn);
    if (!imageData) { log.push('  FAILED: rawPixelsToImageData returned null'); return false; }

    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    log.push('  canvas ready');
  }

  // Step 2: Determine output dimensions (DPI downsampling)
  var outWidth = width;
  var outHeight = height;
  if (targetDPI > 0) {
    var assumedDPI = 300;
    if (width > 1000 || height > 1000) {
      var scale = Math.min(1.0, targetDPI / assumedDPI);
      outWidth = Math.max(1, Math.round(width * scale));
      outHeight = Math.max(1, Math.round(height * scale));
    }
  }
  log.push('  output: ' + outWidth + 'x' + outHeight + (outWidth !== width ? ' (downsampled)' : ''));

  // Step 3: If we need to resize, draw scaled
  var outputCanvas = canvas;
  if (outWidth !== width || outHeight !== height) {
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = outWidth;
    outputCanvas.height = outHeight;
    var outCtx = outputCanvas.getContext('2d');
    outCtx.drawImage(canvas, 0, 0, outWidth, outHeight);
  }

  // Step 4: Validate canvas has actual content (not blank)
  var outCtx2 = outputCanvas.getContext('2d');
  var outPixels = outCtx2.getImageData(0, 0, outWidth, outHeight);

  if (isDegeneratePixels(outPixels.data)) {
    log.push('  SKIPPED: canvas is blank/uniform (decode produced no visible content)');
    cleanupCanvases(canvas, outputCanvas);
    return false;
  }

  // Step 5: Check if image is grayscale and try Flate-gray path
  var isGray = isGrayscalePixels(outPixels.data);
  log.push('  grayscale: ' + isGray);

  var newBytes, newFilter, newColorSpace;

  if (isGray) {
    // Try DeviceGray + FlateDecode (much smaller for mask/layer images)
    var grayData = extractGrayChannel(outPixels.data, outWidth * outHeight);
    var deflated = await deflateBytes(grayData);
    log.push('  gray flate: ' + (deflated ? deflated.length + 'b' : 'null') + ' vs original ' + originalSize + 'b');

    if (deflated && deflated.length < originalSize) {
      // Also try JPEG and pick whichever is smaller
      var jpegBytes = await canvasToJpegBytes(outputCanvas, quality);
      log.push('  gray jpeg: ' + jpegBytes.length + 'b');

      if (deflated.length <= jpegBytes.length) {
        newBytes = deflated;
        newFilter = 'FlateDecode';
        newColorSpace = 'DeviceGray';
      } else if (jpegBytes.length < originalSize) {
        newBytes = jpegBytes;
        newFilter = 'DCTDecode';
        newColorSpace = 'DeviceRGB';
      } else {
        log.push('  SKIPPED: new size >= original');
        cleanupCanvases(canvas, outputCanvas);
        return false;
      }
    } else {
      // Deflate unavailable or not smaller, try JPEG fallback
      var jpegBytes2 = await canvasToJpegBytes(outputCanvas, quality);
      log.push('  gray jpeg fallback: ' + jpegBytes2.length + 'b');
      if (jpegBytes2.length < originalSize) {
        newBytes = jpegBytes2;
        newFilter = 'DCTDecode';
        newColorSpace = 'DeviceRGB';
      } else {
        log.push('  SKIPPED: new size >= original');
        cleanupCanvases(canvas, outputCanvas);
        return false;
      }
    }
  } else {
    // RGB image: use JPEG
    var jpegBytes3 = await canvasToJpegBytes(outputCanvas, quality);
    log.push('  rgb jpeg: ' + jpegBytes3.length + 'b vs original ' + originalSize + 'b');
    if (jpegBytes3.length < originalSize) {
      newBytes = jpegBytes3;
      newFilter = 'DCTDecode';
      newColorSpace = 'DeviceRGB';
    } else {
      log.push('  SKIPPED: new size >= original');
      cleanupCanvases(canvas, outputCanvas);
      return false;
    }
  }
  log.push('  \u2192 ' + newFilter + ' ' + newColorSpace + ' ' + newBytes.length + 'b (was ' + originalSize + 'b)');

  // Cleanup canvases
  cleanupCanvases(canvas, outputCanvas);

  // Step 5: Replace the stream in the PDF
  var newDict = pdfDoc.context.obj({});
  newDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  newDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  newDict.set(PDFName.of('Width'), pdfDoc.context.obj(outWidth));
  newDict.set(PDFName.of('Height'), pdfDoc.context.obj(outHeight));
  newDict.set(PDFName.of('ColorSpace'), PDFName.of(newColorSpace));
  newDict.set(PDFName.of('BitsPerComponent'), pdfDoc.context.obj(8));
  newDict.set(PDFName.of('Filter'), PDFName.of(newFilter));
  newDict.set(PDFName.of('Length'), pdfDoc.context.obj(newBytes.length));

  var newStream = new PDFRawStream(newDict, newBytes);
  pdfDoc.context.assign(imgInfo.ref, newStream);

  return true;
}

/**
 * Free canvas memory.
 */
function cleanupCanvases(canvas, outputCanvas) {
  canvas.width = 1;
  canvas.height = 1;
  if (outputCanvas !== canvas) {
    outputCanvas.width = 1;
    outputCanvas.height = 1;
  }
}

/**
 * Convert raw pixel bytes from a PDF image to an ImageData object.
 * @param {Uint8Array} rawBytes - Decoded pixel data
 * @param {number} width
 * @param {number} height
 * @param {number} channelsIn - 1 (gray), 3 (RGB), or 4 (CMYK/RGBA)
 */
function rawPixelsToImageData(rawBytes, width, height, channelsIn) {
  var pixelCount = width * height;
  var expectedSize = pixelCount * channelsIn;

  if (rawBytes.length < expectedSize * 0.8) {
    return null;
  }

  var pixels = new Uint8ClampedArray(pixelCount * 4);

  for (var i = 0; i < pixelCount; i++) {
    if (channelsIn === 1) {
      var g = rawBytes[i] || 0;
      pixels[i * 4] = g;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = g;
    } else if (channelsIn === 4) {
      // Treat as RGBA (or skip CMYK — filtered earlier)
      pixels[i * 4] = rawBytes[i * 4] || 0;
      pixels[i * 4 + 1] = rawBytes[i * 4 + 1] || 0;
      pixels[i * 4 + 2] = rawBytes[i * 4 + 2] || 0;
    } else {
      pixels[i * 4] = rawBytes[i * 3] || 0;
      pixels[i * 4 + 1] = rawBytes[i * 3 + 1] || 0;
      pixels[i * 4 + 2] = rawBytes[i * 3 + 2] || 0;
    }
    pixels[i * 4 + 3] = 255;
  }

  return new ImageData(pixels, width, height);
}
