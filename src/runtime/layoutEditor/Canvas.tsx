import { React, hooks } from 'jimu-core'
import { Button } from 'jimu-ui'
import { ZoomInOutlined } from 'jimu-icons/outlined/editor/zoom-in'
import { ZoomOutOutlined } from 'jimu-icons/outlined/editor/zoom-out'
import type { Layout, ImageElement, MapFrameElement } from '../../config'
import { getPageSizePx } from '../pageSize'
import { resolvePortalImageUrl } from '../portalImage'
import ElementWrapper, { type ElementBounds } from './ElementWrapper'
import { DEFAULT_SIZE } from './elementDefaults'
import type { AddableElementType } from './Toolbar'
import type { GuideLine } from './snapping'
import defaultMessages from '../../translations/default'
import { usePreviewGroundMetersPerPagePx } from './usePreviewScale'

const GUIDE_COLOR = '#ff3366'

export interface CanvasProps {
  layout: Layout
  view?: __esri.MapView | __esri.SceneView
  // Phase 14: the print scale in effect, so the scale bar preview matches the export.
  printScale?: number
  selectedElementId: string | null
  onSelect: (elementId: string | null) => void
  onElementChange: (elementId: string, bounds: ElementBounds) => void
  pendingElementType: AddableElementType | null
  onPlaceElement: (bounds: ElementBounds) => void
  // In viewer mode, only unlocked elements are interactive; the design-time editor always passes false.
  viewerMode: boolean
  // Elements the viewer owns (added this session, or in a template they made) are interactive even if locked.
  isOwnElement?: (elementId: string) => boolean
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1
const SCROLL_PADDING = 48 // 24px on each side
const MIN_DRAW_SIZE = 6 // logical px — drags smaller than this are treated as a plain click, not a drawn shape

const Canvas = (props: CanvasProps): React.ReactElement => {
  const { layout, view, printScale, selectedElementId, onSelect, onElementChange, pendingElementType, onPlaceElement, viewerMode, isOwnElement } = props
  const mapFrame = layout.elements.find((element): element is MapFrameElement => element.type === 'mapFrame')
  const groundMetersPerPagePx = usePreviewGroundMetersPerPagePx(view, mapFrame, printScale)
  const translate = hooks.useTranslation(defaultMessages)
  const { w, h } = getPageSizePx(layout)
  const [imageBitmaps, setImageBitmaps] = React.useState<{ [elementId: string]: HTMLImageElement }>({})
  const [zoom, setZoom] = React.useState(1)
  const [draftRect, setDraftRect] = React.useState<ElementBounds | null>(null)
  // Phase 10: alignment guide lines for whichever element is actively being dragged — transient,
  // never written into Layout, cleared as soon as the drag ends (see ElementWrapper's onGuidesChange).
  const [activeGuides, setActiveGuides] = React.useState<GuideLine[]>([])
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const pageRef = React.useRef<HTMLDivElement>(null)
  const drawStartRef = React.useRef<{ x: number; y: number } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const imageElements = layout.elements.filter((element): element is ImageElement =>
      element.type === 'image' && ((element.source === 'upload' && !!element.url) || (element.source === 'portalItem' && !!element.portalItemId))
    )
    Promise.all(imageElements.map(async (imageElement) => {
      const src = await resolveImageElementSrc(imageElement)
      return [imageElement.id, await loadImage(src)] as const
    }))
      .then((loaded) => { if (!cancelled) setImageBitmaps(Object.fromEntries(loaded)) })
      .catch(() => { /* a broken preview image (bad upload, inaccessible Portal item, etc.) shouldn't block the rest of the editor shell */ })
    return () => { cancelled = true }
  }, [layout.elements])

  const computeFitZoom = React.useCallback((): number => {
    const container = scrollRef.current
    if (!container) return 1
    const availableWidth = container.clientWidth - SCROLL_PADDING
    const availableHeight = container.clientHeight - SCROLL_PADDING
    if (availableWidth <= 0 || availableHeight <= 0) return 1
    return Math.min(availableWidth / w, availableHeight / h, 1)
  }, [w, h])

  // Auto-fit whenever the page size/orientation changes (including on first open).
  React.useEffect(() => {
    setZoom(computeFitZoom())
  }, [computeFitZoom])

  const zoomIn = (): void => { setZoom((z) => clampZoom(z + ZOOM_STEP)) }
  const zoomOut = (): void => { setZoom((z) => clampZoom(z - ZOOM_STEP)) }
  const zoomToFit = (): void => { setZoom(computeFitZoom()) }

  const sortedElements = [...layout.elements].sort((a, b) => a.zIndex - b.zIndex)

  // Every element's bounds, keyed by every *other* element's id — Phase 10's snap targets while
  // dragging (see snapping.ts). Recomputed whenever the element list changes; O(n²) but n is a
  // handful of print-layout elements at most, not a performance concern at this scale.
  const otherElementBoundsById = React.useMemo(() => {
    const allBounds = layout.elements.map((element) => ({ id: element.id, x: element.x, y: element.y, w: element.w, h: element.h }))
    const byId: { [elementId: string]: ElementBounds[] } = {}
    for (const element of layout.elements) {
      byId[element.id] = allBounds.filter((bounds) => bounds.id !== element.id)
    }
    return byId
  }, [layout.elements])

  // Converts a mouse event's viewport coordinates into the page's own logical (unscaled) coordinate
  // space — the page div's on-screen box already reflects the zoom transform, so this is the same
  // "measure the live box, divide by zoom" approach ElementWrapper uses for drag/resize.
  const toLogicalPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const pageEl = pageRef.current
    if (!pageEl) return { x: 0, y: 0 }
    const rect = pageEl.getBoundingClientRect()
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  const handlePlacementMouseDown = (evt: React.MouseEvent): void => {
    evt.stopPropagation()
    const point = toLogicalPoint(evt.clientX, evt.clientY)
    drawStartRef.current = point
    setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 })
  }

  const handlePlacementMouseMove = (evt: React.MouseEvent): void => {
    if (!drawStartRef.current) return
    setDraftRect(normalizeRect(drawStartRef.current, toLogicalPoint(evt.clientX, evt.clientY)))
  }

  const handlePlacementMouseUp = (evt: React.MouseEvent): void => {
    const start = drawStartRef.current
    if (!start || !pendingElementType) return
    const rect = normalizeRect(start, toLogicalPoint(evt.clientX, evt.clientY))
    drawStartRef.current = null
    setDraftRect(null)

    if (rect.w < MIN_DRAW_SIZE && rect.h < MIN_DRAW_SIZE) {
      // A plain click, not a drag — place the type's default size centered on the click point.
      const size = DEFAULT_SIZE[pendingElementType]
      onPlaceElement({
        x: clamp(start.x - size.w / 2, 0, Math.max(0, w - size.w)),
        y: clamp(start.y - size.h / 2, 0, Math.max(0, h - size.h)),
        w: size.w,
        h: size.h
      })
    } else {
      onPlaceElement(rect)
    }
  }

  return (
    <div className="d-flex flex-column" style={{ flex: 1, minWidth: 0 }}>
      <div
        ref={scrollRef}
        className="print-export-canvas-scroll"
        style={{ flex: 1, overflow: 'auto', backgroundColor: '#e8e8e8', padding: 24 }}
        onClick={() => { onSelect(null) }}
      >
        {/* This wrapper is sized to the zoomed footprint so scrolling/centering account for the
            actual visual size — a CSS transform alone wouldn't affect layout/scroll dimensions. */}
        <div style={{ width: w * zoom, height: h * zoom, margin: '0 auto' }}>
          <div
            ref={pageRef}
            className="print-export-page"
            style={{
              position: 'relative',
              width: w,
              height: h,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              backgroundColor: '#ffffff',
              boxShadow: '0 0 0 1px var(--sys-color-divider-primary)'
            }}
          >
            {sortedElements.map((element) => (
              <ElementWrapper
                key={element.id}
                element={element}
                view={view}
                groundMetersPerPagePx={groundMetersPerPagePx}
                imageBitmap={element.type === 'image' ? imageBitmaps[element.id] : undefined}
                isSelected={element.id === selectedElementId}
                zoom={zoom}
                interactive={!viewerMode || !element.locked || (isOwnElement?.(element.id) ?? false)}
                onSelect={onSelect}
                onChange={onElementChange}
                otherElementBounds={otherElementBoundsById[element.id]}
                pageWidth={w}
                pageHeight={h}
                onGuidesChange={setActiveGuides}
              />
            ))}

            {activeGuides.map((guide, index) => (
              <div
                key={index}
                style={guide.orientation === 'vertical'
                  ? { position: 'absolute', left: guide.position, top: guide.start, width: 1, height: guide.end - guide.start, backgroundColor: GUIDE_COLOR, pointerEvents: 'none', zIndex: 999 }
                  : { position: 'absolute', top: guide.position, left: guide.start, height: 1, width: guide.end - guide.start, backgroundColor: GUIDE_COLOR, pointerEvents: 'none', zIndex: 999 }}
              />
            ))}

            {pendingElementType && (
              <div
                onMouseDown={handlePlacementMouseDown}
                onMouseMove={handlePlacementMouseMove}
                onMouseUp={handlePlacementMouseUp}
                style={{
                  position: 'absolute',
                  inset: 0,
                  cursor: 'crosshair',
                  zIndex: 1000
                }}
              >
                {draftRect && (
                  <div
                    style={{
                      position: 'absolute',
                      left: draftRect.x,
                      top: draftRect.y,
                      width: draftRect.w,
                      height: draftRect.h,
                      border: '1.5px dashed var(--sys-color-primary)',
                      backgroundColor: 'rgba(0, 0, 0, 0.05)',
                      pointerEvents: 'none'
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="d-flex align-items-center px-2 py-1"
        style={{ gap: 8, borderTop: '1px solid var(--sys-color-divider-primary)', flexShrink: 0 }}
      >
        <Button icon size="sm" type="tertiary" aria-label={translate('zoomOut')} onClick={zoomOut}>
          <ZoomOutOutlined size={14} />
        </Button>
        <span style={{ fontSize: 12, minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <Button icon size="sm" type="tertiary" aria-label={translate('zoomIn')} onClick={zoomIn}>
          <ZoomInOutlined size={14} />
        </Button>
        <Button size="sm" type="tertiary" onClick={zoomToFit}>{translate('fit')}</Button>
      </div>
    </div>
  )
}

function clampZoom (zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
}

// Drag can go in any direction from the mousedown point — this turns two arbitrary points into a
// top-left-anchored, positive-size rect regardless of which way the user dragged.
function normalizeRect (start: { x: number; y: number }, end: { x: number; y: number }): ElementBounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y)
  }
}

function clamp (value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Portal-sourced images are resolved fresh on every call (an authenticated request → blob → object
// URL) rather than cached across renders — this only runs when `layout.elements` itself changes, so
// it's not on any hot path, and keeping it simple avoids having to track/revoke stale object URLs.
async function resolveImageElementSrc (element: ImageElement): Promise<string> {
  if (element.source === 'portalItem' && element.portalItemId) {
    return await resolvePortalImageUrl(element.portalItemId)
  }
  return element.url
}

function loadImage (src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => { resolve(image) }
    image.onerror = () => { reject(new Error('Failed to load image')) }
    image.src = src
  })
}

export default Canvas
