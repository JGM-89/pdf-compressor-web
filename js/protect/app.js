/* ── Protect / Unlock PDF Tool ──────────────────────────────────────── */

(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────────────────── */
  var state = {
    screen: 'drop',
    mode: 'lock',        // 'lock' | 'unlock'
    pdfBytes: null,
    fileName: '',
    fileSize: 0,
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

  /* ── Mode toggle ────────────────────────────────────────────────── */
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.protect-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    // Update drop zone text
    if (mode === 'lock') {
      $('drop-text').textContent = 'Drop a PDF here or click to browse';
      $('drop-hint').textContent = 'Select a PDF to add password protection';
      $('drop-title').textContent = 'Add password to PDF';
      $('drop-subtitle').textContent = 'Protect a PDF with a password so only authorised users can open it.';
    } else {
      $('drop-text').textContent = 'Drop a password-protected PDF here';
      $('drop-hint').textContent = 'Select an encrypted PDF to remove its password';
      $('drop-title').textContent = 'Remove password from PDF';
      $('drop-subtitle').textContent = 'Unlock a password-protected PDF and save it without encryption.';
    }
  }

  /* ── File handling ──────────────────────────────────────────────── */
  function handleFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return;
    state.fileName = file.name;
    state.fileSize = file.size;

    var reader = new FileReader();
    reader.onload = function (e) {
      state.pdfBytes = e.target.result;

      if (state.mode === 'lock') {
        showLockScreen();
      } else {
        showUnlockScreen();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ── LOCK (add password) ────────────────────────────────────────── */
  function showLockScreen() {
    $('lock-file-name').textContent = state.fileName;
    $('lock-file-meta').textContent = Utils.formatBytes(state.fileSize);
    $('password-field').value = '';
    $('confirm-field').value = '';
    updateStrength('');
    updateLockButton();
    show('screen-lock');
  }

  function updateStrength(pw) {
    var bars = document.querySelectorAll('.strength-bar');
    var label = $('strength-label');

    bars.forEach(function (b) {
      b.className = 'strength-bar';
    });
    label.className = 'strength-label';
    label.textContent = '';

    if (!pw) return;

    var score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    var level = score <= 1 ? 'weak' : score <= 3 ? 'medium' : 'strong';
    var labels = { weak: 'Weak', medium: 'Okay', strong: 'Strong' };

    for (var i = 0; i < Math.min(score, 3); i++) {
      bars[i].classList.add(level);
    }
    // If weak and has at least 1 char, show first bar
    if (score === 0 && pw.length > 0) {
      bars[0].classList.add('weak');
      level = 'weak';
    }

    label.classList.add(level);
    label.textContent = labels[level];
  }

  function updateLockButton() {
    var pw = $('password-field').value;
    var confirm = $('confirm-field').value;
    var btn = $('btn-lock');

    if (!pw) {
      btn.disabled = true;
      btn.textContent = 'Enter a password';
    } else if (pw !== confirm) {
      btn.disabled = true;
      btn.textContent = 'Passwords don\'t match';
    } else {
      btn.disabled = false;
      btn.textContent = '🔒 Protect PDF';
    }
  }

  async function doLock() {
    var password = $('password-field').value;
    if (!password) return;

    show('screen-processing');
    $('process-status').textContent = 'Encrypting PDF…';
    $('process-progress-fill').style.width = '30%';
    $('process-percent').textContent = '30%';

    try {
      // Use the encryption-capable fork of pdf-lib
      var pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes, {
        ignoreEncryption: true
      });

      $('process-progress-fill').style.width = '60%';
      $('process-percent').textContent = '60%';

      // Encrypt with the password
      pdfDoc.encrypt({
        userPassword: password,
        ownerPassword: password,
        permissions: {
          printing: 'highQuality',
          modifying: false,
          copying: false,
          annotating: false,
          fillingForms: true,
          contentAccessibility: true,
          documentAssembly: false
        }
      });

      $('process-progress-fill').style.width = '80%';
      $('process-percent').textContent = '80%';

      state.resultBytes = await pdfDoc.save();
      var base = state.fileName.replace(/\.pdf$/i, '');
      state.resultFilename = base + '-protected.pdf';

      $('process-progress-fill').style.width = '100%';
      $('process-percent').textContent = '100%';

      // Auto-download
      downloadResult();
      showDone('protected');

    } catch (err) {
      alert('Encryption failed: ' + err.message);
      showLockScreen();
    }
  }

  /* ── UNLOCK (remove password) ───────────────────────────────────── */
  function showUnlockScreen() {
    $('unlock-file-name').textContent = state.fileName;
    $('unlock-file-meta').textContent = Utils.formatBytes(state.fileSize);
    $('unlock-password').value = '';
    show('screen-unlock');
  }

  async function doUnlock() {
    var password = $('unlock-password').value;

    show('screen-processing');
    $('process-status').textContent = 'Decrypting PDF…';
    $('process-progress-fill').style.width = '10%';
    $('process-percent').textContent = '10%';

    try {
      // Set up pdf.js worker
      if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      // Load with pdf.js using the password
      var loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(state.pdfBytes),
        password: password
      });

      var pdfJsDoc = await loadingTask.promise;
      var totalPages = pdfJsDoc.numPages;

      $('process-status').textContent = 'Rebuilding PDF without encryption…';
      $('process-progress-fill').style.width = '20%';
      $('process-percent').textContent = '20%';

      // Render each page to canvas and rebuild with pdf-lib
      var newDoc = await PDFLib.PDFDocument.create();

      for (var i = 1; i <= totalPages; i++) {
        $('process-status').textContent = 'Processing page ' + i + ' of ' + totalPages + '…';
        var pct = 20 + Math.round((i / totalPages) * 70);
        $('process-progress-fill').style.width = pct + '%';
        $('process-percent').textContent = pct + '%';

        var page = await pdfJsDoc.getPage(i);
        var vp = page.getViewport({ scale: 2 }); // Higher quality

        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        var ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        // Convert to JPEG and embed in new doc
        var imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        var imgBytes = dataUrlToBytes(imgDataUrl);
        var img = await newDoc.embedJpg(imgBytes);

        var newPage = newDoc.addPage([img.width / 2, img.height / 2]);
        newPage.drawImage(img, {
          x: 0,
          y: 0,
          width: img.width / 2,
          height: img.height / 2
        });
      }

      $('process-progress-fill').style.width = '95%';
      $('process-percent').textContent = '95%';

      state.resultBytes = await newDoc.save();
      var base = state.fileName.replace(/\.pdf$/i, '');
      state.resultFilename = base + '-unlocked.pdf';

      $('process-progress-fill').style.width = '100%';
      $('process-percent').textContent = '100%';

      downloadResult();
      showDone('unlocked');

    } catch (err) {
      if (err.name === 'PasswordException' || (err.message && err.message.indexOf('password') !== -1)) {
        alert('Incorrect password. Please try again.');
        showUnlockScreen();
      } else {
        alert('Unlock failed: ' + err.message);
        showUnlockScreen();
      }
    }
  }

  function dataUrlToBytes(dataUrl) {
    var base64 = dataUrl.split(',')[1];
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /* ── Done screen ────────────────────────────────────────────────── */
  function showDone(action) {
    show('screen-done');
    $('done-action').textContent = action === 'protected' ? 'Protected!' : 'Unlocked!';
    $('done-filename').textContent = state.resultFilename;
    $('done-original-size').textContent = Utils.formatBytes(state.fileSize);
    $('done-output-size').textContent = Utils.formatBytes(state.resultBytes.byteLength);

    if (action === 'unlocked') {
      $('done-note').textContent = 'Note: Text may no longer be selectable in the unlocked file.';
      $('done-note').style.display = 'block';
    } else {
      $('done-note').style.display = 'none';
    }
  }

  function downloadResult() {
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
  }

  /* ── Password visibility toggle ─────────────────────────────────── */
  function toggleVisibility(inputId, btn) {
    var input = $(inputId);
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🔒';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
    }
  }

  /* ── Event wiring ───────────────────────────────────────────────── */
  function init() {
    // Mode buttons
    document.querySelectorAll('.protect-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
    });

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

    // Lock screen
    $('password-field').addEventListener('input', function () {
      updateStrength(this.value);
      updateLockButton();
    });
    $('confirm-field').addEventListener('input', updateLockButton);
    $('btn-lock').addEventListener('click', doLock);
    $('toggle-pw').addEventListener('click', function () {
      toggleVisibility('password-field', this);
    });
    $('toggle-confirm').addEventListener('click', function () {
      toggleVisibility('confirm-field', this);
    });

    // Unlock screen
    $('btn-unlock').addEventListener('click', doUnlock);
    $('toggle-unlock-pw').addEventListener('click', function () {
      toggleVisibility('unlock-password', this);
    });

    // Back buttons
    $('btn-back-lock').addEventListener('click', function () { show('screen-drop'); });
    $('btn-back-unlock').addEventListener('click', function () { show('screen-drop'); });

    // Done screen
    $('btn-download').addEventListener('click', downloadResult);
    $('btn-another').addEventListener('click', function () {
      state.pdfBytes = null;
      state.resultBytes = null;
      fileInput.value = '';
      show('screen-drop');
    });
  }

  init();
})();
