(function() {
  'use strict';

  window.PDFJS_READY = import('/vendor/pdf.min.mjs').then(function(pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
    window.pdfjsLib = pdfjsLib;
    window['pdfjs-dist/build/pdf'] = pdfjsLib;
    return pdfjsLib;
  }).catch(function(err) {
    console.error('Failed to load pdf.js:', err);
    throw err;
  });
})();
