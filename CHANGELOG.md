# Changelog

## v1.1.0 - 2026-03-09

Major compression improvements for Photoshop-created PDFs.

### New features
- **Photoshop bloat detection** - Breakdown chart now shows Photoshop data (8BIM resource blocks) as a separate category
- **Lossless Photoshop strip** - Lossless cleanup mode removes Photoshop data blocks (layer data, edit history) with zero quality loss
- **Compression log** - "View compression log" button on the done screen downloads a detailed text file showing exactly what happened to each image
- **Home link** - Clicking the "PDF Compressor Web" title returns to the start screen from any page

### Compression improvements
- **FlateDecode image support** - Images compressed with FlateDecode (common in Photoshop PDFs) are now properly decompressed and re-encoded
- **TIFF/PNG Predictor handling** - Correctly undoes TIFF Predictor 2 and PNG Predictors (types 10-15) in FlateDecode image streams
- **Grayscale optimisation** - Detects grayscale images and writes them as DeviceGray + FlateDecode instead of RGB JPEG, dramatically reducing mask/layer image sizes
- **Photoshop composite stubbing** - Redundant full-page composite images (with /Matte pre-multiplied alpha) are replaced with 1x1 pixel stubs, saving hundreds of KB
- **Native inflate** - Uses browser DecompressionStream API with multiple fallback strategies for non-standard zlib streams

### Bug fixes
- **Fixed NaN image dimensions** - pdf-lib's minified UMD build exposes PDFNumber.value as a method, not a property. All image width/height reads now handle both forms.
- **Fixed indirect reference resolution** - PDF objects storing /Type and /Subtype as indirect references are now properly dereferenced during analysis

## v1.0.0 - 2026-01-12

Initial release.

- Three compression modes: lossless cleanup, compress images, flatten to images
- Drag-and-drop file selection
- Real-time size estimates with quality and DPI controls
- Smart recommendation engine
- File breakdown chart showing what's taking up space
- 100% client-side - no uploads, no tracking
- Disclaimer footer and large file override option
