/**
 * Main application controller.
 * Manages UI state, screen transitions, event binding, and
 * coordinates analysis → estimation → compression → download.
 */

/* global PDFLib, analyzePDF, compress, formatBytes, formatReduction, downloadBlob,
          estimateMetadataSize, estimateImageCompressSize, estimateFlattenSize,
          _compressLog */

(function() {
  'use strict';

  // Configure pdf.js worker
  var pdfjsLib = window['pdfjs-dist/build/pdf'];
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // ── App state ──────────────────────────────────────────────────────

  var state = {
    screen: 'drop',
    filename: null,
    pdfBytes: null,
    analysis: null,
    selectedMode: 'metadata',
    resultBytes: null,
    resultFilename: null
  };

  // ── DOM references ─────────────────────────────────────────────────

  var $  = function(sel) { return document.querySelector(sel); };
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
    // Show marketing sections only on the drop screen
    var mktg = document.getElementById('marketing-sections');
    if (mktg) mktg.classList.toggle('hidden', name !== 'drop');
    // Scroll to top
    window.scrollTo(0, 0);
  }

  // ── Drop zone ──────────────────────────────────────────────────────

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
        handleFile(fileInput.files[0]);
        fileInput.value = ''; // reset so same file can be selected again
      }
    });

    // Drag and drop
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
        var file = files[0];
        if (file.name.toLowerCase().endsWith('.pdf')) {
          handleFile(file);
        } else {
          alert('Please drop a PDF file.');
        }
      }
    });

    // Prevent page-level drops from navigating away
    document.addEventListener('dragover', function(e) { e.preventDefault(); });
    document.addEventListener('drop', function(e) { e.preventDefault(); });
  }

  var maxFileSizeMB = 200;

  function initLargeFileButton() {
    var btn = $('#btn-large-file');
    if (!btn) return;
    btn.addEventListener('click', function(e) {
      e.stopPropagation(); // don't trigger file picker on the drop zone
      var ok = confirm(
        'This will remove the file size limit.\n\n' +
        'Very large PDFs may cause your browser to slow down, freeze, or crash ' +
        'because all processing happens in your browser\'s memory.\n\n' +
        'Make sure to save any other work first. Continue?'
      );
      if (ok) {
        maxFileSizeMB = Infinity;
        $('.drop-hint').textContent = 'No file size limit - large files may be slow';
        btn.style.display = 'none';
      }
    });
  }

  function handleFile(file) {
    if (file.size > maxFileSizeMB * 1024 * 1024) {
      alert('File is too large. Maximum size is ' + maxFileSizeMB + ' MB.\n\nUse the "larger file" option below to remove this limit.');
      return;
    }

    state.filename = file.name;

    var reader = new FileReader();
    reader.onload = function() {
      state.pdfBytes = new Uint8Array(reader.result);
      startAnalysis();
    };
    reader.onerror = function() {
      alert('Failed to read file. Please try again.');
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Analysis ───────────────────────────────────────────────────────

  function startAnalysis() {
    showScreen('analyzing');
    $('#analyze-filename').textContent = state.filename;
    $('#analyze-progress-fill').classList.add('indeterminate');
    $('#analyze-progress-fill').style.width = '';

    analyzePDF(state.pdfBytes, function(fraction, text) {
      $('#analyze-status').textContent = text;
    }).then(function(analysis) {
      state.analysis = analysis;
      showReport();
    }).catch(function(err) {
      console.error('Analysis failed:', err);
      alert('Could not process this PDF:\n' + (err.message || err));
      showScreen('drop');
    });
  }

  // ── Report screen ──────────────────────────────────────────────────

  function showReport() {
    var a = state.analysis;

    // File info
    $('#report-filename').textContent = state.filename;
    $('#report-filesize').textContent = formatBytes(a.totalSize);
    $('#report-pages').textContent = a.pageCount + ' page' + (a.pageCount !== 1 ? 's' : '');

    // Build breakdown bar chart
    buildBreakdownChart(a);

    // Compute recommendation
    var rec = computeRecommendation(a);
    $('#recommendation-text').textContent = rec.text;

    // Show/hide badges
    hideBadges();
    if (rec.bestMode === 'metadata') showBadge('metadata', 'recommended');
    if (rec.bestMode === 'image-compress') showBadge('images', 'recommended');
    if (rec.bestMode === 'flatten') showBadge('flatten', 'recommended');
    if (rec.smallestMode === 'flatten') showBadge('flatten-smallest', 'smallest');

    // Show/hide image compress section
    var hasImages = a.categories.image.size > 5 * 1024;
    var imgSection = $('#option-images-section');
    if (hasImages) {
      imgSection.style.display = '';
    } else {
      imgSection.style.display = 'none';
    }

    // Set default selected mode
    selectMode(rec.bestMode);

    // Update estimated sizes
    updateEstimates();

    showScreen('report');
  }

  // ── Breakdown chart ────────────────────────────────────────────────

  var BREAKDOWN_CATEGORIES = [
    { key: 'metadata',  label: 'Duplicate metadata', color: 'var(--color-metadata)' },
    { key: 'photoshop', label: 'Photoshop data',     color: 'var(--color-photoshop)' },
    { key: 'vector',    label: 'Vector artwork',     color: 'var(--color-vector)' },
    { key: 'image',     label: 'Raster images',      color: 'var(--color-image)' },
    { key: 'font',      label: 'Fonts',              color: 'var(--color-font)' },
    { key: 'other',     label: 'Other',              color: 'var(--color-other)' }
  ];

  function buildBreakdownChart(analysis) {
    var bar = $('#breakdown-bar');
    var legend = $('#breakdown-legend');
    bar.innerHTML = '';
    legend.innerHTML = '';

    var total = 0;
    for (var i = 0; i < BREAKDOWN_CATEGORIES.length; i++) {
      total += analysis.categories[BREAKDOWN_CATEGORIES[i].key].size;
    }
    if (total === 0) total = 1;

    for (var i = 0; i < BREAKDOWN_CATEGORIES.length; i++) {
      var cat = BREAKDOWN_CATEGORIES[i];
      var size = analysis.categories[cat.key].size;
      if (size < 5 * 1024) continue; // Skip tiny categories (<5 KB)

      var pct = (size / total) * 100;

      // Bar segment
      var seg = document.createElement('div');
      seg.className = 'breakdown-segment';
      seg.style.width = pct + '%';
      seg.style.background = cat.color;
      bar.appendChild(seg);

      // Legend row
      var row = document.createElement('div');
      row.className = 'breakdown-row';

      row.innerHTML =
        '<div class="breakdown-dot" style="background:' + cat.color + '"></div>' +
        '<span class="breakdown-label">' + cat.label + '</span>' +
        '<div class="breakdown-bar-mini">' +
          '<div class="breakdown-bar-mini-fill" style="width:' + pct + '%;background:' + cat.color + '"></div>' +
        '</div>' +
        '<span class="breakdown-value" style="color:' + cat.color + '">' + formatBytes(size) + '</span>';

      legend.appendChild(row);
    }
  }

  // ── Recommendation logic (matches desktop app) ─────────────────────

  function computeRecommendation(analysis) {
    var origKB = analysis.totalSize / 1024;
    var hasImages = analysis.categories.image.size > 5 * 1024;

    // Metadata strip estimate
    var metaKB = estimateMetadataSize(analysis) / 1024;

    // Quality-best option (preserves text/vectors)
    var qualityBestMode = 'metadata';
    var qualityBestKB = metaKB;

    var imgRecKB, imgMinKB;
    if (hasImages) {
      var imageKB = analysis.categories.image.size / 1024;
      var nonImgKB = Math.max(1, origKB - imageKB);

      // Default: q=75, dpi=150
      var q75 = Math.pow(75 / 95, 0.6);
      var dpi150 = Math.min(1.0, Math.pow(150 / 300, 2));
      imgRecKB = nonImgKB + imageKB * q75 * dpi150;

      // Aggressive: q=20, dpi=96
      var q20 = Math.pow(20 / 95, 0.6);
      var dpi96 = Math.min(1.0, Math.pow(96 / 300, 2));
      imgMinKB = nonImgKB + imageKB * q20 * dpi96;

      if (imgRecKB < qualityBestKB) {
        qualityBestMode = 'image-compress';
        qualityBestKB = imgRecKB;
      }
    }

    // Flatten estimate
    var flattenEstKB = analysis.pageCount * 300;
    var flattenMinKB = analysis.pageCount * 300 * Math.pow(96 / 150, 2) * Math.pow(30 / 75, 0.6);

    // Determine badges
    var bestMode, smallestMode;
    if (!hasImages && flattenEstKB < qualityBestKB) {
      bestMode = 'flatten';
      smallestMode = null;
    } else if (hasImages && flattenEstKB < qualityBestKB) {
      bestMode = qualityBestMode;
      smallestMode = 'flatten';
    } else {
      bestMode = qualityBestMode;
      smallestMode = null;
    }

    // Build recommendation text
    var text;
    if (smallestMode === 'flatten') {
      if (bestMode === 'image-compress') {
        text = 'Image compression at default settings gives ~' + formatBytes(imgRecKB * 1024) +
          ' while keeping text selectable. Adjust quality and DPI for smaller files (down to ~' +
          formatBytes(imgMinKB * 1024) + '). \'Flatten to images\' can reach ~' +
          formatBytes(flattenEstKB * 1024) + ' but text won\'t be selectable.';
      } else {
        text = 'Lossless cleanup gives the best lossless result (' + formatBytes(metaKB * 1024) +
          '). For maximum compression, \'Flatten to images\' can reach ~' +
          formatBytes(flattenEstKB * 1024) + ' but text won\'t be selectable.';
      }
    } else if (bestMode === 'flatten') {
      text = 'Flattening to images at default settings gives ~' + formatBytes(flattenEstKB * 1024) +
        '. Adjust DPI and quality for smaller files (down to ~' +
        formatBytes(flattenMinKB * 1024) + '). Text becomes rasterised.';
    } else if (bestMode === 'image-compress') {
      text = 'Image compression at default settings gives ~' + formatBytes(imgRecKB * 1024) +
        '. Adjust quality and DPI for smaller files (down to ~' +
        formatBytes(imgMinKB * 1024) + '). Text and vectors stay untouched.';
    } else {
      text = 'Lossless cleanup gives the best result (' + formatBytes(metaKB * 1024) + '). ';
      if (!hasImages) {
        text += 'The file has few or no embedded images to compress further.';
      } else {
        text += 'Images are already well-optimised  - re-encoding won\'t save much.';
      }
    }

    return { bestMode: bestMode, smallestMode: smallestMode, text: text };
  }

  // ── Badges ─────────────────────────────────────────────────────────

  function hideBadges() {
    var badges = $$('.badge');
    for (var i = 0; i < badges.length; i++) {
      badges[i].hidden = true;
    }
  }

  function showBadge(id, type) {
    if (id === 'flatten-smallest') {
      var el = $('#badge-flatten-smallest');
      if (el) el.hidden = false;
      return;
    }
    var badge = $('#badge-' + id);
    if (badge) badge.hidden = false;
  }

  // ── Option card selection ──────────────────────────────────────────

  function selectMode(mode) {
    state.selectedMode = mode;

    // Update radio buttons
    var radios = $$('input[name="compress-mode"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = (radios[i].value === mode);
    }

    // Update card styles
    var cards = $$('.option-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].dataset.mode === mode) {
        cards[i].classList.add('selected');
      } else {
        cards[i].classList.remove('selected');
      }
    }
  }

  function initOptionCards() {
    // Click on card to select
    var cards = $$('.option-card');
    for (var i = 0; i < cards.length; i++) {
      (function(card) {
        card.addEventListener('click', function(e) {
          // Don't interfere with slider/input interactions
          if (e.target.tagName === 'INPUT' && e.target.type !== 'radio') return;
          selectMode(card.dataset.mode);
          updateEstimates();
        });
      })(cards[i]);
    }

    // Radio button changes
    var radios = $$('input[name="compress-mode"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener('change', function(e) {
        selectMode(e.target.value);
        updateEstimates();
      });
    }
  }

  // ── Sliders and DPI controls ───────────────────────────────────────

  function initControls() {
    // Image compress quality slider ↔ input sync
    syncSliderInput('img-quality-slider', 'img-quality-input');

    // Flatten quality slider ↔ input sync
    syncSliderInput('flatten-quality-slider', 'flatten-quality-input');

    // DPI radio groups - trigger estimate update
    var dpiRadios = $$('input[name="img-dpi"], input[name="flatten-dpi"]');
    for (var i = 0; i < dpiRadios.length; i++) {
      dpiRadios[i].addEventListener('change', function() {
        updateEstimates();
      });
    }

    // Auto-select card when interacting with its controls
    var imgControls = $('#option-images-section');
    if (imgControls) {
      var inputs = imgControls.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        inputs[i].addEventListener('focus', function() {
          selectMode('image-compress');
          updateEstimates();
        });
      }
    }

    var flattenCard = $$('.option-card[data-mode="flatten"] input');
    for (var i = 0; i < flattenCard.length; i++) {
      flattenCard[i].addEventListener('focus', function() {
        selectMode('flatten');
        updateEstimates();
      });
    }
  }

  function syncSliderInput(sliderId, inputId) {
    var slider = $('#' + sliderId);
    var input = $('#' + inputId);
    if (!slider || !input) return;

    slider.addEventListener('input', function() {
      input.value = slider.value;
      updateEstimates();
    });

    input.addEventListener('input', function() {
      var val = parseInt(input.value, 10);
      var min = parseInt(input.min, 10);
      var max = parseInt(input.max, 10);
      if (!isNaN(val)) {
        val = Math.max(min, Math.min(max, val));
        slider.value = val;
        updateEstimates();
      }
    });

    input.addEventListener('blur', function() {
      var val = parseInt(input.value, 10);
      var min = parseInt(input.min, 10);
      var max = parseInt(input.max, 10);
      if (isNaN(val)) val = 75;
      val = Math.max(min, Math.min(max, val));
      input.value = val;
      slider.value = val;
      updateEstimates();
    });
  }

  // ── Estimate updates ───────────────────────────────────────────────

  function updateEstimates() {
    if (!state.analysis) return;
    var a = state.analysis;

    // Metadata size
    var metaBytes = estimateMetadataSize(a);
    var metaRes = formatReduction(a.totalSize, metaBytes, false);
    $('#size-metadata').textContent = metaRes.text;
    applySizeColor($('#size-metadata'), metaRes.cssClass);

    // Image compress size
    var imgQ = parseInt($('#img-quality-slider').value, 10) || 75;
    var imgDpi = getSelectedDPI('img-dpi');
    var imgBytes = estimateImageCompressSize(a, imgQ, imgDpi);
    var imgRes = formatReduction(a.totalSize, imgBytes, true);
    $('#size-images').textContent = imgRes.text;
    applySizeColor($('#size-images'), imgRes.cssClass);

    // Flatten size
    var flatQ = parseInt($('#flatten-quality-slider').value, 10) || 75;
    var flatDpi = getSelectedDPI('flatten-dpi');
    var flatBytes = estimateFlattenSize(a, flatQ, flatDpi);
    var flatRes = formatReduction(a.totalSize, flatBytes, true);
    $('#size-flatten').textContent = flatRes.text;
    applySizeColor($('#size-flatten'), flatRes.cssClass);
  }

  function getSelectedDPI(name) {
    var radio = $('input[name="' + name + '"]:checked');
    return radio ? parseInt(radio.value, 10) : 150;
  }

  function applySizeColor(el, cssClass) {
    el.style.color = '';
    if (cssClass === 'success') el.style.color = 'var(--success-green)';
    if (cssClass === 'warning') el.style.color = 'var(--warning-amber)';
  }

  // ── Compression ────────────────────────────────────────────────────

  function startCompression() {
    var mode = state.selectedMode;
    var options = {};

    if (mode === 'image-compress') {
      options.quality = parseInt($('#img-quality-slider').value, 10) || 75;
      options.dpi = getSelectedDPI('img-dpi');
    } else if (mode === 'flatten') {
      options.quality = parseInt($('#flatten-quality-slider').value, 10) || 75;
      options.dpi = getSelectedDPI('flatten-dpi');
    }

    showScreen('compressing');
    $('#compress-progress-fill').classList.remove('indeterminate');
    $('#compress-progress-fill').style.width = '0%';
    $('#compress-percent').textContent = '0%';
    $('#compress-status').textContent = 'Starting compression\u2026';

    compress(mode, state.pdfBytes, state.analysis, options, function(fraction, text) {
      var pct = Math.round(fraction * 100);
      $('#compress-progress-fill').style.width = pct + '%';
      $('#compress-percent').textContent = pct + '%';
      $('#compress-status').textContent = text;
    }).then(function(resultBytes) {
      state.resultBytes = resultBytes;
      var base = state.filename.replace(/\.pdf$/i, '');
      state.resultFilename = base + '-compressed.pdf';
      showDone();
    }).catch(function(err) {
      console.error('Compression failed:', err);
      alert('Compression failed:\n' + (err.message || err));
      showScreen('report');
    });
  }

  // ── Done screen ────────────────────────────────────────────────────

  function showDone() {
    var origSize = state.pdfBytes.byteLength;
    var newSize = state.resultBytes.byteLength;
    var reduction = origSize > 0 ? (1 - newSize / origSize) * 100 : 0;

    $('#done-filename').textContent = state.resultFilename;
    $('#done-original').textContent = formatBytes(origSize);
    $('#done-compressed').textContent = formatBytes(newSize);

    var reductionEl = $('#done-reduction');
    if (reduction >= 1) {
      reductionEl.textContent = reduction.toFixed(0) + '%';
      reductionEl.className = 'done-value done-value-success';
    } else if (reduction > -1) {
      reductionEl.textContent = 'No change';
      reductionEl.className = 'done-value done-value-warning';
    } else {
      var increase = Math.abs(reduction).toFixed(0);
      reductionEl.textContent = '\u2191' + increase + '% larger';
      reductionEl.className = 'done-value done-value-warning';
    }

    // Before/after comparison bar
    updateComparisonBar(origSize, newSize, reduction);

    // Show log button if image compression was used
    var logBtn = $('#btn-view-log');
    if (logBtn) {
      logBtn.hidden = !(typeof _compressLog !== 'undefined' && _compressLog.length > 0);
    }

    showScreen('done');

    // Auto-trigger download
    downloadBlob(state.resultBytes, state.resultFilename);
  }

  function updateComparisonBar(origSize, newSize, reduction) {
    var origBar = $('#compare-bar-original');
    var newBar = $('#compare-bar-new');
    var savings = $('#compare-savings');

    if (!origBar || !newBar || !savings) return;

    // Original bar is always 100%
    origBar.style.width = '100%';

    // New bar as percentage of original
    var pct = origSize > 0 ? (newSize / origSize) * 100 : 100;
    pct = Math.min(100, Math.max(0, pct));

    // Reset then animate
    newBar.style.width = '0%';
    setTimeout(function() {
      newBar.style.width = pct + '%';
    }, 100);

    // Color
    newBar.classList.toggle('warning', reduction < 1);

    // Savings text
    if (reduction >= 1) {
      var saved = origSize - newSize;
      savings.innerHTML = 'You saved <strong>' + formatBytes(saved) + '</strong> (' + reduction.toFixed(0) + '% smaller)';
    } else if (reduction > -1) {
      savings.innerHTML = 'File size is about the same  - this PDF was already well-optimised.';
    } else {
      savings.innerHTML = '<strong class="warning">File got larger</strong>  - try a different compression mode.';
    }
  }

  // ── Button bindings ────────────────────────────────────────────────

  function initButtons() {
    // Back button
    $('#btn-back').addEventListener('click', function() {
      resetState();
      showScreen('drop');
    });

    // Compress button
    $('#btn-compress').addEventListener('click', function() {
      startCompression();
    });

    // Download button (done screen)
    $('#btn-download').addEventListener('click', function() {
      if (state.resultBytes) {
        downloadBlob(state.resultBytes, state.resultFilename);
      }
    });

    // Compress another button
    $('#btn-another').addEventListener('click', function() {
      resetState();
      showScreen('drop');
    });

    // View compression log button
    $('#btn-view-log').addEventListener('click', function() {
      if (typeof _compressLog !== 'undefined' && _compressLog.length > 0) {
        var text = _compressLog.join('\n');
        var blob = new Blob([text], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'compression-log.txt';
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  function resetState() {
    state.pdfBytes = null;
    state.analysis = null;
    state.resultBytes = null;
    state.resultFilename = null;
    state.filename = null;
    state.selectedMode = 'metadata';
  }

  // ── Init ───────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function() {
    initDropZone();
    initLargeFileButton();
    initOptionCards();
    initControls();
    initButtons();
  });

})();
