/* global formatBytes */

var QPDFOptimizer = (function() {
  'use strict';

  var modulePromise = null;
  var scriptPromise = null;
  var runId = 0;

  function loadScript() {
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = '/vendor/qpdf.js';
      script.onload = function() { resolve(); };
      script.onerror = function() { reject(new Error('Could not load qpdf optimizer.')); };
      document.head.appendChild(script);
    });
    return scriptPromise;
  }

  function loadModule() {
    if (modulePromise) return modulePromise;
    modulePromise = loadScript().then(function() {
      if (typeof window.Module !== 'function') {
        throw new Error('qpdf optimizer did not initialise.');
      }
      return window.Module({
        locateFile: function(file) {
          return file.endsWith('.wasm') ? '/vendor/qpdf.wasm' : '/vendor/' + file;
        },
        noInitialRun: true,
        print: function() {},
        printErr: function() {}
      });
    });
    return modulePromise;
  }

  function cleanupFS(qpdf, paths) {
    for (var i = 0; i < paths.length; i++) {
      try { qpdf.FS.unlink(paths[i]); } catch (e) { /* ignore */ }
    }
  }

  async function optimize(pdfBytes, onProgress) {
    onProgress(0.05, 'Loading advanced optimizer...');
    var qpdf = await loadModule();

    var id = ++runId;
    var inputPath = '/input-' + id + '.pdf';
    var outputPath = '/output-' + id + '.pdf';

    onProgress(0.2, 'Preparing PDF for qpdf...');
    qpdf.FS.writeFile(inputPath, pdfBytes);

    try {
      onProgress(0.35, 'Optimizing PDF structure...');
      qpdf.callMain([
        inputPath,
        outputPath,
        '--object-streams=generate',
        '--recompress-flate',
        '--compression-level=9',
        '--deterministic-id'
      ]);

      onProgress(0.9, 'Reading optimized PDF...');
      var output = qpdf.FS.readFile(outputPath);
      if (!output || output.byteLength === 0) {
        throw new Error('qpdf did not produce an output PDF.');
      }

      onProgress(1, 'Done');
      return output;
    } finally {
      cleanupFS(qpdf, [inputPath, outputPath]);
    }
  }

  function describeSavings(inputBytes, outputBytes) {
    if (outputBytes >= inputBytes) {
      return 'qpdf output was not smaller (' + formatBytes(outputBytes) + ').';
    }
    return 'qpdf saved ' + formatBytes(inputBytes - outputBytes) + '.';
  }

  return {
    optimize: optimize,
    describeSavings: describeSavings
  };
})();
