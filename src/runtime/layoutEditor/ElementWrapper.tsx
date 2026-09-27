import { React, hooks } from 'jimu-core'
import interact, { type Interactable, type InteractEvent } from 'interactjs/dist/interact.min.js'
import type { LayoutElement, MapFrameElement } from '../../config'
import { renderText } from '../elementRenderers/renderText'
import { renderRect } from '../elementRenderers/renderRect'
import { renderNorthArrow } from '../elementRenderers/renderNorthArrow'
import { renderImage } from '../elementRenderers/renderImage'
import { renderScaleBar } from '../elementRenderers/renderScaleBar'
import { computeLegendGroups, paintLegend, type LegendGroup } from '../elementRenderers/renderLegend'
import { renderAttributeTable } from '../elementRenderers/renderAttributeTable'
import { renderPopup } from '../elementRenderers/renderPopup'
import { computeSnap, type Bounds, type GuideLine } from './snapping'
import defaultMessages from '../../translations/default'

export interface ElementBounds { x: number; y: number; w: number; h: number }

export interface ElementWrapperProps {
  element: LayoutElement
  view?: __esri.MapView | __esri.SceneView
  // For the scale bar preview — see usePreviewScale.ts.
  groundMetersPerPagePx?: number | null
  imageBitmap?: HTMLImageElement
  isSelected: boolean
  zoom: number
  // False for a locked element in the runtime viewer editor (see LayoutEditor's viewerMode) — neither
  // draggable/resizable nor selectable. Always true for the design-time editor, regardless of `locked`.
  interactive: boolean
  onSelect: (elementId: string) => void
  onChange: (elementId: string, bounds: ElementBounds) => void
  // Phase 10: every other element's current bounds, and the page's own size, used to compute
  // snap-while-dragging targets (see snapping.ts) — move only, not resize (see its own spec note on
  // why resize-edge snapping is left as a future extension). `onGuidesChange` reports the active
  // alignment guide lines up to Canvas.tsx each drag-move event (and clears them on drag end), which
  // renders them as an overlay; only the actively-dragging instance ever calls it.
  otherElementBounds: Bounds[]
  pageWidth: number
  pageHeight: number
  onGuidesChange: (guides: GuideLine[]) => void
}

const MIN_SIZE = 10
const RESIZE_MARGIN = 8
const SNAP_THRESHOLD_SCREEN_PX = 6

