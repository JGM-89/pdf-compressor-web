/* ── Pages Tool — Rotate, Reorder, Remove ──────────────────────────── */

(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────────────────── */
  var state = {
    screen: 'drop',
    pdfBytes: null,
    fileName: '',
    pageCount: 0,
    pages: [],         // { num, rotation, removed, canvas }
    selected: [],      // indices into state.pages
    resultBytes: null,
    resultFilename: ''
  };

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
      var result = await PDFThumbnails.renderAll(state.pdfBytes, 160, function (done, total) {
        var pct = Math.round((done / total) * 100);
        $('loading-progress-fill').style.width = pct + '%';
        $('loading-percent').textContent = pct + '%';
        $('loading-status').textContent = 'Rendering page ' + done + ' of ' + total + '…';
      });

      state.pageCount = result.pageCount;
      state.pages = [];
      state.selected = [];

      for (var i = 0; i < result.pageCount; i++) {
        state.pages.push({
          num: i + 1,
          rotation: 0,
          removed: false,
          canvas: result.canvases[i]
        });
      }

      renderGrid();
      updateActionButtons();
      show('screen-pages');
    } catch (err) {
      alert('Could not read this PDF: ' + err.message);
      show('screen-drop');
    }
  }

  /* ── Thumbnail grid ─────────────────────────────────────────────── */
  function renderGrid() {
    var grid = $('pages-grid');
    grid.innerHTML = '';

    state.pages.forEach(function (pg, idx) {
      var card = document.createElement('div');
      card.className = 'page-card';
      if (pg.removed) card.classList.add('removed');
      if (state.selected.indexOf(idx) !== -1) card.classList.add('selected');
      card.dataset.idx = idx;
      card.draggable = true;

      // Canvas with rotation transform
      var canvasWrap = document.createElement('div');
      canvasWrap.style.overflow = 'hidden';
      var clonedCanvas = pg.canvas.cloneNode(true);
      var ctx = clonedCanvas.getContext('2d');
      clonedCanvas.width = pg.canvas.width;
      clonedCanvas.height = pg.canvas.height;
      ctx.drawImage(pg.canvas, 0, 0);
      if (pg.rotation) {
        clonedCanvas.style.transform = 'rotate(' + pg.rotation + 'deg)';
      }
      card.appendChild(clonedCanvas);

      // Footer
      var footer = document.createElement('div');
      footer.className = 'page-card-footer';

      var label = document.createElement('span');
      label.className = 'page-card-label';
      label.textContent = 'Page ' + pg.num;

      footer.appendChild(label);

      if (pg.rotation) {
        var badge = document.createElement('span');
        badge.className = 'page-rotation-badge';
        badge.textContent = pg.rotation + '°';
        footer.appendChild(badge);
      }

      card.appendChild(footer);

      // Click to select
      card.addEventListener('click', function (e) {
        if (e.shiftKey && state.selected.length > 0) {
          // Shift-click: range select
          var lastIdx = state.selected[state.selected.length - 1];
          var curIdx = idx;
          var low = Math.min(lastIdx, curIdx);
          var high = Math.max(lastIdx, curIdx);
          for (var si = low; si <= high; si++) {
            if (state.selected.indexOf(si) === -1) state.selected.push(si);
          }
        } else if (e.ctrlKey || e.metaKey) {
          // Ctrl-click: toggle
          var pos = state.selected.indexOf(idx);
          if (pos === -1) state.selected.push(idx);
          else state.selected.splice(pos, 1);
        } else {
          // Normal click: solo select
          state.selected = [idx];
        }
        renderGrid();
        updateActionButtons();
      });

      // Drag reorder
      card.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', idx);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('dragging');
        document.querySelectorAll('.page-card.drag-over').forEach(function (c) {
          c.classList.remove('drag-over');
        });
      });
      card.addEventListener('dragover', function (e) {
        e.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', function () {
        card.classList.remove('drag-over');
      });
      card.addEventListener('drop', function (e) {
        e.preventDefault();
        card.classList.remove('drag-over');
        var fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var toIdx = idx;
        if (fromIdx === toIdx) return;

        // Move the page in the array
        var item = state.pages.splice(fromIdx, 1)[0];
        state.pages.splice(toIdx, 0, item);
        state.selected = [toIdx];
        renderGrid();
        updateActionButtons();
      });

      grid.appendChild(card);
    });

    $('page-count-label').textContent = state.pages.filter(function (p) {
      return !p.removed;
    }).length + ' of ' + state.pageCount + ' pages';
  }

  /* ── Action buttons ─────────────────────────────────────────────── */
  function updateActionButtons() {
    var hasSel = state.selected.length > 0;
    var hasRemoved = state.selected.some(function (i) { return state.pages[i].removed; });
    var hasActive = state.selected.some(function (i) { return !state.pages[i].removed; });

    $('btn-rotate-cw').disabled = !hasSel;
    $('btn-rotate-ccw').disabled = !hasSel;
    $('btn-remove').disabled = !hasActive;
    $('btn-restore').disabled = !hasRemoved;

    $('selection-info').textContent = hasSel
      ? state.selected.length + ' selected'
      : 'Click to select, drag to reorder';

    // Save button
    var activeCount = state.pages.filter(function (p) { return !p.removed; }).length;
    $('btn-save').disabled = activeCount === 0;
    $('btn-save').textContent = activeCount > 0
      ? '💾 Save (' + activeCount + ' pages)'
      : 'No pages to save';
  }

  function rotateSelected(deg) {
    state.selected.forEach(function (i) {
      state.pages[i].rotation = (state.pages[i].rotation + deg + 360) % 360;
    });
    renderGrid();
  }

  function removeSelected() {
    state.selected.forEach(function (i) {
      state.pages[i].removed = true;
    });
    renderGrid();
    updateActionButtons();
  }

  function restoreSelected() {
    state.selected.forEach(function (i) {
      state.pages[i].removed = false;
    });
    renderGrid();
    updateActionButtons();
  }

  /* ── Save / build output ────────────────────────────────────────── */
  async function doSave() {
    show('screen-saving');

    try {
      var srcDoc = await PDFLib.PDFDocument.load(state.pdfBytes);
      var newDoc = await PDFLib.PDFDocument.create();

      var activePages = state.pages.filter(function (p) { return !p.removed; });
      var total = activePages.length;

      for (var i = 0; i < total; i++) {
        var pg = activePages[i];
        $('save-status').textContent = 'Processing page ' + (i + 1) + ' of ' + total + '…';
        var pct = Math.round(((i + 1) / total) * 100);
        $('save-progress-fill').style.width = pct + '%';
        $('save-percent').textContent = pct + '%';

        var copied = await newDoc.copyPages(srcDoc, [pg.num - 1]);
        var page = copied[0];

        // Apply rotation
        if (pg.rotation) {
          var current = page.getRotation().angle || 0;
          page.setRotation(PDFLib.degrees(current + pg.rotation));
        }

        newDoc.addPage(page);
      }

      state.resultBytes = await newDoc.save();
      var base = state.fileName.replace(/\.pdf$/i, '');
      state.resultFilename = base + '-edited.pdf';

      // Auto-download
      var blob = new Blob([state.resultBytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = state.resultFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);

      showDone(activePages.length);
    } catch (err) {
      alert('Save failed: ' + err.message);
      show('screen-pages');
    }
  }

  function showDone(pageCount) {
    show('screen-done');
    $('done-filename').textContent = state.resultFilename;
    $('done-page-count').textContent = pageCount;
    $('done-removed').textContent = state.pageCount - pageCount;
    $('done-output-size').textContent = Utils.formatBytes(state.resultBytes.byteLength);
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
      var files = e.dataTransfer.files;
      if (files[0]) handleFile(files[0]);
    });

    // Action buttons
    $('btn-rotate-cw').addEventListener('click', function () { rotateSelected(90); });
    $('btn-rotate-ccw').addEventListener('click', function () { rotateSelected(-90); });
    $('btn-remove').addEventListener('click', removeSelected);
    $('btn-restore').addEventListener('click', restoreSelected);
    $('btn-save').addEventListener('click', doSave);

    // Back / another
    $('btn-back').addEventListener('click', function () { show('screen-drop'); });
    $('btn-another').addEventListener('click', function () {
      state.pdfBytes = null;
      state.resultBytes = null;
      fileInput.value = '';
      show('screen-drop');
    });
    $('btn-download').addEventListener('click', function () {
      if (!state.resultBytes) return;
      var blob = new Blob([state.resultBytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = state.resultFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    });
  }

  init();
})();
