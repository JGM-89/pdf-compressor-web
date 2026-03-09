/**
 * PDF analysis — enumerates all objects and categorizes them.
 * Produces the data structure used by the report screen and all compression modes.
 */

/* global PDFLib, yieldToUI, formatBytes */

/**
 * Analyse a PDF file from its raw bytes.
 * @param {Uint8Array} pdfBytes
 * @param {function}   onProgress - callback(fraction, statusText)
 * @returns {Promise<object>} analysis result
 */
async function analyzePDF(pdfBytes, onProgress) {
  var PDFDocument = PDFLib.PDFDocument;
  var PDFName = PDFLib.PDFName;
  var PDFRawStream = PDFLib.PDFRawStream;
  var PDFStream = PDFLib.PDFStream;

  onProgress(0.05, 'Loading PDF\u2026');

  var pdfDoc = await PDFDocument.load(pdfBytes, {
    updateMetadata: false,
    throwOnInvalidObject: false
  });

  var result = {
    pdfDoc: pdfDoc,
    pdfBytes: pdfBytes,
    totalSize: pdfBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    categories: {
      metadata: { size: 0, count: 0 },
      image:    { size: 0, count: 0 },
      font:     { size: 0, count: 0 },
      vector:   { size: 0, count: 0 },
      other:    { size: 0, count: 0 }
    },
    images: [],       // detailed info for each image XObject
    hasText: false
  };

  onProgress(0.1, 'Scanning objects\u2026');

  // Collect all page content stream refs so we can identify them
  var contentStreamRefs = new Set();
  for (var p = 0; p < result.pageCount; p++) {
    try {
      var page = pdfDoc.getPage(p);
      var contentsRef = page.node.get(PDFName.of('Contents'));
      if (contentsRef) {
        collectRefs(contentsRef, contentStreamRefs, pdfDoc.context);
      }
      // Check for fonts on the page
      try {
        var resources = page.node.get(PDFName.of('Resources'));
        if (resources) {
          var resDict = pdfDoc.context.lookup(resources);
          if (resDict && resDict.get && resDict.get(PDFName.of('Font'))) {
            result.hasText = true;
          }
        }
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }

  var indirectObjects = pdfDoc.context.enumerateIndirectObjects();
  var total = indirectObjects.length;
  var i = 0;

  for (var entry of indirectObjects) {
    var ref = entry[0];
    var obj = entry[1];

    classifyObject(pdfDoc, ref, obj, result, contentStreamRefs);

    i++;
    if (i % 200 === 0) {
      onProgress(0.1 + 0.8 * (i / total), 'Scanning objects (' + i + '/' + total + ')\u2026');
      await yieldToUI();
    }
  }

  onProgress(0.95, 'Finalising analysis\u2026');

  return result;
}

/**
 * Recursively collect PDFRef values from a Contents entry
 * (which may be a single ref or an array of refs).
 */
function collectRefs(obj, refSet, context) {
  if (!obj) return;
  // PDFRef has objectNumber and generationNumber properties
  if (typeof obj.objectNumber === 'number') {
    refSet.add(obj.toString());
    var looked = context.lookup(obj);
    // PDFArray has a size() method and get() method
    if (looked && typeof looked.size === 'function' && typeof looked.get === 'function' && !looked.dict) {
      for (var j = 0; j < looked.size(); j++) {
        collectRefs(looked.get(j), refSet, context);
      }
    }
  } else if (obj && typeof obj.size === 'function' && typeof obj.get === 'function' && !obj.dict) {
    // PDFArray
    for (var j = 0; j < obj.size(); j++) {
      collectRefs(obj.get(j), refSet, context);
    }
  }
}

/**
 * Classify a single indirect object into a category.
 */
function classifyObject(pdfDoc, ref, obj, result, contentStreamRefs) {
  var PDFName = PDFLib.PDFName;
  var PDFRawStream = PDFLib.PDFRawStream;

  // Only streams have meaningful size
  var isStream = (obj instanceof PDFRawStream) ||
                 (obj.constructor && obj.constructor.name === 'PDFRawStream') ||
                 (obj.contents !== undefined && obj.dict !== undefined);

  if (!isStream) return;

  var size = 0;
  try {
    if (obj.contents) {
      size = obj.contents.length || obj.contents.byteLength || 0;
    }
  } catch (e) {
    return;
  }

  if (size === 0) return;

  var dict = obj.dict;
  if (!dict || !dict.get) return;

  var type = pdfNameStr(dict.get(PDFName.of('Type')));
  var subtype = pdfNameStr(dict.get(PDFName.of('Subtype')));

  // Metadata streams
  if (type === 'Metadata' || subtype === 'XML') {
    result.categories.metadata.size += size;
    result.categories.metadata.count++;
    return;
  }

  // Image XObjects
  if (subtype === 'Image') {
    result.categories.image.size += size;
    result.categories.image.count++;

    // Collect detailed image info for compression mode
    var filter = dict.get(PDFName.of('Filter'));
    var filterName = pdfNameStr(filter);
    // Handle array filters like [FlateDecode]
    if (!filterName && filter && typeof filter.size === 'function') {
      if (filter.size() > 0) {
        filterName = pdfNameStr(filter.get(0));
      }
    }

    var width = pdfNumberVal(dict.get(PDFName.of('Width')));
    var height = pdfNumberVal(dict.get(PDFName.of('Height')));
    var bpc = pdfNumberVal(dict.get(PDFName.of('BitsPerComponent')));
    var colorSpace = dict.get(PDFName.of('ColorSpace'));
    var csName = pdfNameStr(colorSpace) || '';
    // Handle array color spaces like [ICCBased ref]
    if (!csName && colorSpace && typeof colorSpace.size === 'function' && colorSpace.size() > 0) {
      csName = pdfNameStr(colorSpace.get(0)) || 'Unknown';
    }

    var isMask = false;
    try {
      var maskVal = dict.get(PDFName.of('ImageMask'));
      if (maskVal) {
        // PDFBool has a .value property, or check toString()
        isMask = (maskVal.value === true) || (maskVal.toString() === 'true');
      }
    } catch (e) { /* ignore */ }

    result.images.push({
      ref: ref,
      width: width,
      height: height,
      filter: filterName,
      colorSpace: csName,
      bpc: bpc || 8,
      rawSize: size,
      isJpeg: filterName === 'DCTDecode',
      isMask: isMask
    });
    return;
  }

  // Form XObjects (vector artwork) or page content streams
  if (subtype === 'Form' || contentStreamRefs.has(ref.toString())) {
    result.categories.vector.size += size;
    result.categories.vector.count++;
    return;
  }

  // Font streams
  if (type === 'Font' || subtype === 'Type1' || subtype === 'TrueType' ||
      subtype === 'Type0' || subtype === 'CIDFontType0' || subtype === 'CIDFontType2' ||
      subtype === 'Type1C' || subtype === 'CIDFontType0C' || subtype === 'OpenType') {
    result.categories.font.size += size;
    result.categories.font.count++;
    result.hasText = true;
    return;
  }

  // Check if it's a font descriptor or font program
  if (dict.get(PDFName.of('Length1')) || dict.get(PDFName.of('Length2')) ||
      dict.get(PDFName.of('Length3'))) {
    result.categories.font.size += size;
    result.categories.font.count++;
    result.hasText = true;
    return;
  }

  // Everything else
  result.categories.other.size += size;
  result.categories.other.count++;
}

/**
 * Extract the string value from a PDFName (e.g. "/Image" → "Image").
 * Works with minified pdf-lib where constructor names are mangled.
 */
function pdfNameStr(obj) {
  if (!obj) return '';
  // PDFName objects have an encodedName property like "/Image"
  if (typeof obj.encodedName === 'string') {
    return obj.encodedName.replace(/^\//, '');
  }
  // Fallback: try toString() which returns "/Name"
  var s = obj.toString ? obj.toString() : '';
  if (s.charAt(0) === '/') {
    return s.substring(1);
  }
  return '';
}

/**
 * Extract a number value from a PDF numeric object.
 */
function pdfNumberVal(obj) {
  if (!obj) return 0;
  if (typeof obj === 'number') return obj;
  // PDFNumber: try .value, .numberValue, or parse toString()
  if (obj.value !== undefined) return Number(obj.value);
  if (obj.numberValue !== undefined) return obj.numberValue;
  var s = obj.toString ? obj.toString() : '';
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
