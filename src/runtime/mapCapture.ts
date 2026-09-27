import MapView from 'esri/views/MapView'
import * as reactiveUtils from 'esri/core/reactiveUtils'
import type { MapFrameElement } from '../config'
import { computePrintAreaRect, type PrintAreaRect } from './printArea'
import {
  PAGE_PX_PER_INCH, geometryFromScreenRect, groundMetersPerScreenPxAtCenter, loadGeometryOperators,
  type PrintGeometry
} from './printGeometry'

// Captures the map image for the layout's map frame (spec Phase 14).
//
// - No print scale: the on-screen print area is captured, exactly as before (the crop PrintAreaOverlay
//   previews), and the scale is whatever that area happens to be.
// - A print scale: a hidden MapView, sized to the frame's physical size, is drawn at that true scale
//   around the same centre and rotation, captured, and destroyed. The on-screen map never moves.
//
// Either way the result carries the PrintGeometry measured from the view actually captured, so the
// scale bar describes the image rather than the live map, and any shortfall (lower dpi than asked for,
// a scale the map couldn't draw at) is reported as a warning rather than silently printed.

export type CaptureWarning =
  | { kind: 'reducedDpi'; targetDpi: number; effectiveDpi: number }
  | { kind: 'scaleAdjusted'; requestedScale: number; actualScale: number }
  | { kind: 'scaleNotSupportedIn3d' }
  // Set by the PDF export (not the capture itself) when GeoPDF was asked for but the frame's corners
  // couldn't be georeferenced — a 3D view, or coordinates the projection engine couldn't convert.
  | { kind: 'notGeoreferenced' }

export interface MapCaptureOptions {
  view: __esri.MapView | __esri.SceneView
  mapFrame: MapFrameElement
  targetDpi: number
  // True scale denominator (24000 for 1:24,000); undefined captures the current view.
  printScale?: number
}

export interface MapCaptureResult {
  dataUrl: string
  geometry: PrintGeometry
  warnings: CaptureWarning[]
}

// Browsers cap canvas area (Safari at 4096 x 4096) and WebGL caps each side; both fail as a blank image
// or an exception rather than a clear error, so captures are clamped below them up front.
const MAX_CAPTURE_PIXELS = 4096 * 4096
const CSS_PX_PER_INCH = 96
// How long to wait for an off-screen view's layers to finish drawing before giving up.
const RENDER_TIMEOUT_MS = 60000

export async function captureMap (options: MapCaptureOptions): Promise<MapCaptureResult> {
  const { view, mapFrame, targetDpi, printScale } = options
  const warnings: CaptureWarning[] = []
  try {
    await loadGeometryOperators()
  } catch {
    // Without the projection engine the capture still works; the scale bar just can't be measured.
  }

  const size = clampCaptureSize(mapFrame, targetDpi)

  if (printScale && view.type === '2d') {
    const result = await withSizeFallback(size, mapFrame, targetDpi, warnings, async (width, height) => await captureAtScale(view, mapFrame, width, height, printScale))
    if (result.geometry.scale !== null && Math.abs(result.geometry.scale - printScale) / printScale > 0.01) {
      warnings.push({ kind: 'scaleAdjusted', requestedScale: printScale, actualScale: Math.round(result.geometry.scale) })
    }
    return { ...result, warnings }
  }

  if (printScale) warnings.push({ kind: 'scaleNotSupportedIn3d' })
  const result = await withSizeFallback(size, mapFrame, targetDpi, warnings, async (width, height) => await captureCurrentView(view, mapFrame, width, height))
  return { ...result, warnings }
}

// Target pixel size for the frame at `targetDpi`, clamped to what the browser can actually render.
function clampCaptureSize (mapFrame: MapFrameElement, targetDpi: number): { width: number; height: number } {
  const factor = targetDpi / PAGE_PX_PER_INCH
  let width = Math.max(1, Math.round(mapFrame.w * factor))
  let height = Math.max(1, Math.round(mapFrame.h * factor))
  const maxSide = getMaxRenderSide()
  const shrink = Math.min(1, maxSide / width, maxSide / height, Math.sqrt(MAX_CAPTURE_PIXELS / (width * height)))
  if (shrink < 1) {
    width = Math.floor(width * shrink)
    height = Math.floor(height * shrink)
  }
  return { width, height }
}

// Runs a capture at `size`; if the browser refuses (some GPUs fail below the advertised limits), retries
// once at 70%. Records a reducedDpi warning whenever the delivered resolution is under the target.
async function withSizeFallback (
  size: { width: number; height: number },
  mapFrame: MapFrameElement,
  targetDpi: number,
  warnings: CaptureWarning[],
  capture: (width: number, height: number) => Promise<Omit<MapCaptureResult, 'warnings'>>
): Promise<Omit<MapCaptureResult, 'warnings'>> {
  let { width, height } = size
  let result: Omit<MapCaptureResult, 'warnings'>
  try {
    result = await capture(width, height)
  } catch (error) {
    width = Math.floor(width * 0.7)
    height = Math.floor(height * 0.7)
    result = await capture(width, height)
  }
  const effectiveDpi = Math.round((width / mapFrame.w) * PAGE_PX_PER_INCH)
  if (effectiveDpi < targetDpi * 0.98) warnings.push({ kind: 'reducedDpi', targetDpi, effectiveDpi })
  return result
}

