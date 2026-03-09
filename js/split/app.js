/* ── Split PDF Tool ─────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────────────────── */
  var state = {
    screen: 'drop',
    pdfBytes: null,
    fileName: '',
    pageCount: 0,
    mode: 'all',        // 'all' | 'range' | 'pick'
    selectedPages: [],   // 1-based page numbers
    results: []          // { name, bytes, pages }
  };

  /* ── DOM refs ───────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  var dropZone    = $('drop-zone');
  var fileInput   = $('file-input');

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

  /* ── File handling ──────────────────────────────────────────────── */
  function handleFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return;
    state.fileName = file.name;

    var reader = new FileReader();
    reader.onload = function (e) {
      state.pdfBytes = e.target.result;
      loadPDF();
    };
    reader.readAsArrayBuffer(file);
  }

  async function loadPDF() {
    show('screen-loading');
    $('loading-status').textContent = 'Rendering page thumbnails…';

    try {
      var result = await PDFThumbnails.renderAll(state.pdfBytes, 140, function (done, total) {
        var pct = Math.round((done / total) * 100);
        $('loading-progress-fill').style.width = pct + '%';
        $('loading-percent').textContent = pct + '%';
        $('loading-status').textContent = 'Rendering page ' + done + ' of ' + total + '…';
      });

      state.pageCount = result.pageCount;
      state.selectedPages = [];

      $('split-file-label').textContent = state.fileName + ' - ' + state.pageCount + ' pages';
      buildThumbnailGrid(result.canvases);
      setMode('all');
      show('screen-split');
    } catch (err) {
      alert('Could not read this PDF: ' + err.message);
      show('screen-drop');
    }
  }

  /* ── Thumbnail grid (for pick mode) ────────────────────────────── */
  function buildThumbnailGrid(canvases) {
    var grid = $('thumb-grid');
    grid.innerHTML = '';

    canvases.forEach(function (canvas, i) {
      var card = document.createElement('div');
      card.className = 'thumb-card';
      card.dataset.page = i + 1;

      var check = document.createElement('span');
      check.className = 'thumb-check';
      check.textContent = '✓';

      var label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = 'Page ' + (i + 1);

      card.appendChild(check);
      card.appendChild(canvas);
      card.appendChild(label);

      card.addEventListener('click', function () {
        togglePage(i + 1, card);
      });

      grid.appendChild(card);
    });
  }

  function togglePage(num, card) {
    var idx = state.selectedPages.indexOf(num);
    if (idx === -1) {
      state.selectedPages.push(num);
      card.classList.add('selected');
    } else {
      state.selectedPages.splice(idx, 1);
      card.classList.remove('selected');
    }
    updateSplitButton();
  }

  function selectAll() {
    state.selectedPages = [];
    for (var i = 1; i <= state.pageCount; i++) state.selectedPages.push(i);
    refreshPickUI();
  }

  function selectNone() {
    state.selectedPages = [];
    refreshPickUI();
  }

  function selectOdd() {
    state.selectedPages = [];
    for (var i = 1; i <= state.pageCount; i += 2) state.selectedPages.push(i);
    refreshPickUI();
  }

  function selectEven() {
    state.selectedPages = [];
    for (var i = 2; i <= state.pageCount; i += 2) state.selectedPages.push(i);
    refreshPickUI();
  }

  function refreshPickUI() {
    var cards = document.querySelectorAll('.thumb-card');
    cards.forEach(function (card) {
      var pg = parseInt(card.dataset.page, 10);
      if (state.selectedPages.indexOf(pg) !== -1) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
    updateSplitButton();
  }

  /* ── Mode switching ─────────────────────────────────────────────── */
  function setMode(mode) {
    state.mode = mode;

    document.querySelectorAll('.split-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    $('range-section').classList.toggle('hidden', mode !== 'range');
    $('pick-section').classList.toggle('hidden', mode !== 'pick');

    updateSplitButton();
  }

  function updateSplitButton() {
    var btn = $('btn-split');
    if (state.mode === 'all') {
      btn.disabled = false;
      btn.textContent = '✂ Split into ' + state.pageCount + ' files';
    } else if (state.mode === 'range') {
      var ranges = parseRanges($('range-input').value);
      btn.disabled = ranges.length === 0;
      btn.textContent = ranges.length ? '✂ Extract ' + ranges.length + ' range(s)' : 'Enter page ranges';
    } else {
      btn.disabled = state.selectedPages.length === 0;
      btn.textContent = state.selectedPages.length
        ? '✂ Extract ' + state.selectedPages.length + ' page(s)'
        : 'Select pages to extract';
    }
  }

  /* ── Range parsing ──────────────────────────────────────────────── */
  function parseRanges(input) {
    if (!input.trim()) return [];
    var parts = input.split(',');
    var ranges = [];

    for (var p = 0; p < parts.length; p++) {
      var part = parts[p].trim();
      if (!part) continue;

      var match = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (match) {
        var start = parseInt(match[1], 10);
        var end = parseInt(match[2], 10);
        if (start >= 1 && end <= state.pageCount && start <= end) {
          var pages = [];
          for (var i = start; i <= end; i++) pages.push(i);
          ranges.push({ label: start + '-' + end, pages: pages });
        }
      } else {
        var num = parseInt(part, 10);
        if (num >= 1 && num <= state.pageCount) {
          ranges.push({ label: '' + num, pages: [num] });
        }
      }
    }
    return ranges;
  }

  /* ── Split logic ────────────────────────────────────────────────── */
  async function doSplit() {
    show('screen-splitting');
    state.results = [];
    var base = baseName(state.fileName);

    try {
      if (state.mode === 'all') {
        // Split into individual pages
        for (var i = 1; i <= state.pageCount; i++) {
          $('split-status').textContent = 'Extracting page ' + i + ' of ' + state.pageCount + '…';
          var pct = Math.round((i / state.pageCount) * 100);
          $('split-progress-fill').style.width = pct + '%';
          $('split-percent').textContent = pct + '%';

          var bytes = await extractPages([i]);
          state.results.push({
            name: base + '-page' + i + '.pdf',
            bytes: bytes,
            pages: [i]
          });
        }
      } else if (state.mode === 'range') {
        var ranges = parseRanges($('range-input').value);
        for (var r = 0; r < ranges.length; r++) {
          $('split-status').textContent = 'Extracting pages ' + ranges[r].label + '…';
          var pct2 = Math.round(((r + 1) / ranges.length) * 100);
          $('split-progress-fill').style.width = pct2 + '%';
          $('split-percent').textContent = pct2 + '%';

          var bytes2 = await extractPages(ranges[r].pages);
          state.results.push({
            name: base + '-pages' + ranges[r].label + '.pdf',
            bytes: bytes2,
            pages: ranges[r].pages
          });
        }
      } else {
        // Pick mode - extract selected pages into one file
        $('split-status').textContent = 'Extracting ' + state.selectedPages.length + ' pages…';
        $('split-progress-fill').style.width = '50%';
        $('split-percent').textContent = '50%';

        var sorted = state.selectedPages.slice().sort(function (a, b) { return a - b; });
        var bytes3 = await extractPages(sorted);
        var label = sorted.length <= 5
          ? sorted.join(',')
          : sorted[0] + '-' + sorted[sorted.length - 1];
        state.results.push({
          name: base + '-pages' + label + '.pdf',
          bytes: bytes3,
          pages: sorted
        });

        $('split-progress-fill').style.width = '100%';
        $('split-percent').textContent = '100%';
      }

      showResults();
    } catch (err) {
      alert('Split failed: ' + err.message);
      show('screen-split');
    }
  }

  async function extractPages(pageNums) {
    var srcDoc = await PDFLib.PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
    var newDoc = await PDFLib.PDFDocument.create();
    // pdf-lib uses 0-based indices
    var indices = pageNums.map(function (n) { return n - 1; });
    var copied = await newDoc.copyPages(srcDoc, indices);
    copied.forEach(function (page) { newDoc.addPage(page); });
    return await newDoc.save();
  }

  /* ── Results screen ─────────────────────────────────────────────── */
  function showResults() {
    show('screen-done');
    $('done-file-count').textContent = state.results.length + (state.results.length === 1 ? ' file' : ' files');

    var totalPages = 0;
    var totalSize = 0;
    state.results.forEach(function (r) {
      totalPages += r.pages.length;
      totalSize += r.bytes.byteLength;
    });

    $('done-total-pages').textContent = totalPages;
    $('done-total-size').textContent = Utils.formatBytes(totalSize);

    // Build result entries
    var container = $('split-results');
    container.innerHTML = '';

    state.results.forEach(function (r, idx) {
      var entry = document.createElement('div');
      entry.className = 'split-result-entry';

      var info = document.createElement('div');
      var nameEl = document.createElement('div');
      nameEl.className = 'split-result-info';
      nameEl.textContent = r.name;
      var meta = document.createElement('div');
      meta.className = 'split-result-meta';
      meta.textContent = r.pages.length + (r.pages.length === 1 ? ' page' : ' pages') + ' · ' + Utils.formatBytes(r.bytes.byteLength);
      info.appendChild(nameEl);
      info.appendChild(meta);

      var dlBtn = document.createElement('button');
      dlBtn.className = 'split-result-dl';
      dlBtn.textContent = '↓ Download';
      dlBtn.addEventListener('click', function () {
        downloadFile(r.name, r.bytes);
      });

      entry.appendChild(info);
      entry.appendChild(dlBtn);
      container.appendChild(entry);
    });

    // Auto-download if only one file
    if (state.results.length === 1) {
      downloadFile(state.results[0].name, state.results[0].bytes);
    }
  }

  function downloadAll() {
    state.results.forEach(function (r) {
      downloadFile(r.name, r.bytes);
    });
  }

  function downloadFile(name, bytes) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /* ── Event wiring ───────────────────────────────────────────────── */
  function init() {
    // Drop zone
    dropZone.addEventListener('click', function () { fileInput.click(); });
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

    // Mode buttons
    document.querySelectorAll('.split-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.dataset.mode);
      });
    });

    // Range input live update
    $('range-input').addEventListener('input', function () {
      updateSplitButton();
    });

    // Select helpers
    $('sel-all').addEventListener('click', selectAll);
    $('sel-none').addEventListener('click', selectNone);
    $('sel-odd').addEventListener('click', selectOdd);
    $('sel-even').addEventListener('click', selectEven);

    // Split button
    $('btn-split').addEventListener('click', doSplit);

    // Back / Another
    $('btn-back').addEventListener('click', function () {
      show('screen-drop');
    });
    $('btn-another').addEventListener('click', function () {
      state.pdfBytes = null;
      state.results = [];
      fileInput.value = '';
      show('screen-drop');
    });
    $('btn-download-all').addEventListener('click', downloadAll);
  }

  init();
})();