// One wrapper for every element type — interact.js handles drag/resize uniformly regardless of
// element.type, which only decides what renders inside. (react-rnd was tried first per the original
// spec, but its react-draggable/re-resizable internals aren't compatible with React 19 yet — see
// the open "Update react monorepo to v19" PR on react-rnd's repo — so interact.js is used instead,
// since it's DOM-event-based rather than tied to React internals, and was already a dependency of
// this codebase.)
// `locked` is a runtime-viewer concept (see WidgetConfig.allowViewerLayoutEdit), not a design-time
// restriction — the design-time editor always passes interactive=true regardless of `locked`; only
// the runtime viewer editor computes `interactive` from it (see Canvas.tsx).
// mapFrame gets a placeholder box here — a live view can't simply be reparented into this canvas without
// disrupting the Map widget's own rendering, so a real preview is deferred rather than done unsafely.
const ElementWrapper = (props: ElementWrapperProps): React.ReactElement => {
  const { element, view, groundMetersPerPagePx, imageBitmap, isSelected, zoom, interactive, onSelect, onChange, otherElementBounds, pageWidth, pageHeight, onGuidesChange } = props
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const isMapFrame = element.type === 'mapFrame'
  const isLegend = element.type === 'legend'

  // Legend content (which layers/renderers contribute what) only depends on the bound view, not on
  // this element's own styling — kept in its own effect so restyling the legend (font size, colors,
  // etc.) repaints instantly from cached data instead of re-running the async ArcGIS Maps SDK legend
  // computation on every keystroke.
  const [legendGroups, setLegendGroups] = React.useState<LegendGroup[]>([])
  React.useEffect(() => {
    if (!isLegend || !view) {
      setLegendGroups([])
      return
    }
    let cancelled = false
    computeLegendGroups(view)
      .then((groups) => { if (!cancelled) setLegendGroups(groups) })
      .catch(() => { if (!cancelled) setLegendGroups([]) })
    return () => { cancelled = true }
  }, [isLegend, view])

  React.useEffect(() => {
    if (isMapFrame) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(-element.x, -element.y)
    paintElement(ctx, element, view, groundMetersPerPagePx, imageBitmap, legendGroups)
    ctx.restore()
  }, [element, view, groundMetersPerPagePx, imageBitmap, isMapFrame, legendGroups])

  // interact.js measures drag/resize deltas in on-screen (post CSS-transform) pixels, with no
  // awareness of the page's zoom transform — every delta below is divided by `zoom` to convert it
  // back into the page's logical coordinate space, the same space element.x/y/w/h live in.
  React.useEffect(() => {
    const node = wrapperRef.current
    if (!node || !interactive) return

    const interactable: Interactable = interact(node)
      .draggable({
        listeners: {
          // `rawX`/`rawY` track the true cumulative mouse-follow offset, kept in their own dataset
          // fields separate from `x`/`y` (the snap-corrected offset actually applied to the element).
          // Feeding the corrected value back in as next frame's baseline (as an earlier version of
          // this did) meant every small mouse delta while inside the snap threshold got silently
          // absorbed and reset right back to the exact snapped position — a dead zone that felt like
          // the element was stuck/magnetized far more strongly than the threshold distance implied.
          // Tracking raw movement independently means the drag always follows the cursor 1:1
          // underneath the snap, so it releases smoothly the moment the raw position clears threshold.
          start (event: InteractEvent) {
            const target = event.target
            target.dataset.rawX = String(getDataNumber(target, 'x'))
            target.dataset.rawY = String(getDataNumber(target, 'y'))
          },
          move (event: InteractEvent) {
            const target = event.target
            const rawX = getDataNumber(target, 'rawX') + event.dx / zoom
            const rawY = getDataNumber(target, 'rawY') + event.dy / zoom
            target.dataset.rawX = String(rawX)
            target.dataset.rawY = String(rawY)

            const dragged: Bounds = { x: element.x + rawX, y: element.y + rawY, w: element.w, h: element.h }
            const snap = computeSnap(dragged, otherElementBounds, pageWidth, pageHeight, SNAP_THRESHOLD_SCREEN_PX / zoom)
            const x = rawX + snap.dx
            const y = rawY + snap.dy
            target.style.transform = `translate(${x}px, ${y}px)`
            target.dataset.x = String(x)
            target.dataset.y = String(y)
            onGuidesChange(snap.guides)
          },
          end (event: InteractEvent) {
            const target = event.target
            const offsetX = getDataNumber(target, 'x')
            const offsetY = getDataNumber(target, 'y')
            resetTransform(target)
            onGuidesChange([])
            onChange(element.id, { x: element.x + offsetX, y: element.y + offsetY, w: element.w, h: element.h })
          }
        },
        modifiers: [interact.modifiers.restrictRect({ restriction: 'parent' })]
      })
      .resizable({
        edges: { top: true, left: true, bottom: true, right: true },
        margin: RESIZE_MARGIN,
        listeners: {
          // Width/height are accumulated from deltaRect (the change since the last move event) rather
          // than taken from event.rect (the absolute measured box) — a single-edge resize (e.g. only
          // the right edge) reports a zero delta on the other three edges, so the "other" dimension
          // can't drift even if the absolute rect measurement is briefly off. Using the absolute value
          // was the cause of side-only resizes occasionally collapsing into a skinny sliver.
          start (event: InteractEvent) {
            const target = event.target
            target.dataset.w = String(element.w)
            target.dataset.h = String(element.h)
          },
          move (event: InteractEvent) {
            const target = event.target
            const deltaRect = event.deltaRect
            const x = getDataNumber(target, 'x') + (deltaRect ? deltaRect.left / zoom : 0)
            const y = getDataNumber(target, 'y') + (deltaRect ? deltaRect.top / zoom : 0)
            const w = getDataNumber(target, 'w') + (deltaRect ? deltaRect.width / zoom : 0)
            const h = getDataNumber(target, 'h') + (deltaRect ? deltaRect.height / zoom : 0)
            target.style.width = `${w}px`
            target.style.height = `${h}px`
            target.style.transform = `translate(${x}px, ${y}px)`
            target.dataset.x = String(x)
            target.dataset.y = String(y)
            target.dataset.w = String(w)
            target.dataset.h = String(h)
          },
          end (event: InteractEvent) {
            const target = event.target
            const offsetX = getDataNumber(target, 'x')
            const offsetY = getDataNumber(target, 'y')
            const w = getDataNumber(target, 'w') || element.w
            const h = getDataNumber(target, 'h') || element.h
            resetTransform(target)
            // Set the DOM to the final size explicitly rather than clearing it and trusting React to
            // restore it on re-render — if a dimension didn't actually change (e.g. height, during a
            // pure width-only resize), React's diffing sees no change in that style value between
            // renders and never rewrites it, leaving it at whatever it was blanked to (which CSS then
            // resolves by shrinking to fit content — the visual collapse seen on side-only resizes).
            target.style.width = `${w}px`
            target.style.height = `${h}px`
            onChange(element.id, { x: element.x + offsetX, y: element.y + offsetY, w, h })
          }
        },
        modifiers: [
          interact.modifiers.restrictEdges({ outer: 'parent' }),
          interact.modifiers.restrictSize({ min: { width: MIN_SIZE, height: MIN_SIZE } })
        ]
      })

    return () => { interactable.unset() }
  }, [element.id, element.x, element.y, element.w, element.h, zoom, onChange, interactive, otherElementBounds, pageWidth, pageHeight, onGuidesChange])

  const handleClick = (evt: React.MouseEvent): void => {
    if (!interactive) return
    evt.stopPropagation()
    onSelect(element.id)
  }

  return (
    <div
      ref={wrapperRef}
      onClick={handleClick}
      style={{
        position: 'absolute',
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        outline: isSelected ? '2px solid var(--sys-color-primary)' : 'none',
        opacity: interactive ? 1 : 0.6,
        cursor: interactive ? 'move' : 'default',
        touchAction: 'none'
      }}
    >
      {isMapFrame
        ? <MapFramePlaceholder element={element as MapFrameElement} />
        : <canvas ref={canvasRef} width={element.w} height={element.h} style={{ width: '100%', height: '100%', display: 'block' }} />}
    </div>
  )
}

