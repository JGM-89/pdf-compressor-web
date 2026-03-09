# PDF Compressor Web

A free, browser-based PDF compressor. All processing happens locally in your browser — your files never leave your machine.

**[Try it live](https://jgm-89.github.io/pdf-compressor-web/)**

## Features

- **Drag-and-drop** — drop a PDF or click to browse
- **Instant analysis** — breaks down file composition (images, fonts, vectors, metadata)
- **Smart recommendations** — suggests the best compression mode for your file
- **Real-time size estimates** — see estimated output size as you adjust settings

## Compression Modes

| Mode | What it does | Quality impact |
|------|-------------|----------------|
| **Lossless Cleanup** | Strips metadata (author, title, timestamps, XMP) | None — visually identical |
| **Compress Images** | Re-encodes embedded images at lower JPEG quality and optional DPI reduction | Minimal at default settings |
| **Flatten to Images** | Renders each page as a JPEG image and rebuilds the PDF | Text becomes non-selectable |

## Privacy

Everything runs 100% client-side using JavaScript. No server, no uploads, no tracking. Your PDFs are processed entirely in your browser's memory and never transmitted anywhere.

## Tech

Plain HTML/CSS/JS with no build tools or frameworks. Uses:
- [pdf-lib](https://pdf-lib.js.org/) — PDF parsing, manipulation, and saving
- [pdf.js](https://mozilla.github.io/pdf.js/) — Page rendering for flatten mode
- Canvas API — Image re-encoding and DPI downsampling

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)
