const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const selectFolderBtn = document.getElementById('select-folder');
const statusEl = document.getElementById('status');
const downloadLink = document.getElementById('download-link');
const photoList = document.getElementById('photo-list');

let map;
let photoSource;
let currentDownloadUrl = null;

initMap();
attachEventListeners();

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [0, 0],
    zoom: 2,
  });

  map.addControl(new maplibregl.NavigationControl());

  map.on('load', () => {
    const initialData = {
      type: 'FeatureCollection',
      features: [],
    };

    map.addSource('photo-points', {
      type: 'geojson',
      data: initialData,
    });

    map.addLayer({
      id: 'photo-points-circle',
      type: 'circle',
      source: 'photo-points',
      paint: {
        'circle-radius': 6,
        'circle-color': '#d946ef',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff',
      },
    });

    map.addLayer({
      id: 'photo-points-symbol',
      type: 'symbol',
      source: 'photo-points',
      layout: {
        'text-field': ['get', 'name'],
        'text-offset': [0, 1.2],
        'text-size': 12,
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#1f2933',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
      },
    });

    photoSource = map.getSource('photo-points');
  });
}

function attachEventListeners() {
  selectFolderBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length === 0) return;
    handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', async (event) => {
    const items = event.dataTransfer.items;
    if (items) {
      const files = await getFilesFromDataTransferItems(items);
      handleFiles(files);
    } else {
      handleFiles(Array.from(event.dataTransfer.files));
    }
  });
}

async function handleFiles(files) {
  resetUI();
  const jpgFiles = files.filter((file) => /jpe?g$/i.test(file.name));

  if (jpgFiles.length === 0) {
    statusEl.textContent = 'No JPG files found in the selection.';
    return;
  }

  statusEl.textContent = 'Reading Exif metadata…';

  const zip = new JSZip();
  const features = [];
  let processedCount = 0;
  let skippedCount = 0;

  for (const file of jpgFiles) {
    try {
      const metadata = await exifr.parse(file, {
        tiff: true,
        ifd0: true,
        exif: true,
        gps: true,
      });

      const latitude = extractLatitude(metadata);
      const longitude = extractLongitude(metadata);

      if (latitude == null || longitude == null) {
        skippedCount += 1;
        appendPhotoListItem({
          name: file.name,
          message: 'Skipped (no GPS metadata)',
          isSkipped: true,
        });
        continue;
      }

      const dataUrl = await fileToDataURL(file);
      const kmlContent = buildKML(file, metadata, dataUrl, latitude, longitude);
      const safeName = `${sanitizeFilename(file.name.replace(/\.[^.]+$/, ''))}.kml`;
      zip.file(safeName, kmlContent);

      appendPhotoListItem({
        name: file.name,
        message: `GPS: ${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`,
        metadata: { ...metadata, latitude, longitude },
      });

      const coordinates = [longitude, latitude];
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          name: file.name,
        },
      });

      processedCount += 1;
    } catch (error) {
      console.error('Failed to parse', file.name, error);
      skippedCount += 1;
      appendPhotoListItem({
        name: file.name,
        message: 'Skipped (could not read metadata)',
        isSkipped: true,
      });
    }
  }

  updateStatus(processedCount, skippedCount);

  if (processedCount === 0) {
    downloadLink.hidden = true;
    return;
  }

  await updateMap(features);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
  }
  const blobUrl = URL.createObjectURL(blob);
  currentDownloadUrl = blobUrl;
  downloadLink.href = blobUrl;
  downloadLink.hidden = false;
  statusEl.textContent += ' KMZ archive is ready to download.';
}

function resetUI() {
  statusEl.textContent = '';
  downloadLink.hidden = true;
  photoList.innerHTML = '';
  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
    currentDownloadUrl = null;
  }
  if (photoSource) {
    photoSource.setData({ type: 'FeatureCollection', features: [] });
  }
}

function appendPhotoListItem({ name, message, isSkipped = false }) {
  const li = document.createElement('li');
  const title = document.createElement('strong');
  title.textContent = name;
  li.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = message;
  li.appendChild(meta);

  if (isSkipped) {
    li.style.opacity = '0.6';
  }

  photoList.appendChild(li);
}

function updateStatus(processed, skipped) {
  const parts = [];
  if (processed > 0) parts.push(`${processed} photo${processed === 1 ? '' : 's'} converted`);
  if (skipped > 0) parts.push(`${skipped} photo${skipped === 1 ? '' : 's'} skipped`);
  if (parts.length === 0) {
    statusEl.textContent = 'Nothing to convert.';
  } else {
    statusEl.textContent = parts.join(' · ');
  }
}

async function updateMap(features) {
  if (!photoSource) return;
  const featureCollection = {
    type: 'FeatureCollection',
    features,
  };
  photoSource.setData(featureCollection);

  if (features.length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    for (const feature of features) {
      bounds.extend(feature.geometry.coordinates);
    }
    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 800 });
  }
}

function buildKML(file, metadata, dataUrl, latitude, longitude) {
  const metadataWithCoordinates = { ...metadata, latitude, longitude };
  const description = buildDescription(metadataWithCoordinates, dataUrl, file.name);
  const altitude = extractAltitude(metadataWithCoordinates) ?? 0;
  const coordinates = `${longitude},${latitude},${altitude}`;
  const name = escapeXML(file.name);

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
    `  <Placemark>\n` +
    `    <name>${name}</name>\n` +
    `    <description><![CDATA[${description}]]></description>\n` +
    `    <Point>\n` +
    `      <coordinates>${coordinates}</coordinates>\n` +
    `    </Point>\n` +
    `  </Placemark>\n` +
    `</kml>`;
}