function getDataNumber (element: HTMLElement, key: string): number {
  return parseFloat(element.dataset[key] || '0')
}

function resetTransform (element: HTMLElement): void {
  element.style.transform = ''
  element.dataset.x = '0'
  element.dataset.y = '0'
  delete element.dataset.w
  delete element.dataset.h
  delete element.dataset.rawX
  delete element.dataset.rawY
}

function paintElement (ctx: CanvasRenderingContext2D, element: LayoutElement, view: __esri.MapView | __esri.SceneView, groundMetersPerPagePx: number | null, imageBitmap: HTMLImageElement, legendGroups: LegendGroup[]): void {
  switch (element.type) {
    case 'text':
      renderText(ctx, element)
      break
    case 'rect':
      renderRect(ctx, element)
      break
    case 'northArrow':
      renderNorthArrow(ctx, element, view)
      break
    case 'image':
      renderImage(ctx, element, imageBitmap)
      break
    case 'scaleBar':
      renderScaleBar(ctx, element, groundMetersPerPagePx)
      break
    case 'legend':
      paintLegend(ctx, element, legendGroups)
      break
    case 'attributeTable':
      // No live selection query in the design-time editor — renderAttributeTable draws placeholder
      // sample rows when `rows` is omitted, purely to preview the table's shape/style.
      renderAttributeTable(ctx, element)
      break
    case 'popup':
      // Same reasoning as attributeTable — renderPopup draws a placeholder feature card when `data`
      // is omitted, purely to preview the card's shape/style.
      renderPopup(ctx, element)
      break
    case 'mapFrame':
      break
  }
}

// Reflects the element's own Container styling (border/fill/corner radius — the same fields every
// other element type's canvas renderer paints via paintContainer) instead of a fixed placeholder look,
// so the editor preview isn't misleadingly blank for settings that do take effect in the real output —
// falling back to the original dashed-box placeholder only where the designer hasn't set anything.
function MapFramePlaceholder ({ element }: { element: MapFrameElement }): React.ReactElement {
  const translate = hooks.useTranslation(defaultMessages)
  // Gated on strokeWidth alone — see paintContainer.ts's own matching comment on why requiring
  // strokeColor too is wrong (the color swatch shows black by default even when unset).
  const hasStroke = !!element.strokeWidth
  const hasFill = !!element.fill?.enabled
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hasFill ? element.fill.color : '#eef2f5',
        border: hasStroke ? `${element.strokeWidth}px solid ${element.strokeColor ?? '#000000'}` : '1px dashed var(--sys-color-divider-primary)',
        borderRadius: element.cornerRadius ?? 0,
        fontSize: 12
      }}
      className="text-disabled"
    >
      {translate('toolMap')}
    </div>
  )
}

export default ElementWrapper
