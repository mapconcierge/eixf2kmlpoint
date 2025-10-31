# Exif-to-KML Converter

A browser-based tool that converts JPG photos with embedded GPS Exif metadata into individual KML Point files, bundles them into a KMZ archive, and previews the locations on a MapLibre GL JS map.

## Features

- Drag-and-drop or folder selection for JPG photos.
- Exif parsing (via [exifr](https://github.com/MikeKovarik/exifr)) with automatic skipping of photos that lack GPS coordinates.
- Generates one KML file per geotagged photo with:
  - Point geometry populated with GPS coordinates.
  - HTML description that embeds the photo and a table of key spatial metadata.
- Packages all generated KML files into a downloadable KMZ archive (via [JSZip](https://stuk.github.io/jszip/)).
- Interactive map preview powered by [MapLibre GL JS](https://maplibre.org/) using the Liberty basemap from OpenFreeMap.

## Getting Started

1. Serve the repository as static files (for example with `python -m http.server`) or open `index.html` directly in a modern browser.
2. Drag and drop a folder of JPG files (or use the **Select folder** button).
3. After processing, download the generated `photos.kmz` archive and inspect the points on the built-in map preview.

## Tech Stack

- Vanilla JavaScript, HTML, and CSS
- [exifr](https://github.com/MikeKovarik/exifr) for Exif metadata parsing
- [JSZip](https://stuk.github.io/jszip/) for KMZ packaging
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js-docs/) for visualization

## License

This project is released under the [MIT License](LICENSE).
