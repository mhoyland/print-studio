import type { ElementBase } from '../../config'
import type { Painter } from './painter'

// Shared border/fill painting for any element that opts into the ElementBase styling fields.
export function paintContainer (ctx: Painter, element: ElementBase): void {
  const hasFill = !!element.fill?.enabled
  // Gated on strokeWidth alone, not also strokeColor — the properties panel's color swatch already
  // shows black (via its own `?? '#000000'` display fallback) whenever strokeColor is unset, so an
  // element whose stroke width was set without ever touching the color picker (e.g. a mapFrame, whose
  // one creation site doesn't pre-seed any Container defaults the way rect/table/popup do) would
  // otherwise silently draw no border at all despite the panel visually showing one is configured.
  const hasStroke = !!element.strokeWidth
  const strokeColor = element.strokeColor ?? '#000000'
  if (!hasFill && !hasStroke) return

  // Canvas strokes are centered on the traced path — half the border width would otherwise fall
  // outside element.x/y/w/h. That's invisible on the shared export canvas (plenty of margin around
  // every element there) but gets silently clipped in the live editor, where each element paints
  // into its own canvas sized to exactly w×h. Insetting by half the stroke width keeps the entire
  // border inside the element's own bounds in both places.
  const inset = hasStroke ? element.strokeWidth / 2 : 0
  const x = element.x + inset
  const y = element.y + inset
  const w = Math.max(0, element.w - inset * 2)
  const h = Math.max(0, element.h - inset * 2)
  const radius = Math.max(0, (element.cornerRadius ?? 0) - inset)

  ctx.save()
  traceRoundedRect(ctx, x, y, w, h, radius)
  if (hasFill) {
    ctx.fillStyle = element.fill.color
    ctx.fill()
  }
  if (hasStroke) {
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = element.strokeWidth
    ctx.stroke()
  }
  ctx.restore()
}

// Exported for mapFrame's export-canvas rendering (exportRenderer.ts), which needs to clip the map
// screenshot image to the same rounded-rect shape paintContainer's own stroke traces — every other
// element type's content is drawn by canvas fill/stroke/text calls that never need this directly.
export function traceRoundedRect (ctx: Painter, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
