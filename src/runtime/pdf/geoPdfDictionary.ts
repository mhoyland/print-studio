// Builds the page-level /VP (viewport) entry that makes a PDF georeferenced (spec Phase 15): the
// geospatial extension of ISO 32000-2 (12.10, "Geospatial features"), which started as Adobe's
// "PDF Reference 1.7, Supplement, Extension Level 3". Avenza Maps, Adobe Acrobat, GDAL, QGIS and
// ArcGIS Pro read it. Kept free of SDK and jsPDF imports so it can be unit tested on its own;
// geoPdf.ts supplies the inputs and writes the result into jsPDF's page dictionary.
//
// A viewport ties a rectangle of the page (/BBox) to the ground through a /GEO measure dictionary:
// control points given twice, once as positions in the unit square of that rectangle (/LPTS, origin
// bottom-left, y up) and once as latitude/longitude (/GPTS, latitude first), plus the coordinate
// system (/GCS) that /GPTS are to be read against.

export interface GeoViewport {
  // Viewport name, shown by some readers (the map frame's name).
  name: string
  // Map frame rectangle in PDF user space: points, origin at the page's bottom-left.
  bbox: { llx: number; lly: number; urx: number; ury: number }
  // The frame's corners as { lat, lon } in the order they appear on the page — works for rotated maps,
  // because each corner is georeferenced individually rather than via an extent.
  corners: { bottomLeft: LatLon; topLeft: LatLon; topRight: LatLon; bottomRight: LatLon }
  gcs: GeoCoordinateSystem
}

export interface LatLon { lat: number; lon: number }

export interface GeoCoordinateSystem {
  type: 'GEOGCS' | 'PROJCS'
  epsg?: number
  wkt?: string
}

// Unit-square corners of the viewport, in the same order as the GPTS pairs below.
const LPTS = [0, 0, 0, 1, 1, 1, 1, 0] // bottom-left, top-left, top-right, bottom-right

export function geoViewportDictionary (viewport: GeoViewport): string {
  const { bbox, corners, gcs } = viewport
  const gpts = [corners.bottomLeft, corners.topLeft, corners.topRight, corners.bottomRight]
    .flatMap((corner) => [corner.lat, corner.lon])
  const gcsEntries = [`/Type /${gcs.type}`]
  if (gcs.epsg) gcsEntries.push(`/EPSG ${gcs.epsg}`)
  if (gcs.wkt) gcsEntries.push(`/WKT ${pdfString(gcs.wkt)}`)

  return [
    '<< /Type /Viewport',
    `/BBox [${[bbox.llx, bbox.lly, bbox.urx, bbox.ury].map((n) => formatNumber(n, 3)).join(' ')}]`,
    `/Name ${pdfString(viewport.name)}`,
    '/Measure << /Type /Measure /Subtype /GEO',
    `/Bounds [${LPTS.join(' ')}]`,
    `/LPTS [${LPTS.join(' ')}]`,
    `/GPTS [${gpts.map((n) => formatNumber(n, 9)).join(' ')}]`,
    // Preferred display units: metres for distance, square metres for area, degrees for angles.
    '/PDU [/M /SQM /DEG]',
    `/GCS << ${gcsEntries.join(' ')} >>`,
    '>>',
    '>>'
  ].join(' ')
}

export function geoViewportsEntry (viewports: GeoViewport[]): string {
  return `/VP [${viewports.map(geoViewportDictionary).join(' ')}]`
}

// A PDF literal string: backslashes and parentheses escaped, non-ASCII dropped (WKT and frame names
// are plain ASCII in practice; anything else would need a text-string encoding readers don't expect here).
export function pdfString (text: string): string {
  const ascii = Array.from(text ?? '').filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) < 0x7f).join('')
  return `(${ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
}

// Fixed decimals with trailing zeros trimmed, never exponent notation (which PDF numbers don't allow).
function formatNumber (value: number, decimals: number): string {
  if (!isFinite(value)) return '0'
  const fixed = value.toFixed(decimals)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}
