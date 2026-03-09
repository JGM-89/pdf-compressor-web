# PDF Compressor Web

A free, private PDF toolkit that runs entirely in your browser. Compress, merge, split, manage pages, and password-protect PDFs — no uploads, no servers, no tracking.

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
| **Lossless Cleanup** | Strips metadata (author, title, timestamps, XMP) | None — visually identical |
| **Compress Images** | Re-encodes embedded images at lower JPEG quality and optional DPI reduction | Minimal at default settings |
| **Flatten to Images** | Renders each page as a JPEG image and rebuilds the PDF | Text becomes non-selectable |

## Privacy

Everything runs 100% client-side using JavaScript. No server, no uploads, no tracking. Your PDFs are processed entirely in your browser's memory and never transmitted anywhere.

## Tech

Plain HTML/CSS/JS with no build tools or frameworks. Installable as a PWA for offline use.

- [pdf-lib](https://pdf-lib.js.org/) — PDF parsing, manipulation, and saving
- [pdf.js](https://mozilla.github.io/pdf.js/) — Page rendering and thumbnail generation
- [pdf-lib-with-encrypt](https://www.npmjs.com/package/pdf-lib-with-encrypt) — PDF encryption (protect tool only)
- Canvas API — Image re-encoding and DPI downsampling

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)
