/* ── OCR Tool ("Make Searchable") ───────────────────────────────────────
 *
 * Renders each page to a canvas with pdf.js, runs Tesseract.js OCR, then
 * overlays an INVISIBLE text layer (render mode 3) on the original pages
 * with pdf-lib. The original page images are preserved untouched — we only
 * add searchable/selectable text on top.
 *
 * The Tesseract.js engine is lazy-loaded from a CDN on first run, so the
 * repo and initial page load stay lean. The user's document never leaves
 * the browser; only the OCR engine is fetched.
 * ──────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────────── */
  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  /* ── State ──────────────────────────────────────────────────────── */
  var state = {
    pdfBytes: null,      // ArrayBuffer of the original PDF
    fileName: '',
    origSize: 0,
    pageCount: 0,
    hasText: false,      // PDF already contains a real text layer
    resultBytes: null,   // Uint8Array of the searchable PDF
    resultName: ''
  };

  var _tesseractPromise = null;

  /* ── DOM refs ───────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  var dropZone  = $('drop-zone');
  var fileInput = $('file-input');

  /* ── Helpers ────────────────────────────────────────────────────── */
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active');
    });
    $(id).classList.add('active');
  }

  function baseName(name) {
    return name.replace(/\.pdf$/i, '');
  }

  function setProgress(fraction, statusText) {
    var pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    $('ocr-progress-fill').style.width = pct + '%';
    $('ocr-percent').textContent = pct + '%';
    if (statusText != null) $('ocr-status').textContent = statusText;
  }

  /* ── Lazy CDN loader for Tesseract.js ───────────────────────────── */
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (_tesseractPromise) return _tesseractPromise;

    _tesseractPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = TESSERACT_CDN;
      script.async = true;
      script.onload = function () {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error('Tesseract loaded but global is missing'));
      };
      script.onerror = function () {
        reject(new Error('Could not download the OCR engine. Check your internet connection and try again.'));
      };
      document.head.appendChild(script);
    });
    return _tesseractPromise;
  }

  /* ── File handling ──────────────────────────────────────────────── */
  function handleFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return;
    if (!Utils.confirmLargePDFWork(file.size, file.name, { renderWarning: true })) return;

    state.fileName = file.name;
    state.origSize = file.size;

    var reader = new FileReader();
    reader.onload = function (e) {
      state.pdfBytes = e.target.result;
      loadPDF();
    };
    reader.readAsArrayBuffer(file);
  }

  async function loadPDF() {
    show('screen-loading');
    $('loading-status').textContent = 'Reading PDF…';
    try {
      var pdfjsLib = await Utils.ensurePDFJS();
      var loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(state.pdfBytes).slice() });
      var doc = await loadingTask.promise;
      state.pageCount = doc.numPages;

      // Probe the first few pages to see if a real text layer already exists.
      state.hasText = false;
      var probePages = Math.min(state.pageCount, 5);
      for (var p = 1; p <= probePages; p++) {
        var page = await doc.getPage(p);
        var content = await page.getTextContent();
        var chars = 0;
        for (var k = 0; k < content.items.length; k++) {
          chars += (content.items[k].str || '').trim().length;
        }
        page.cleanup();
        if (chars > 20) { state.hasText = true; break; }
      }
      doc.destroy();

      showOptions();
    } catch (err) {
      alert('Could not read this PDF: ' + err.message);
      show('screen-drop');
    }
  }

  function showOptions() {
    $('ocr-file-label').textContent =
      state.fileName + ' — ' + state.pageCount +
      (state.pageCount === 1 ? ' page' : ' pages');

    // Note when the document already looks searchable.
    var note = $('ocr-text-note');
    if (state.hasText) {
      note.hidden = false;
    } else {
      note.hidden = true;
    }

    show('screen-options');
  }

  function selectedLang() {
    var sel = $('ocr-lang');
    return sel ? sel.value : 'eng';
  }

  function selectedDpi() {
    var checked = document.querySelector('input[name="ocr-dpi"]:checked');
    return checked ? parseInt(checked.value, 10) : 300;
  }

  /* ── Text sanitising (StandardFont Helvetica is WinAnsi/Latin-1) ── */
  function sanitize(text) {
    if (!text) return '';
    return text
      .replace(/[‘’‚‛]/g, "'")   // smart single quotes
      .replace(/[“”„‟]/g, '"')   // smart double quotes
      .replace(/[–—―]/g, '-')         // en/em dashes
      .replace(/[…]/g, '...')                   // ellipsis
      .replace(/[ ]/g, ' ')                     // nbsp
      // Drop anything outside printable Latin-1; keep selection text simple.
      .replace(/[^\x20-\xFF]/g, '')
      .replace(/[\x7F-\x9F]/g, '');                  // C1 controls undefined in WinAnsi
  }

  /* ── Collect words (with bboxes) from a Tesseract result ─────────── */
  function collectWords(data) {
    if (data.words && data.words.length) return data.words;
    var words = [];
    var blocks = data.blocks || [];
    for (var b = 0; b < blocks.length; b++) {
      var paras = blocks[b].paragraphs || [];
      for (var pa = 0; pa < paras.length; pa++) {
        var lines = paras[pa].lines || [];
        for (var l = 0; l < lines.length; l++) {
          var lw = lines[l].words || [];
          for (var w = 0; w < lw.length; w++) words.push(lw[w]);
        }
      }
    }
    return words;
  }

  /* ── Main OCR pipeline ──────────────────────────────────────────── */
  async function runOCR() {
    show('screen-processing');
    setProgress(0, 'Starting…');

    var lang = selectedLang();
    var dpi = selectedDpi();
    var scale = dpi / 72;
    var worker = null;

    try {
      // 1) Lazy-load the engine.
      setProgress(0.01, 'Downloading the OCR engine (first run only)…');
      var Tesseract = await loadTesseract();

      setProgress(0.03, 'Loading the ' + lang + ' language model…');
      worker = await Tesseract.createWorker(lang, 1, {
        logger: function (m) {
          if (m && m.status === 'recognizing text' && typeof m.progress === 'number') {
            // Inner progress is folded into the per-page band in the loop below.
            var span = 0.75 / Math.max(state.pageCount, 1);
            setProgress(_pageBase + span * m.progress, null);
          }
        }
      });

      // 2) Recognise each page; remember words + the viewport used.
      var pdfjsLib = await Utils.ensurePDFJS();
      var pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(state.pdfBytes).slice() }).promise;
      var pageWords = []; // [{ words, viewport }]

      for (var i = 1; i <= state.pageCount; i++) {
        _pageBase = 0.05 + 0.78 * ((i - 1) / state.pageCount);
        setProgress(_pageBase, 'Reading page ' + i + ' of ' + state.pageCount + '…');

        var page = await pdfJsDoc.getPage(i);
        var viewport = page.getViewport({ scale: scale });

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        var res = await worker.recognize(canvas, {}, { blocks: true });
        pageWords.push({ words: collectWords(res.data), viewport: viewport });

        page.cleanup();
        canvas.width = 1;
        canvas.height = 1;
        await Utils.yieldToUI();
      }
      pdfJsDoc.destroy();

      // 3) Overlay an invisible text layer onto the ORIGINAL pages.
      setProgress(0.85, 'Adding the searchable text layer…');
      var resultBytes = await buildSearchablePDF(pageWords);

      // 4) Done.
      state.resultBytes = resultBytes;
      state.resultName = baseName(state.fileName) + '-searchable.pdf';
      setProgress(1, 'Done');
      await worker.terminate();
      showDone();
    } catch (err) {
      if (worker) { try { await worker.terminate(); } catch (e) {} }
      $('ocr-status').textContent = 'OCR failed: ' + err.message;
      $('ocr-error-back').hidden = false;
    }
  }

  var _pageBase = 0; // current per-page progress base (closure for logger)

  async function buildSearchablePDF(pageWords) {
    var PDFLibRef = window.PDFLib;
    var doc = await PDFLibRef.PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
    var font = await doc.embedFont(PDFLibRef.StandardFonts.Helvetica);
    var pages = doc.getPages();

    for (var i = 0; i < pageWords.length && i < pages.length; i++) {
      var page = pages[i];
      var words = pageWords[i].words;
      var viewport = pageWords[i].viewport;
      if (!words || !words.length) continue;

      // Open an isolated graphics state with invisible text rendering.
      page.pushOperators(
        PDFLibRef.pushGraphicsState(),
        PDFLibRef.setTextRenderingMode(PDFLibRef.TextRenderingMode.Invisible)
      );

      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        var text = sanitize(word.text);
        if (!text.trim()) continue;

        var bbox = word.bbox || word;
        if (bbox.x0 == null) continue;

        // Map the word's baseline corners (bbox bottom edge) into PDF space.
        // convertToPdfPoint accounts for scale AND page rotation, so the
        // derived origin/angle/width are correct for any /Rotate value.
        var pL = viewport.convertToPdfPoint(bbox.x0, bbox.y1);
        var pR = viewport.convertToPdfPoint(bbox.x1, bbox.y1);
        var dx = pR[0] - pL[0];
        var dy = pR[1] - pL[1];
        var widthPt = Math.sqrt(dx * dx + dy * dy);
        if (widthPt < 0.5) continue;

        // Size the font so the text spans the word box horizontally — this
        // makes search/selection highlights line up with the printed word.
        var unitWidth = font.widthOfTextAtSize(text, 1);
        if (!unitWidth || unitWidth <= 0) continue;
        var size = widthPt / unitWidth;
        if (size < 0.5 || size > 1000) continue;

        var angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;

        try {
          page.drawText(text, {
            x: pL[0],
            y: pL[1],
            size: size,
            font: font,
            rotate: PDFLibRef.degrees(angleDeg)
          });
        } catch (e) {
          // Skip any word the standard font can't encode.
        }
      }

      page.pushOperators(PDFLibRef.popGraphicsState());
      if (i % 5 === 0) await Utils.yieldToUI();
    }

    return await doc.save();
  }

  /* ── Done screen ────────────────────────────────────────────────── */
  function showDone() {
    show('screen-done');
    $('done-pages').textContent = state.pageCount + (state.pageCount === 1 ? ' page' : ' pages');
    $('done-orig-size').textContent = Utils.formatBytes(state.origSize);

    // OCR adds an invisible text layer, so the file usually grows a little.
    // That's expected — show the size neutrally rather than as a "warning".
    var newSize = state.resultBytes.byteLength;
    $('done-new-size').textContent = Utils.formatBytes(newSize);

    // Auto-download.
    Utils.downloadBlob(state.resultBytes, state.resultName);
  }

  /* ── Event wiring ───────────────────────────────────────────────── */
  function reset() {
    state.pdfBytes = null;
    state.resultBytes = null;
    fileInput.value = '';
    $('ocr-error-back').hidden = true;
    show('screen-drop');
  }

  function init() {
    dropZone.addEventListener('click', function () { fileInput.click(); });
    dropZone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', function () {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    $('btn-ocr').addEventListener('click', runOCR);
    $('btn-options-back').addEventListener('click', function () { show('screen-drop'); });
    $('ocr-error-back').addEventListener('click', reset);
    $('btn-download').addEventListener('click', function () {
      if (state.resultBytes) Utils.downloadBlob(state.resultBytes, state.resultName);
    });
    $('btn-another').addEventListener('click', reset);
  }

  init();
})();
