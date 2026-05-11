/**
 * Main application controller.
 * Manages UI state, screen transitions, event binding, and
 * coordinates analysis → estimation → compression → download.
 */

/* global PDFLib, Utils, analyzePDF, compress, formatBytes, formatReduction, downloadBlob,
          estimateMetadataSize, estimateImageCompressSize, estimateFlattenSize,
          estimateWasmOptimizerSize, estimateImageCompressPreflight,
          estimateFlattenPreflight, fixedEstimate, formatEstimateRange,
          _compressLog */

(function() {
  'use strict';

  // ── App state ──────────────────────────────────────────────────────

  var state = {
    screen: 'drop',
    filename: null,
    pdfBytes: null,
    analysis: null,
    selectedMode: 'metadata',
    resultBytes: null,
    resultFilename: null,
    compressionDidReduce: true,
    estimates: {},
    preflightCache: {},   // key: 'mode|q|dpi' → estimate result
    preflightTimer: null,
    preflightToken: 0
  };

  var PREFLIGHT_DEBOUNCE_MS = 300;

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
    state.preflightCache = {};
    state.preflightToken++;
    if (state.preflightTimer) { clearTimeout(state.preflightTimer); state.preflightTimer = null; }

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

    Utils.ensurePDFJS().then(function() {
      return analyzePDF(state.pdfBytes, function(fraction, text) {
        $('#analyze-status').textContent = text;
      });
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
    var hasImages = analysis.categories.image.size > 5 * 1024;
    var imageShare = analysis.totalSize > 0 ? analysis.categories.image.size / analysis.totalSize : 0;
    var vectorShare = analysis.totalSize > 0 ?
      (analysis.categories.vector.size + analysis.categories.other.size) / analysis.totalSize : 0;

    // Metadata strip estimate
    var metaKB = estimateMetadataSize(analysis) / 1024;

    // Determine badges
    var bestMode, smallestMode;
    if (hasImages && imageShare >= 0.25) {
      bestMode = 'image-compress';
      smallestMode = vectorShare >= 0.35 ? 'flatten' : null;
    } else if (!hasImages && vectorShare >= 0.45) {
      bestMode = 'flatten';
      smallestMode = null;
    } else {
      bestMode = 'metadata';
      smallestMode = null;
    }

    // Build recommendation text
    var text;
    if (smallestMode === 'flatten') {
      if (bestMode === 'image-compress') {
        text = 'Image compression is the best first try for this file because most of its size is raster images. The estimate is calibrated from sampled images before you run the full compression.';
      } else {
        text = 'Lossless cleanup gives the best lossless result (' + formatBytes(metaKB * 1024) +
          '). For maximum compression, try \'Flatten to images\', but text won\'t be selectable.';
      }
    } else if (bestMode === 'flatten') {
      text = 'Flattening to images is likely to reduce this PDF because it is heavy on vectors or page content. The estimate is calibrated from sampled page renders. Text becomes rasterised.';
    } else if (bestMode === 'image-compress') {
      text = 'Image compression is the best first try for this file because most of its size is raster images. The estimate is calibrated from sampled images. Text and vectors stay untouched.';
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

    var targetInput = $('#target-size-input');
    if (targetInput) {
      targetInput.addEventListener('input', updateTargetGuidance);
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
  //
  // Quick estimates (formulae) update synchronously on every slider tick.
  // Preflights (real sampled compression) are debounced and only fire for
  // the currently selected mode. Results are cached by (mode, q, dpi).

  function updateEstimates() {
    if (!state.analysis) return;
    updateQuickEstimates();
    schedulePreflight();
  }

  function imgSettings() {
    return {
      q: parseInt($('#img-quality-slider').value, 10) || 75,
      dpi: getSelectedDPI('img-dpi')
    };
  }

  function flatSettings() {
    return {
      q: parseInt($('#flatten-quality-slider').value, 10) || 75,
      dpi: getSelectedDPI('flatten-dpi')
    };
  }

  function preflightKey(mode, q, dpi) { return mode + '|' + q + '|' + dpi; }

  function updateQuickEstimates() {
    var a = state.analysis;
    state.estimates = {};

    // Metadata size — always exact
    var metaBytes = estimateMetadataSize(a);
    state.estimates.metadata = fixedEstimate(metaBytes, 'High', 'Exact removable metadata calculation');
    setEstimateText($('#size-metadata'), state.estimates.metadata, a.totalSize);

    // Image-compress: use cached preflight if available, else formula
    var img = imgSettings();
    var imgCached = state.preflightCache[preflightKey('image-compress', img.q, img.dpi)];
    state.estimates['image-compress'] = imgCached || fixedEstimate(
      estimateImageCompressSize(a, img.q, img.dpi),
      'Low', 'Formula estimate'
    );
    setEstimateText($('#size-images'), state.estimates['image-compress'], a.totalSize);

    // Flatten: use cached preflight if available, else formula
    var flat = flatSettings();
    var flatCached = state.preflightCache[preflightKey('flatten', flat.q, flat.dpi)];
    state.estimates.flatten = flatCached || fixedEstimate(
      estimateFlattenSize(a, flat.q, flat.dpi),
      'Low', 'Formula estimate'
    );
    setEstimateText($('#size-flatten'), state.estimates.flatten, a.totalSize);

    state.estimates['wasm-optimize'] = fixedEstimate(
      estimateWasmOptimizerSize(a), 'Low', 'Structural cleanup estimate'
    );
    setEstimateText($('#size-wasm'), state.estimates['wasm-optimize'], a.totalSize);

    updateTargetGuidance();
  }

  function schedulePreflight() {
    if (state.preflightTimer) clearTimeout(state.preflightTimer);
    state.preflightTimer = setTimeout(runSelectedPreflight, PREFLIGHT_DEBOUNCE_MS);
  }

  function runSelectedPreflight() {
    state.preflightTimer = null;
    if (!state.analysis) return;
    var a = state.analysis;
    var mode = state.selectedMode;

    if (mode === 'image-compress' &&
        typeof estimateImageCompressPreflight === 'function' &&
        a.images && a.images.length) {
      var s = imgSettings();
      var key = preflightKey('image-compress', s.q, s.dpi);
      if (state.preflightCache[key]) return;
      var token = ++state.preflightToken;
      $('#size-images').textContent = 'Calibrating...';
      estimateImageCompressPreflight(state.pdfBytes, a, s.q, s.dpi).then(function(result) {
        state.preflightCache[key] = result;
        if (token !== state.preflightToken) return;
        updateQuickEstimates();
      }).catch(function(err) {
        console.warn('Image estimate preflight failed:', err);
        if (token === state.preflightToken) updateQuickEstimates();
      });
      return;
    }

    if (mode === 'flatten' && typeof estimateFlattenPreflight === 'function') {
      var s2 = flatSettings();
      var key2 = preflightKey('flatten', s2.q, s2.dpi);
      if (state.preflightCache[key2]) return;
      var token2 = ++state.preflightToken;
      $('#size-flatten').textContent = 'Calibrating...';
      estimateFlattenPreflight(state.pdfBytes, a, s2.q, s2.dpi).then(function(result) {
        state.preflightCache[key2] = result;
        if (token2 !== state.preflightToken) return;
        updateQuickEstimates();
      }).catch(function(err) {
        console.warn('Flatten estimate preflight failed:', err);
        if (token2 === state.preflightToken) updateQuickEstimates();
      });
    }
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

  function setEstimateText(el, estimate, originalBytes) {
    if (!el) return;
    el.textContent = formatEstimateRange(estimate, originalBytes);
    var cssClass = estimate.estimate < originalBytes ? 'success' :
      (estimate.estimate > originalBytes ? 'warning' : '');
    applySizeColor(el, cssClass);
  }

  function updateTargetGuidance() {
    var el = $('#target-guidance');
    var input = $('#target-size-input');
    if (!el || !input || !state.analysis) return;

    var mb = parseFloat(input.value);
    el.className = 'target-guidance';
    if (!mb || mb <= 0) {
      el.textContent = 'Enter a target if you need the PDF under a specific upload limit.';
      return;
    }

    var targetBytes = mb * 1024 * 1024;
    var modes = [
      { key: 'metadata', label: 'Lossless cleanup' },
      { key: 'image-compress', label: 'Compress images' },
      { key: 'flatten', label: 'Flatten to images' }
    ];

    var best = null;
    var closest = null;
    for (var i = 0; i < modes.length; i++) {
      var est = state.estimates[modes[i].key];
      if (!est) continue;
      var item = { key: modes[i].key, label: modes[i].label, estimate: est };
      if (!closest || est.estimate < closest.estimate.estimate) closest = item;
      if (est.max <= targetBytes) {
        best = item;
        break;
      }
    }

    if (best) {
      el.classList.add('success');
      el.textContent = best.label + ' is likely to meet ' + mb + ' MB (' +
        best.estimate.confidence + ' confidence).';
      selectMode(best.key);
      return;
    }

    if (closest) {
      el.classList.add('warning');
      el.textContent = 'No current setting is likely to reach ' + mb + ' MB. Closest estimate: ' +
        closest.label + ' at ' + formatEstimateRange(closest.estimate, state.analysis.totalSize) + '.';
    }
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
      // Guard: if compression made the file bigger (or barely changed),
      // discard the result and fall back to the original so users aren't
      // offered a larger file for download.
      if (resultBytes.byteLength >= state.pdfBytes.byteLength) {
        state.resultBytes = state.pdfBytes;
        state.resultFilename = state.filename;
        state.compressionDidReduce = false;
      } else {
        state.resultBytes = resultBytes;
        var base = state.filename.replace(/\.pdf$/i, '');
        state.resultFilename = base + '-compressed.pdf';
        state.compressionDidReduce = true;
      }
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
    var reduced = state.compressionDidReduce && newSize < origSize;

    $('#done-filename').textContent = state.resultFilename;
    $('#done-original').textContent = formatBytes(origSize);
    $('#done-compressed').textContent = formatBytes(newSize);

    var reductionEl = $('#done-reduction');
    if (!state.compressionDidReduce) {
      reductionEl.textContent = 'Not smaller';
      reductionEl.className = 'done-value done-value-warning';
    } else if (reduction >= 1) {
      reductionEl.textContent = reduction.toFixed(0) + '%';
      reductionEl.className = 'done-value done-value-success';
    } else {
      reductionEl.textContent = 'No change';
      reductionEl.className = 'done-value done-value-warning';
    }

    // Before/after comparison bar
    updateComparisonBar(origSize, newSize, reduction);

    // Show log button if image compression was used
    var logBtn = $('#btn-view-log');
    if (logBtn) {
      logBtn.hidden = !(typeof _compressLog !== 'undefined' && _compressLog.length > 0);
    }

    var downloadBtn = $('#btn-download');
    if (downloadBtn) {
      if (reduced) {
        downloadBtn.textContent = '\u21a7 Download';
      } else {
        downloadBtn.textContent = 'Download original';
      }
    }

    showScreen('done');

    // Auto-trigger only when the chosen mode actually reduced the file.
    if (reduced) {
      downloadBlob(state.resultBytes, state.resultFilename);
    }
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
    if (!state.compressionDidReduce) {
      savings.innerHTML = '<strong class="warning">No compression possible at these settings</strong>  - this PDF is already well-optimised. Try a different mode or stronger settings.';
    } else if (reduction >= 1) {
      var saved = origSize - newSize;
      savings.innerHTML = 'You saved <strong>' + formatBytes(saved) + '</strong> (' + reduction.toFixed(0) + '% smaller)';
    } else {
      savings.innerHTML = 'File size is about the same  - this PDF was already well-optimised.';
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

    // Logo / title → home
    $('#home-link').addEventListener('click', function() {
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
    state.compressionDidReduce = true;
    state.estimates = {};
    state.preflightCache = {};
    state.preflightToken++;
    if (state.preflightTimer) { clearTimeout(state.preflightTimer); state.preflightTimer = null; }
    if (typeof QPDFOptimizer === 'object' && QPDFOptimizer && typeof QPDFOptimizer.release === 'function') {
      QPDFOptimizer.release();
    }
    var targetInput = $('#target-size-input');
    if (targetInput) targetInput.value = '';
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
