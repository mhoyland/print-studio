import { React } from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'
import * as reactiveUtils from 'esri/core/reactiveUtils'
import { computePrintAreaRect, type PrintAreaRect } from './printArea'
import { groundMetersPerPagePxFromScale, groundMetersPerScreenPxAtCenter, loadGeometryOperators } from './printGeometry'

export interface PrintAreaOverlayProps {
  jimuMapView: JimuMapView | null
  // Size (page px) of the thing being framed (the active layout's mapFrame element) — null when there's
  // no active layout/mapFrame to frame, in which case nothing is drawn.
  mapFrameSize: { w: number; h: number } | null
  // Phase 14: true scale the map will print at; undefined for the current view.
  printScale?: number
  visible: boolean
  // Called with true when, at the print scale, the area to be printed is larger than the map on screen.
  onOverflowChange?: (overflows: boolean) => void
}

// Renders nothing into the React tree — the box itself is a plain DOM element appended directly into
// the bound map widget's own view.container (this widget has no map view of its own; it only ever
// controls one hosted elsewhere in the Experience, via useMapWidgetId). A raw DOM node instead of a
// portal keeps this consistent with how ElementWrapper.tsx already manages interact.js's DOM nodes in
// this codebase, and sidesteps needing a react-dom import purely for one overlay element.
//
// Without a print scale the box is a fixed region of the screen (the crop exportRenderer.ts captures),
// so it only changes with the container's size. With a print scale it shows the ground area that will
// print, centred where the capture is centred (mapCapture.ts), so it also resizes as the map is zoomed.
const PrintAreaOverlay = (props: PrintAreaOverlayProps): null => {
  const { jimuMapView, mapFrameSize, printScale, visible, onOverflowChange } = props
  const frameW = mapFrameSize?.w
  const frameH = mapFrameSize?.h
  const onOverflowChangeRef = React.useRef(onOverflowChange)
  onOverflowChangeRef.current = onOverflowChange

  React.useEffect(() => {
    const view = jimuMapView?.view
    const container = view?.container
    if (!container) return

    const box = document.createElement('div')
    box.style.position = 'absolute'
    box.style.pointerEvents = 'none'
    box.style.border = '2px dashed var(--sys-color-primary, #007ac2)'
    // Shaded like the built-in Print widget's print area, tinted with the theme's primary colour so it
    // reads as a selection rather than hiding the map beneath it.
    box.style.backgroundColor = 'color-mix(in srgb, var(--sys-color-primary, #007ac2) 22%, transparent)'
    box.style.boxSizing = 'border-box'
    box.style.display = 'none'
    container.appendChild(box)

    let lastOverflow: boolean | null = null
    const reportOverflow = (overflows: boolean): void => {
      if (overflows === lastOverflow) return
      lastOverflow = overflows
      onOverflowChangeRef.current?.(overflows)
    }

    const computeRect = (): PrintAreaRect | null => {
      if (!frameW || !frameH) return null
      const width = container.clientWidth
      const height = container.clientHeight
      const fitted = computePrintAreaRect(width, height, frameW / frameH)
      if (!printScale || view.type !== '2d' || !fitted) return fitted
      const groundPerScreenPx = groundMetersPerScreenPxAtCenter(view, fitted.x + fitted.width / 2, fitted.y + fitted.height / 2)
      if (groundPerScreenPx === null) return null
      const groundPerPagePx = groundMetersPerPagePxFromScale(printScale)
      const boxWidth = (frameW * groundPerPagePx) / groundPerScreenPx
      const boxHeight = (frameH * groundPerPagePx) / groundPerScreenPx
      return { x: (width - boxWidth) / 2, y: (height - boxHeight) / 2, width: boxWidth, height: boxHeight }
    }

    const reposition = (): void => {
      const rect = computeRect()
      if (!rect) {
        box.style.display = 'none'
        reportOverflow(false)
        return
      }
      box.style.display = visible ? 'block' : 'none'
      box.style.left = `${rect.x}px`
      box.style.top = `${rect.y}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
      reportOverflow(rect.width > container.clientWidth + 1 || rect.height > container.clientHeight + 1)
    }

    let cancelled = false
    if (printScale) {
      // A failed load just leaves the box hidden (it can't be sized without the projection engine).
      loadGeometryOperators().catch(() => undefined).finally(() => { if (!cancelled) reposition() })
    }
    reposition()

    const resizeObserver = new ResizeObserver(reposition)
    resizeObserver.observe(container)
    const extentHandle = printScale ? reactiveUtils.watch(() => view.extent, reposition) : null

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      extentHandle?.remove()
      // The bound map view is shared (this widget only ever controls one hosted elsewhere in the
      // Experience, via useMapWidgetId) and can be torn down independently of this widget — guard
      // against the container already having removed this node itself by the time cleanup runs.
      if (box.parentNode === container) container.removeChild(box)
    }
  }, [jimuMapView, frameW, frameH, printScale, visible])

  return null
}

export default PrintAreaOverlay
