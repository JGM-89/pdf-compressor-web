/**
 * Mode 2: Image compression.
 * Re-encodes embedded raster images at lower JPEG quality,
 * optionally downsampling to a target DPI.
 * Grayscale images are detected and written as DeviceGray + FlateDecode
 * for much better compression on mask/layer images from Photoshop.
 * Text, vectors, and fonts are untouched.
 */

/* global PDFLib, yieldToUI, canvasToJpegBytes */

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

  onProgress(0.02, 'Loading PDF\u2026');

  var pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });

  // Filter to compressible images (skip tiny icons and unsupported formats)
  var images = analysis.images.filter(function(img) {
    if (img.width < 8 || img.height < 8) return false;
    // Only handle JPEG and Flate-encoded images
    if (img.filter !== 'DCTDecode' && img.filter !== 'FlateDecode' && img.filter !== '') return false;
    // Skip CMYK (canvas can't handle it correctly)
    if (img.colorSpace === 'DeviceCMYK') return false;
    return true;
  });

  var total = images.length;
  var processed = 0;
  var replaced = 0;

  for (var i = 0; i < total; i++) {
    var imgInfo = images[i];
    onProgress(0.02 + 0.88 * (i / total),
      'Compressing image ' + (i + 1) + '/' + total + '\u2026');

    try {
      var didReplace = await reencodeImage(pdfDoc, imgInfo, quality, targetDPI);
      if (didReplace) replaced++;
    } catch (e) {
      // Skip images that can't be processed
      console.warn('Skipping image:', e.message || e);
    }

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
  }

  onProgress(0.96, 'Saving (' + replaced + ' images compressed)\u2026');

  var resultBytes = await pdfDoc.save();

  onProgress(1.0, 'Done');

  return resultBytes;
}

/**
 * Compress a Uint8Array using the Compression Streams API (zlib/deflate).
 * Falls back to null if CompressionStream is not available.
 * @param {Uint8Array} input - Raw bytes to compress
 * @returns {Promise<Uint8Array|null>} Compressed bytes, or null if unavailable
 */
