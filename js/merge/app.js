/**
 * Merge PDFs tool controller.
 * Handles multi-file drop, ordering, merging via pdf-lib, and download.
 */

/* global PDFLib, formatBytes, downloadBlob, yieldToUI */

(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────

  var state = {
    screen: 'drop',
    files: [],        // { name, bytes, pageCount, size }
    resultBytes: null,
    resultFilename: null
  };

  // ── DOM helpers ────────────────────────────────────────────────────

  var $ = function(sel) { return document.querySelector(sel); };
  var $$ = function(sel) { return document.querySelectorAll(sel); };

  // ── Screen transitions ─────────────────────────────────────────────

  function showScreen(name) {
    var screens = $$('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('active');
    }
    var target = $('#screen-' + name);
    if (target) target.classList.add('active');
    state.screen = name;
    window.scrollTo(0, 0);
  }

  // ── Drop zone ─────────────────────────────────────────────────────

  function initDropZone() {
    var dropZone = $('#drop-zone');
    var fileInput = $('#file-input');

    dropZone.addEventListener('click', function() {
      fileInput.click();
    });

    dropZone.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', function() {
      if (fileInput.files.length > 0) {
        handleFiles(fileInput.files);
        fileInput.value = '';
      }
    });

    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', function() {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      var files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFiles(files);
      }
    });

    document.addEventListener('dragover', function(e) { e.preventDefault(); });
    document.addEventListener('drop', function(e) { e.preventDefault(); });
  }

  // ── Handle dropped/selected files ──────────────────────────────────

  function handleFiles(fileList) {
    var validFiles = [];
    for (var i = 0; i < fileList.length; i++) {
      if (fileList[i].name.toLowerCase().endsWith('.pdf')) {
        validFiles.push(fileList[i]);
      }
    }

    if (validFiles.length === 0) {
      alert('Please select PDF files.');
      return;
    }

    // Read each file
    var pending = validFiles.length;
    for (var i = 0; i < validFiles.length; i++) {
      (function(file) {
        var reader = new FileReader();
        reader.onload = function() {
          var bytes = new Uint8Array(reader.result);
          // Get page count
          PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function(doc) {
            state.files.push({
              name: file.name,
              bytes: bytes,
              pageCount: doc.getPageCount(),
              size: bytes.byteLength
            });
            pending--;
            if (pending === 0) {
              showFileList();
            }
          }).catch(function(err) {
            console.error('Failed to load ' + file.name, err);
            alert('Could not read ' + file.name + ': ' + (err.message || err));
            pending--;
            if (pending === 0 && state.files.length > 0) {
              showFileList();
            }
          });
        };
        reader.onerror = function() {
          pending--;
          if (pending === 0 && state.files.length > 0) {
            showFileList();
          }
        };
        reader.readAsArrayBuffer(file);
      })(validFiles[i]);
    }
  }

  // ── File list screen ───────────────────────────────────────────────

  function showFileList() {
    showScreen('files');
    renderFileList();
    updateMergeButton();
  }

  function renderFileList() {
    var container = $('#file-list');
    container.innerHTML = '';

    for (var i = 0; i < state.files.length; i++) {
      var file = state.files[i];
      var entry = document.createElement('div');
      entry.className = 'file-entry';
      entry.draggable = true;
      entry.dataset.index = i;

      entry.innerHTML =
        '<span class="file-drag-handle" title="Drag to reorder">&#9776;</span>' +
        '<div class="file-entry-info">' +
          '<div class="file-entry-name">' + escapeHtml(file.name) + '</div>' +
          '<div class="file-entry-meta">' + file.pageCount + ' page' +
            (file.pageCount !== 1 ? 's' : '') + ' &middot; ' + formatBytes(file.size) + '</div>' +
        '</div>' +
        '<button class="file-entry-remove" title="Remove" data-index="' + i + '">&times;</button>';

      container.appendChild(entry);
    }

    // Wire up drag-and-drop reorder
    initDragReorder();

    // Wire up remove buttons
    var removeBtns = $$('.file-entry-remove');
    for (var i = 0; i < removeBtns.length; i++) {
      removeBtns[i].addEventListener('click', function(e) {
        var idx = parseInt(e.target.dataset.index, 10);
        state.files.splice(idx, 1);
        if (state.files.length === 0) {
          showScreen('drop');
        } else {
          renderFileList();
          updateMergeButton();
        }
      });
    }

    updateFileCount();
  }

  function updateFileCount() {
    var totalPages = 0;
    var totalSize = 0;
    for (var i = 0; i < state.files.length; i++) {
      totalPages += state.files[i].pageCount;
      totalSize += state.files[i].size;
    }
    $('#file-count').textContent = state.files.length + ' file' +
      (state.files.length !== 1 ? 's' : '') + ' &middot; ' +
      totalPages + ' total page' + (totalPages !== 1 ? 's' : '') + ' &middot; ' +
      formatBytes(totalSize);
    // Use innerHTML because of the middot entities
    $('#file-count').innerHTML = state.files.length + ' file' +
      (state.files.length !== 1 ? 's' : '') + ' &middot; ' +
      totalPages + ' total page' + (totalPages !== 1 ? 's' : '') + ' &middot; ' +
      formatBytes(totalSize);
  }

  function updateMergeButton() {
    var btn = $('#btn-merge');
    btn.disabled = state.files.length < 2;
    if (state.files.length < 2) {
      btn.textContent = 'Add at least 2 files';
    } else {
      btn.textContent = 'Merge ' + state.files.length + ' PDFs \u2192';
    }
  }

  // ── Drag-and-drop reorder ──────────────────────────────────────────

  var dragSrcIndex = null;

  function initDragReorder() {
    var entries = $$('.file-entry');
    for (var i = 0; i < entries.length; i++) {
      (function(entry) {
        entry.addEventListener('dragstart', function(e) {
          dragSrcIndex = parseInt(entry.dataset.index, 10);
          entry.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', dragSrcIndex);
        });

        entry.addEventListener('dragend', function() {
          entry.classList.remove('dragging');
          // Remove all drag-over styles
          var all = $$('.file-entry');
          for (var j = 0; j < all.length; j++) {
            all[j].classList.remove('drag-over');
          }
        });

        entry.addEventListener('dragover', function(e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          entry.classList.add('drag-over');
        });

        entry.addEventListener('dragleave', function() {
          entry.classList.remove('drag-over');
        });

        entry.addEventListener('drop', function(e) {
          e.preventDefault();
          entry.classList.remove('drag-over');
          var dropIndex = parseInt(entry.dataset.index, 10);
          if (dragSrcIndex !== null && dragSrcIndex !== dropIndex) {
            // Reorder
            var item = state.files.splice(dragSrcIndex, 1)[0];
            state.files.splice(dropIndex, 0, item);
            renderFileList();
            updateMergeButton();
          }
          dragSrcIndex = null;
        });
      })(entries[i]);
    }
  }

  // ── Add more files ─────────────────────────────────────────────────

  function initAddMore() {
    var addBtn = $('#btn-add-more');
    var addInput = $('#file-input-add');

    addBtn.addEventListener('click', function() {
      addInput.click();
    });

    addInput.addEventListener('change', function() {
      if (addInput.files.length > 0) {
        handleFiles(addInput.files);
        addInput.value = '';
      }
    });
  }

  // ── Merge ──────────────────────────────────────────────────────────

  function startMerge() {
    if (state.files.length < 2) return;

    showScreen('merging');
    $('#merge-progress-fill').style.width = '0%';
    $('#merge-percent').textContent = '0%';
    $('#merge-status').textContent = 'Starting merge\u2026';

    doMerge().then(function(resultBytes) {
      state.resultBytes = resultBytes;
      var baseName = state.files[0].name.replace(/\.pdf$/i, '');
      state.resultFilename = baseName + '-merged.pdf';
      showDone();
    }).catch(function(err) {
      console.error('Merge failed:', err);
      alert('Merge failed:\n' + (err.message || err));
      showScreen('files');
    });
  }

  async function doMerge() {
    var targetDoc = await PDFLib.PDFDocument.create();
    var totalPages = 0;
    for (var i = 0; i < state.files.length; i++) {
      totalPages += state.files[i].pageCount;
    }

    var pagesAdded = 0;

    for (var i = 0; i < state.files.length; i++) {
      var file = state.files[i];
      var pct = Math.round((pagesAdded / totalPages) * 100);
      $('#merge-progress-fill').style.width = pct + '%';
      $('#merge-percent').textContent = pct + '%';
      $('#merge-status').textContent = 'Adding ' + file.name + '\u2026';

      var sourceDoc = await PDFLib.PDFDocument.load(file.bytes, { ignoreEncryption: true });
      var indices = sourceDoc.getPageIndices();
      var copiedPages = await targetDoc.copyPages(sourceDoc, indices);

      for (var j = 0; j < copiedPages.length; j++) {
        targetDoc.addPage(copiedPages[j]);
        pagesAdded++;
      }

      await yieldToUI();
    }

    $('#merge-progress-fill').style.width = '95%';
    $('#merge-percent').textContent = '95%';
    $('#merge-status').textContent = 'Saving merged PDF\u2026';

    var resultBytes = await targetDoc.save();

    $('#merge-progress-fill').style.width = '100%';
    $('#merge-percent').textContent = '100%';

    return resultBytes;
  }

  // ── Done screen ────────────────────────────────────────────────────

  function showDone() {
    var totalOrigSize = 0;
    var totalPages = 0;
    for (var i = 0; i < state.files.length; i++) {
      totalOrigSize += state.files[i].size;
      totalPages += state.files[i].pageCount;
    }
    var newSize = state.resultBytes.byteLength;

    $('#done-filename').textContent = state.resultFilename;
    $('#done-files-merged').textContent = state.files.length + ' files';
    $('#done-total-pages').textContent = totalPages + ' pages';
    $('#done-output-size').textContent = formatBytes(newSize);

    showScreen('done');

    // Auto-trigger download
    downloadBlob(state.resultBytes, state.resultFilename);
  }

  // ── Buttons ────────────────────────────────────────────────────────

  function initButtons() {
    $('#btn-merge').addEventListener('click', function() {
      startMerge();
    });

    $('#btn-back').addEventListener('click', function() {
      showScreen('files');
    });

    $('#btn-download').addEventListener('click', function() {
      if (state.resultBytes) {
        downloadBlob(state.resultBytes, state.resultFilename);
      }
    });

    $('#btn-another').addEventListener('click', function() {
      state.files = [];
      state.resultBytes = null;
      state.resultFilename = null;
      showScreen('drop');
    });
  }

  // ── Utility ────────────────────────────────────────────────────────

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Init ───────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function() {
    initDropZone();
    initAddMore();
    initButtons();
  });

})();
