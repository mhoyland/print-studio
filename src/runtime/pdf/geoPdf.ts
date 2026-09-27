import * as projectOperator from 'esri/geometry/operators/projectOperator'
import SpatialReference from 'esri/geometry/SpatialReference'
import type { jsPDF } from 'jspdf'
import type { MapFrameElement } from '../../config'
import { toLocalPoint, type PrintGeometry } from '../printGeometry'
import { geoViewportsEntry, type GeoCoordinateSystem, type GeoViewport, type LatLon } from './geoPdfDictionary'

// GeoPDF output (spec Phase 15): georeferences the PDF's map frame from the PrintGeometry measured at
// capture time (mapCapture.ts), so the georeference describes exactly the map image on the page.
// See geoPdfDictionary.ts for the format itself.

// Returns null when the frame can't be georeferenced (a 3D view has no corner coordinates, or the
// projection engine couldn't convert them); the PDF is still exported, just without georeferencing.
export function buildGeoViewport (
  geometry: PrintGeometry | null,
  mapFrame: MapFrameElement,
  ptPerPagePx: number,
  pageHeightPt: number
): GeoViewport | null {
  if (!geometry?.corners || !geometry.spatialReference || !projectOperator.isLoaded()) return null
  const [topLeft, topRight, bottomRight, bottomLeft] = geometry.corners.map(toLatLon)
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null

  return {
    name: mapFrame.name || 'Map',
    bbox: {
      llx: mapFrame.x * ptPerPagePx,
      lly: pageHeightPt - (mapFrame.y + mapFrame.h) * ptPerPagePx,
      urx: (mapFrame.x + mapFrame.w) * ptPerPagePx,
      ury: pageHeightPt - mapFrame.y * ptPerPagePx
    },
    corners: { bottomLeft, topLeft, topRight, bottomRight },
    gcs: coordinateSystemOf(geometry.spatialReference)
  }
}

// Writes the /VP entry into the page dictionary as jsPDF outputs it — the same hook jsPDF's own
// annotations plugin uses for /Annots. Single-page documents only, which is all this widget makes.
export function attachGeoViewports (doc: jsPDF, viewports: GeoViewport[]): void {
  if (viewports.length === 0) return
  const internal = doc.internal as unknown as {
    events: { subscribe: (topic: string, callback: (data: { pageNumber: number }) => void) => void }
    write: (text: string) => void
  }
  internal.events.subscribe('putPage', (data) => {
    if (data.pageNumber === 1) internal.write(geoViewportsEntry(viewports))
  })
}

function toLatLon (point: __esri.Point): LatLon | null {
  try {
    const local = toLocalPoint(point)
    const geographic = local.spatialReference?.isWGS84 ? local : projectOperator.execute(local, SpatialReference.WGS84) as __esri.Point
    if (!geographic || !isFinite(geographic.y) || !isFinite(geographic.x)) return null
    return { lat: geographic.y, lon: geographic.x }
  } catch {
    return null
  }
}

// The map's own coordinate system when it has an EPSG code or a WKT definition; otherwise WGS84, which
// is still a correct georeference because /GPTS are always WGS84 latitude/longitude here.
function coordinateSystemOf (spatialReference: __esri.SpatialReference): GeoCoordinateSystem {
  if (spatialReference.isWebMercator) return { type: 'PROJCS', epsg: 3857 }
  const type = spatialReference.isGeographic ? 'GEOGCS' : 'PROJCS'
  const wkid = spatialReference.latestWkid ?? spatialReference.wkid
  // EPSG coordinate reference system codes are below 32768; larger ones (102xxx, 54xxx, ...) are Esri's own.
  const epsg = wkid && wkid < 32768 ? wkid : undefined
  const wkt = spatialReference.wkt || undefined
  if (epsg || wkt) return { type, epsg, wkt }
  return { type: 'GEOGCS', epsg: 4326 }
}
