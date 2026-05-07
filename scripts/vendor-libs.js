const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'vendor');

const files = [
  {
    from: path.join(root, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js'),
    to: path.join(vendorDir, 'pdf-lib.min.js')
  },
  {
    from: path.join(root, 'node_modules', 'pdf-lib-with-encrypt', 'dist', 'pdf-lib.min.js'),
    to: path.join(vendorDir, 'pdf-lib-with-encrypt.min.js')
  },
  {
    from: path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs'),
    to: path.join(vendorDir, 'pdf.min.mjs')
  },
  {
    from: path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
    to: path.join(vendorDir, 'pdf.worker.min.mjs')
  },
  {
    from: path.join(root, 'node_modules', '@neslinesli93', 'qpdf-wasm', 'dist', 'qpdf.js'),
    to: path.join(vendorDir, 'qpdf.js')
  },
  {
    from: path.join(root, 'node_modules', '@neslinesli93', 'qpdf-wasm', 'dist', 'qpdf.wasm'),
    to: path.join(vendorDir, 'qpdf.wasm')
  }
];

fs.mkdirSync(vendorDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(file.from, file.to);
  console.log(`${path.relative(root, file.from)} -> ${path.relative(root, file.to)}`);
}