async function captureCurrentView (view: __esri.MapView | __esri.SceneView, mapFrame: MapFrameElement, width: number, height: number): Promise<Omit<MapCaptureResult, 'warnings'>> {
  const rect = printAreaRectOf(view, mapFrame)
  const screenshot = await view.takeScreenshot({ area: rect, width, height })
  return { dataUrl: screenshot.dataUrl, geometry: geometryFromScreenRect(view, rect, mapFrame.w) }
}

// The same centred, aspect-correct box PrintAreaOverlay previews; the whole container if that can't
// be computed (unmeasured container), matching the previous behaviour.
function printAreaRectOf (view: __esri.MapView | __esri.SceneView, mapFrame: MapFrameElement): PrintAreaRect {
  const container = view.container
  const width = container?.clientWidth ?? view.width
  const height = container?.clientHeight ?? view.height
  return computePrintAreaRect(width, height, mapFrame.w / mapFrame.h) ?? { x: 0, y: 0, width, height }
}

async function captureAtScale (view: __esri.MapView, mapFrame: MapFrameElement, width: number, height: number, printScale: number): Promise<Omit<MapCaptureResult, 'warnings'>> {
  const rect = printAreaRectOf(view, mapFrame)
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const center = view.toMap({ x: centerX, y: centerY })
  if (!center) throw new Error('The print area centre is not on the map.')

  // The hidden view is laid out at the frame's physical size at 96 CSS px/in, so "one CSS pixel" there
  // is a known distance on paper; takeScreenshot then renders it at the requested pixel size.
  const cssWidth = Math.max(1, Math.round((mapFrame.w / PAGE_PX_PER_INCH) * CSS_PX_PER_INCH))
  const cssHeight = Math.max(1, Math.round((mapFrame.h / PAGE_PX_PER_INCH) * CSS_PX_PER_INCH))
  const groundPerCssPxWanted = (printScale * 0.0254) / CSS_PX_PER_INCH
  // Convert that ground distance into the view's own scale value using the live view's measured
  // ratio of ground metres to map units at this spot — this is what makes the result true scale
  // (e.g. corrected for Web Mercator's stretch away from the equator) rather than nominal.
  const groundPerCssPxNow = groundMetersPerScreenPxAtCenter(view, centerX, centerY)
  const targetViewScale = groundPerCssPxNow !== null
    ? view.scale * (groundPerCssPxWanted / groundPerCssPxNow)
    : printScale

  const container = document.createElement('div')
  Object.assign(container.style, {
    position: 'fixed', left: '-100000px', top: '0', width: `${cssWidth}px`, height: `${cssHeight}px`, pointerEvents: 'none'
  })
  container.setAttribute('aria-hidden', 'true')
  document.body.appendChild(container)

  const offscreen = new MapView({
    container,
    map: view.map,
    spatialReference: view.spatialReference,
    center,
    scale: targetViewScale,
    rotation: view.rotation,
    constraints: { snapToZoom: false, minScale: 0, maxScale: 0, rotationEnabled: true },
    ui: { components: [] },
    popupEnabled: false
  })
  try {
    await offscreen.when()
    await waitForRender(offscreen)
    const screenshot = await offscreen.takeScreenshot({ width, height })
    const geometry = geometryFromScreenRect(offscreen, { x: 0, y: 0, width: cssWidth, height: cssHeight }, mapFrame.w)
    return { dataUrl: screenshot.dataUrl, geometry }
  } finally {
    // destroy() would also destroy the map it shows — the app's own map — unless detached first.
    offscreen.map = null
    offscreen.destroy()
    container.remove()
  }
}

// Waits until every layer has drawn. `updating` can briefly read false before layer views start
// loading, so it is checked again after a short pause.
async function waitForRender (view: __esri.MapView): Promise<void> {
  const settled = (async () => {
    for (let pass = 0; pass < 2; pass++) {
      await reactiveUtils.whenOnce(() => !view.updating)
      await new Promise((resolve) => { setTimeout(resolve, 150) })
    }
    await reactiveUtils.whenOnce(() => !view.updating)
  })()
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('The map took too long to draw at the print scale.')) }, RENDER_TIMEOUT_MS)
  })
  try {
    await Promise.race([settled, timeout])
  } finally {
    clearTimeout(timer)
  }
}

let maxRenderSide: number | null = null

// The largest side, in pixels, the GPU will render — the lower of its renderbuffer and texture limits.
function getMaxRenderSide (): number {
  if (maxRenderSide !== null) return maxRenderSide
  maxRenderSide = 4096
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
    if (gl) {
      maxRenderSide = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    // keep the conservative default
  }
  return maxRenderSide
}