function buildDescription(metadata, dataUrl, filename) {
  const rows = buildMetadataRows(metadata);
  const tableRows = rows
    .map(
      ({ label, value }) =>
        `<tr><th style="text-align:left;padding:4px 8px;background:#f3f4f6;border:1px solid #d1d5db;">${label}</th>` +
        `<td style="padding:4px 8px;border:1px solid #d1d5db;">${value}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;">
      <h2 style="margin-top:0;">${escapeHTML(filename)}</h2>
      <img src="${dataUrl}" alt="${escapeHTML(filename)}" style="max-width:100%;height:auto;border-radius:8px;margin-bottom:12px;" />
      <table style="border-collapse:collapse;font-size:14px;">${tableRows}</table>
    </div>
  `;
}

function buildMetadataRows(metadata) {
  const rows = [];
  rows.push({ label: 'Latitude', value: formatCoordinate(metadata.latitude) });
  rows.push({ label: 'Longitude', value: formatCoordinate(metadata.longitude) });

  const altitude = extractAltitude(metadata);
  if (altitude != null) {
    const alt = `${Number(altitude).toFixed(2)} m`;
    rows.push({ label: 'Altitude', value: alt });
  }

  const direction = extractDirection(metadata);
  if (direction != null) {
    const directionText = `${Number(direction).toFixed(2)}°`;
    rows.push({ label: 'Direction', value: directionText });
  }

  if (metadata.GPSImgDirectionRef) {
    rows.push({ label: 'Direction Reference', value: escapeHTML(metadata.GPSImgDirectionRef) });
  }

  if (metadata.horizontalAccuracy != null) {
    rows.push({ label: 'Horizontal Accuracy', value: `${Number(metadata.horizontalAccuracy).toFixed(2)} m` });
  } else if (metadata.GPSHPositioningError != null) {
    rows.push({ label: 'Horizontal Accuracy', value: `${Number(metadata.GPSHPositioningError).toFixed(2)} m` });
  }

  if (metadata.Model || metadata.Make) {
    const camera = [metadata.Make, metadata.Model].filter(Boolean).join(' ');
    rows.push({ label: 'Camera', value: escapeHTML(camera) });
  }

  if (metadata.LensModel) {
    rows.push({ label: 'Lens', value: escapeHTML(metadata.LensModel) });
  }

  if (metadata.DateTimeOriginal) {
    rows.push({ label: 'Captured', value: escapeHTML(formatDate(metadata.DateTimeOriginal)) });
  } else if (metadata.CreateDate) {
    rows.push({ label: 'Captured', value: escapeHTML(formatDate(metadata.CreateDate)) });
  }

  if (metadata.GPSDateStamp && metadata.GPSTimeStamp) {
    rows.push({ label: 'GPS Timestamp', value: escapeHTML(formatGPSTimestamp(metadata)) });
  }

  return rows;
}

async function getFilesFromDataTransferItems(items) {
  const files = [];
  const queue = [];

  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      queue.push(entry);
    } else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;
    if (entry.isFile) {
      const file = await getFileFromEntry(entry);
      if (file) files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let entries;
      do {
        entries = await readEntries(reader);
        queue.push(...entries);
      } while (entries.length > 0);
    }
  }

  return files;
}

function readEntries(reader) {
  return new Promise((resolve) => {
    reader.readEntries(
      (entries) => resolve(entries),
      () => resolve([])
    );
  });
}

function getFileFromEntry(entry) {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

function extractLatitude(metadata) {
  if (!metadata) return null;
  if (metadata.latitude != null) return Number(metadata.latitude);
  if (Array.isArray(metadata.GPSLatitude)) {
    return dmsToDecimal(metadata.GPSLatitude, metadata.GPSLatitudeRef);
  }
  return null;
}

function extractLongitude(metadata) {
  if (!metadata) return null;
  if (metadata.longitude != null) return Number(metadata.longitude);
  if (Array.isArray(metadata.GPSLongitude)) {
    return dmsToDecimal(metadata.GPSLongitude, metadata.GPSLongitudeRef);
  }
  return null;
}

function extractAltitude(metadata) {
  if (!metadata) return null;
  if (metadata.altitude != null) return Number(metadata.altitude);
  if (metadata.GPSAltitude != null) {
    const altitude = Number(metadata.GPSAltitude);
    if (metadata.GPSAltitudeRef === 1) {
      return -altitude;
    }
    return altitude;
  }
  return null;
}

function extractDirection(metadata) {
  if (!metadata) return null;
  if (metadata.GPSImgDirection != null) return Number(metadata.GPSImgDirection);
  if (metadata.heading != null) return Number(metadata.heading);
  return null;
}

function dmsToDecimal(dmsArray, ref) {
  if (!Array.isArray(dmsArray) || dmsArray.length < 3) return null;
  const [degrees, minutes, seconds] = dmsArray.map(Number);
  const decimal = degrees + minutes / 60 + seconds / 3600;
  if (ref === 'S' || ref === 'W') {
    return -decimal;
  }
  return decimal;
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function formatDate(dateValue) {
  try {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    if (Number.isNaN(date.getTime())) return String(dateValue);
    return date.toISOString();
  } catch (error) {
    return String(dateValue);
  }
}

function formatGPSTimestamp(metadata) {
  const date = metadata.GPSDateStamp;
  const time = Array.isArray(metadata.GPSTimeStamp)
    ? metadata.GPSTimeStamp.map((component) => component.toString().padStart(2, '0')).join(':')
    : metadata.GPSTimeStamp;
  return `${date} ${time}`;
}

function escapeXML(value) {
  return String(value).replace(/[<>&'\"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return char;
    }
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return char;
    }
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_.]/gi, '_');
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (event) => reject(event);
    reader.readAsDataURL(file);
  });
}
