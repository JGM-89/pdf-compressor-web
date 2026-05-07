# PDF Compressor Web

A free, private PDF toolkit that runs entirely in your browser. Compress, merge, split, manage pages, and password-protect PDFs  - no uploads, no servers, no tracking.

**[Try it live at pdf-compressor.org](https://pdf-compressor.org/)**

## Tools

| Tool | URL | What it does |
|------|-----|-------------|
| **Compress** | [/](https://pdf-compressor.org/) | Reduce PDF file size with three compression modes |
| **Merge** | [/merge/](https://pdf-compressor.org/merge/) | Combine multiple PDFs into one, with drag-to-reorder |
| **Split** | [/split/](https://pdf-compressor.org/split/) | Extract pages by range, split every N pages, or pick individual pages |
| **Pages** | [/pages/](https://pdf-compressor.org/pages/) | Rotate, reorder, and remove pages with a visual thumbnail grid |
| **Protect** | [/protect/](https://pdf-compressor.org/protect/) | Add or remove password protection |

## Compression Modes

| Mode | What it does | Quality impact |
|------|-------------|----------------|
| **Lossless Cleanup** | Strips metadata, XMP, and Photoshop bloat (8BIM resource blocks) | None - visually identical |
| **Compress Images** | Re-encodes images at lower JPEG quality and DPI. Handles FlateDecode, TIFF/PNG Predictors, grayscale optimisation, and Photoshop composite stubbing. | Minimal at default settings |
| **Flatten to Images** | Renders each page as a JPEG image and rebuilds the PDF | Text becomes non-selectable |
| **Advanced Optimizer** | Uses qpdf WebAssembly to repack object streams and recompress PDF structure | None intended - preserves document content |

## Privacy & Security

Everything runs 100% client-side using JavaScript. No server, no uploads, no tracking. Your PDFs are processed entirely in your browser's memory and never transmitted anywhere.

Third-party PDF libraries are pinned through npm and vendored into the site, so the app does not need to execute PDF tooling code from external CDNs at runtime.

## Tech

Plain HTML/CSS/JS with a small npm vendor step for pinned PDF libraries. Installable as a PWA for offline use after the first load.

| Library | License | Used for |
|---------|---------|----------|
| [pdf-lib](https://pdf-lib.js.org/) v1.17.1 | MIT | PDF parsing, manipulation, and saving |
| [pdf.js](https://mozilla.github.io/pdf.js/) v5.7.284 | Apache 2.0 | Page rendering and thumbnail generation |
| [pdf-lib-with-encrypt](https://www.npmjs.com/package/pdf-lib-with-encrypt) v1.2.1 | MIT | PDF encryption (protect tool only) |
| [qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm) v0.3.0 | ISC | Advanced structural PDF optimisation |

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Development

Install dependencies and refresh vendored browser assets:

```bash
npm install
npm run vendor
```

## License

[MIT](LICENSE)