async function deflateBytes(input) {
  if (typeof CompressionStream === 'undefined') return null;

  var cs = new CompressionStream('deflate');
  var writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();

  var reader = cs.readable.getReader();
  var chunks = [];
  while (true) {
    var result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
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
 * Check if canvas pixel data is effectively grayscale (R ≈ G ≈ B).
 * Samples up to 1000 pixels for speed.
 * @param {Uint8ClampedArray} pixels - RGBA pixel data
 * @returns {boolean}
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
 * @param {Uint8ClampedArray} pixels - RGBA pixel data
 * @param {number} count - Number of pixels
 * @returns {Uint8Array} Single-channel grayscale bytes
 */
function extractGrayChannel(pixels, count) {
  var gray = new Uint8Array(count);
  for (var i = 0; i < count; i++) {
    gray[i] = pixels[i * 4];
  }
  return gray;
}

/**
 * Re-encode a single image in the PDF.
 * Detects grayscale images and writes them as DeviceGray + FlateDecode
 * for dramatically better compression on mask/layer images.
 * @returns {boolean} true if the image was replaced
 */
async function reencodeImage(pdfDoc, imgInfo, quality, targetDPI) {
  var PDFName = PDFLib.PDFName;
  var PDFRawStream = PDFLib.PDFRawStream;

  var obj = pdfDoc.context.lookup(imgInfo.ref);
  if (!obj || !obj.contents) return false;

  var originalSize = obj.contents.length || obj.contents.byteLength;
  var width = imgInfo.width;
  var height = imgInfo.height;

  // Step 1: Get pixel data on a canvas
  var canvas = document.createElement('canvas');
  var ctx;

  if (imgInfo.isJpeg || imgInfo.filter === 'DCTDecode') {
    // JPEG: raw bytes ARE the JPEG file - decode via browser
    var blob = new Blob([obj.contents], { type: 'image/jpeg' });
    var bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;

    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    // FlateDecode or unfiltered: decode the raw stream bytes
    var decoded;
    try {
      decoded = PDFLib.decodePDFRawStream(obj);
      var rawBytes = decoded.decode();
      // rawBytes might be a Uint8Array
      if (!(rawBytes instanceof Uint8Array)) {
        rawBytes = new Uint8Array(rawBytes);
      }
    } catch (e) {
      // If decodePDFRawStream is not available or fails, skip
      return false;
    }

    // Build ImageData from raw pixel bytes
    var imageData = rawPixelsToImageData(rawBytes, width, height, imgInfo.colorSpace, imgInfo.bpc);
    if (!imageData) return false;

    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
  }

  // Step 2: Determine output dimensions (DPI downsampling)
  var outWidth = width;
  var outHeight = height;
  if (targetDPI > 0) {
    // Heuristic: assume most embedded images are ~300 DPI
    // If the image is large enough that it's likely > targetDPI, scale down
    var assumedDPI = 300;
    if (width > 1000 || height > 1000) {
      var scale = Math.min(1.0, targetDPI / assumedDPI);
      outWidth = Math.max(1, Math.round(width * scale));
      outHeight = Math.max(1, Math.round(height * scale));
    }
  }

  // Step 3: If we need to resize, draw scaled
  var outputCanvas = canvas;
  if (outWidth !== width || outHeight !== height) {
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = outWidth;
    outputCanvas.height = outHeight;
    var outCtx = outputCanvas.getContext('2d');
    outCtx.drawImage(canvas, 0, 0, outWidth, outHeight);
  }

  // Step 4: Check if image is grayscale and try Flate-gray path
  var outCtx2 = outputCanvas.getContext('2d');
  var outPixels = outCtx2.getImageData(0, 0, outWidth, outHeight);
  var isGray = isGrayscalePixels(outPixels.data);

  var newBytes, newFilter, newColorSpace;

  if (isGray) {
    // Try DeviceGray + FlateDecode (much smaller for mask/layer images)
    var grayData = extractGrayChannel(outPixels.data, outWidth * outHeight);
    var deflated = await deflateBytes(grayData);

    if (deflated && deflated.length < originalSize) {
      // Also try JPEG and pick whichever is smaller
      var jpegBytes = await canvasToJpegBytes(outputCanvas, quality);

      if (deflated.length <= jpegBytes.length) {
        newBytes = deflated;
        newFilter = 'FlateDecode';
        newColorSpace = 'DeviceGray';
      } else if (jpegBytes.length < originalSize) {
        newBytes = jpegBytes;
        newFilter = 'DCTDecode';
        newColorSpace = 'DeviceRGB';
      } else {
        // Neither is smaller
        cleanupCanvases(canvas, outputCanvas);
        return false;
      }
    } else {
      // Deflate unavailable or not smaller, try JPEG fallback
      var jpegBytes = await canvasToJpegBytes(outputCanvas, quality);
      if (jpegBytes.length < originalSize) {
        newBytes = jpegBytes;
        newFilter = 'DCTDecode';
        newColorSpace = 'DeviceRGB';
      } else {
        cleanupCanvases(canvas, outputCanvas);
        return false;
      }
    }
  } else {
    // RGB image: use JPEG as before
    var jpegBytes = await canvasToJpegBytes(outputCanvas, quality);
    if (jpegBytes.length < originalSize) {
      newBytes = jpegBytes;
      newFilter = 'DCTDecode';
      newColorSpace = 'DeviceRGB';
    } else {
      cleanupCanvases(canvas, outputCanvas);
      return false;
    }
  }

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
 * Handles DeviceRGB and DeviceGray color spaces.
 */
function rawPixelsToImageData(rawBytes, width, height, colorSpace, bpc) {
  var isGray = (colorSpace || '').indexOf('Gray') !== -1;
  var channelsIn = isGray ? 1 : 3;
  var expectedSize = width * height * channelsIn;

  // Sanity check: raw bytes should be approximately the expected size
  if (rawBytes.length < expectedSize * 0.8) {
    return null; // Unexpected format, skip
  }

  var pixels = new Uint8ClampedArray(width * height * 4);

  for (var i = 0; i < width * height; i++) {
    if (isGray) {
      var g = rawBytes[i] || 0;
      pixels[i * 4] = g;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = g;
    } else {
      pixels[i * 4] = rawBytes[i * 3] || 0;
      pixels[i * 4 + 1] = rawBytes[i * 3 + 1] || 0;
      pixels[i * 4 + 2] = rawBytes[i * 3 + 2] || 0;
    }
    pixels[i * 4 + 3] = 255;
  }

  return new ImageData(pixels, width, height);
}
