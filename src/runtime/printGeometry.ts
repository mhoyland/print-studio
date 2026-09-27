import * as projectOperator from 'esri/geometry/operators/projectOperator'
import * as geodeticDistanceOperator from 'esri/geometry/operators/geodeticDistanceOperator'
import SpatialReference from 'esri/geometry/SpatialReference'
import Point from 'esri/geometry/Point'
import type { PrintAreaRect } from './printArea'

// What the map frame on the printed page actually shows, measured from the view it was captured from.
// Every page element that describes the map (scale bar, and in Phase 15 the GeoPDF georeference) reads
// this rather than the live view, so they always agree with the captured image — whether that came from
// the on-screen print area or an off-screen view at a fixed scale (mapCapture.ts).

// Layout coordinates are 150dpi page pixels (see pageSize.ts).
export const PAGE_PX_PER_INCH = 150
const METERS_PER_INCH = 0.0254

export interface PrintGeometry {
  // The frame's four corners in the view's spatial reference: top-left, top-right, bottom-right,
  // bottom-left as printed (so already rotated with the map). Null for a 3D SceneView.
  corners: __esri.Point[] | null
  spatialReference: __esri.SpatialReference | null
  // True (geodesic) ground distance covered by one page pixel, measured along the frame's horizontal
  // centre line. Null when it can't be measured (3D view, or the coordinate system can't be projected).
  groundMetersPerPagePx: number | null
  // Degrees, clockwise rotation of north from the top of the frame (MapView.rotation's convention).
  rotation: number
  // The true printed scale at the frame's centre line (ground distance / paper distance), e.g. 24000.
  scale: number | null
}

let operatorsLoading: Promise<void> | null = null

// The geometry operators load their projection engine on demand; everything below is synchronous once
// this has resolved.
export async function loadGeometryOperators (): Promise<void> {
  if (!operatorsLoading) {
    operatorsLoading = Promise.all([
      projectOperator.isLoaded() ? undefined : projectOperator.load(),
      geodeticDistanceOperator.isLoaded() ? undefined : geodeticDistanceOperator.load()
    ]).then(() => undefined)
    operatorsLoading.catch(() => { operatorsLoading = null }) // allow a retry after a failed load
  }
  await operatorsLoading
}

export function areGeometryOperatorsLoaded (): boolean {
  return projectOperator.isLoaded() && geodeticDistanceOperator.isLoaded()
}

// A copy of `point` made by this window's own copy of the SDK. At design time the layout editor runs
// in the builder's window while the map view lives in the app preview's iframe, which loads its own
// SDK; the geometry operators here silently fail on points from that other copy (the scale bar then
// disappeared from the design-time editor). A JSON round trip is lossless for a point.
export function toLocalPoint (point: __esri.Point): __esri.Point {
  // The types can't express a Point from another window, so TypeScript considers that branch unreachable.
  return point instanceof Point ? point : Point.fromJSON((point as { toJSON: () => unknown }).toJSON())
}

// Geodesic distance in metres on the WGS84 ellipsoid, whatever the points' own coordinate system.
// Null if the operators aren't loaded yet or the coordinate system can't be projected.
export function groundDistanceMeters (a: __esri.Point, b: __esri.Point): number | null {
  if (!a || !b || !areGeometryOperatorsLoaded()) return null
  try {
    const wgs84 = SpatialReference.WGS84
    const localA = toLocalPoint(a)
    const localB = toLocalPoint(b)
    const pa = localA.spatialReference?.isWGS84 ? localA : projectOperator.execute(localA, wgs84) as __esri.Point
    const pb = localB.spatialReference?.isWGS84 ? localB : projectOperator.execute(localB, wgs84) as __esri.Point
    if (!pa || !pb) return null
    const distance = geodeticDistanceOperator.execute(pa, pb, { unit: 'meters' })
    return isFinite(distance) && distance > 0 ? distance : null
  } catch {
    return null
  }
}

export function getViewRotationDegrees (view?: __esri.MapView | __esri.SceneView): number {
  if (!view) return 0
  if (view.type === '2d') return view.rotation ?? 0
  const camera = view.camera
  return camera ? (360 - camera.heading) % 360 : 0
}

// Measures the rectangle `rect` (the view container's CSS pixels) of `view`, printed into a map frame
// `frameWidthPx` page pixels wide. Works for rotated views: toMap() follows the rotation.
export function geometryFromScreenRect (view: __esri.MapView | __esri.SceneView, rect: PrintAreaRect, frameWidthPx: number): PrintGeometry {
  const rotation = getViewRotationDegrees(view)
  if (view.type !== '2d') {
    return { corners: null, spatialReference: null, groundMetersPerPagePx: null, rotation, scale: null }
  }
  const toMap = (x: number, y: number): __esri.Point | null => view.toMap({ x, y }) ?? null
  const corners = [
    toMap(rect.x, rect.y),
    toMap(rect.x + rect.width, rect.y),
    toMap(rect.x + rect.width, rect.y + rect.height),
    toMap(rect.x, rect.y + rect.height)
  ]
  const midY = rect.y + rect.height / 2
  const ground = groundDistanceMeters(toMap(rect.x, midY), toMap(rect.x + rect.width, midY))
  const groundMetersPerPagePx = ground !== null && frameWidthPx > 0 ? ground / frameWidthPx : null
  return {
    corners: corners.every(Boolean) ? corners : null,
    spatialReference: view.spatialReference ?? null,
    groundMetersPerPagePx,
    rotation,
    scale: groundMetersPerPagePx !== null ? scaleFromGroundMetersPerPagePx(groundMetersPerPagePx) : null
  }
}

export function scaleFromGroundMetersPerPagePx (groundMetersPerPagePx: number): number {
  return groundMetersPerPagePx / (METERS_PER_INCH / PAGE_PX_PER_INCH)
}

export function groundMetersPerPagePxFromScale (scale: number): number {
  return (scale * METERS_PER_INCH) / PAGE_PX_PER_INCH
}

// The view's true scale at a screen point: ground distance over the distance on a screen showing
// 96 CSS pixels per inch (the same convention as the SDK's own nominal scale, but measured).
export function trueScaleAtScreenPoint (view: __esri.MapView, x: number, y: number): number | null {
  const groundPerCssPx = groundMetersPerScreenPxAtCenter(view, x, y)
  return groundPerCssPx !== null ? groundPerCssPx / (METERS_PER_INCH / 96) : null
}

// True ground metres per CSS pixel at the centre of a 2D view, measured along a short horizontal
// screen segment (so rotation and projection distortion are both accounted for). Null if unmeasurable.
export function groundMetersPerScreenPxAtCenter (view: __esri.MapView, centerX: number, centerY: number): number | null {
  const half = 50
  const ground = groundDistanceMeters(view.toMap({ x: centerX - half, y: centerY }), view.toMap({ x: centerX + half, y: centerY }))
  return ground !== null ? ground / (half * 2) : null
}
