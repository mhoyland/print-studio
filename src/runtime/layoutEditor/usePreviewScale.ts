import { React } from 'jimu-core'
import * as reactiveUtils from 'esri/core/reactiveUtils'
import type { MapFrameElement } from '../../config'
import { computePrintAreaRect } from '../printArea'
import { geometryFromScreenRect, groundMetersPerPagePxFromScale, loadGeometryOperators } from '../printGeometry'

// Ground metres per page pixel for the editor's scale bar preview. With a print scale it follows
// directly from that scale; otherwise it's measured from the live view's print area exactly as an
// export would (mapCapture.ts), and re-measured whenever the map stops moving. Null until the
// projection engine has loaded, or for a 3D view (no scale bar is drawn then, as in the export).
export function usePreviewGroundMetersPerPagePx (
  view: __esri.MapView | __esri.SceneView | undefined,
  mapFrame: MapFrameElement | undefined,
  printScale?: number
): number | null {
  const [measured, setMeasured] = React.useState<number | null>(null)
  const frameW = mapFrame?.w
  const frameH = mapFrame?.h

  React.useEffect(() => {
    if (printScale || !view || !frameW || !frameH) {
      setMeasured(null)
      return
    }
    let cancelled = false
    const update = (): void => {
      if (cancelled) return
      const width = view.container?.clientWidth ?? view.width
      const height = view.container?.clientHeight ?? view.height
      const rect = computePrintAreaRect(width, height, frameW / frameH) ?? { x: 0, y: 0, width, height }
      setMeasured(geometryFromScreenRect(view, rect, frameW).groundMetersPerPagePx)
    }
    // A failed load leaves the preview without a scale bar rather than breaking the editor.
    loadGeometryOperators().catch(() => undefined).finally(update)
    const handle = reactiveUtils.watch(() => view.stationary, (stationary) => { if (stationary) update() })
    return () => {
      cancelled = true
      handle.remove()
    }
  }, [view, frameW, frameH, printScale])

  return printScale ? groundMetersPerPagePxFromScale(printScale) : measured
}
