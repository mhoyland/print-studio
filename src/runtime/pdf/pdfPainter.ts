import type { jsPDF } from 'jspdf'
import type { Painter } from '../elementRenderers/painter'
import { isWinAnsiEncodable, parseCssFont, toPdfFont } from './fonts'

// A Painter (see elementRenderers/painter.ts) that writes vector PDF content through jsPDF's
// ordinary drawing API, so the same element renderers that paint the editor and the PNG export also
// produce the PDF. Why this rather than jsPDF's own canvas-like `context2d` plugin: that plugin
// measures text with the PDF font's metrics, so line breaks could differ from the on-screen preview
// and the PNG. Here, measureText is answered by a real (hidden) browser canvas using the exact same
// font string, so every renderer wraps and positions text precisely as it does on canvas — the PDF
// only places the finished lines. It also keeps full control over transforms, clipping, opacity and
// the one gradient the legend uses.
//
// Coordinates: renderers work in 150dpi page pixels (see pageSize.ts). `baseScale` (72/150) maps
// those to PDF points; jsPDF's own API takes top-left-origin points, so no Y flip is needed here.
// Canvas semantics are mirrored where the renderers rely on them: path points are transformed when
// added, lineWidth is applied in the transform current at stroke time, and a path survives fill() so
// it can be stroked afterwards.

type Matrix = [number, number, number, number, number, number] // a b c d e f: x' = a*x + c*y + e, y' = b*x + d*y + f

interface Rgba { r: number; g: number; b: number; a: number }

type Segment =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' }

interface State {
  matrix: Matrix
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
}

export interface PdfPainterOptions {
  // PDF points per renderer unit (page pixel).
  baseScale: number
  // Images to embed as JPEG rather than lossless PNG (the map screenshot: photographic, opaque, and by
  // far the largest image on the page).
  jpegImages?: Set<CanvasImageSource>
  jpegQuality?: number
}

// Resolution, in pixels per PDF point, of text runs that have to be drawn as images (see fillText) —
// about 600dpi, sharp in print while keeping each run's image small.
const RASTER_TEXT_PX_PER_PT = 600 / 72
// Fallback em-box offsets (fractions of font size, from the requested textBaseline down to the
// alphabetic baseline) for browsers whose TextMetrics lack fontBoundingBoxAscent. Close to Arial/Helvetica.
const FALLBACK_BASELINE_OFFSETS: { [baseline in CanvasTextBaseline]: number } = {
  top: 0.81, hanging: 0.63, middle: 0.31, alphabetic: 0, ideographic: -0.19, bottom: -0.19
}

class PdfLinearGradient implements CanvasGradient {
  readonly stops: Array<{ offset: number; color: Rgba }> = []
  constructor (readonly x0: number, readonly y0: number, readonly x1: number, readonly y1: number, private readonly parseColor: (color: string) => Rgba) {}

  addColorStop (offset: number, color: string): void {
    this.stops.push({ offset, color: this.parseColor(color) })
    this.stops.sort((a, b) => a.offset - b.offset)
  }

  colorAt (t: number): Rgba {
    const stops = this.stops
    if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 }
    if (t <= stops[0].offset) return stops[0].color
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i].offset) {
        const prev = stops[i - 1]
        const next = stops[i]
        const span = next.offset - prev.offset
        const k = span > 0 ? (t - prev.offset) / span : 1
        return {
          r: prev.color.r + (next.color.r - prev.color.r) * k,
          g: prev.color.g + (next.color.g - prev.color.g) * k,
          b: prev.color.b + (next.color.b - prev.color.b) * k,
          a: prev.color.a + (next.color.a - prev.color.a) * k
        }
      }
    }
    return stops[stops.length - 1].color
  }
}

export class PdfPainter implements Painter {
  private state: State
  private readonly stack: State[] = []
  private path: Segment[] = []
  // Current point and subpath start in *local* coordinates — arcTo needs the current point in the same
  // space as its own arguments. The renderers never change the transform mid-path, so this is exact.
  private currentLocal: { x: number; y: number } | null = null
  private subpathStartLocal: { x: number; y: number } | null = null

  private readonly measureCtx: CanvasRenderingContext2D
  private readonly colorCtx: CanvasRenderingContext2D
  private readonly colorCache = new Map<string, Rgba>()
  private readonly encodedImages = new Map<CanvasImageSource, { alias: string; data: string | HTMLCanvasElement }>()
  private readonly jpegImages: Set<CanvasImageSource>
  private readonly jpegQuality: number

  constructor (private readonly doc: jsPDF, options: PdfPainterOptions) {
    this.state = {
      matrix: [options.baseScale, 0, 0, options.baseScale, 0, 0],
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic'
    }
    this.jpegImages = options.jpegImages ?? new Set()
    this.jpegQuality = options.jpegQuality ?? 0.92
    this.measureCtx = document.createElement('canvas').getContext('2d')
    this.colorCtx = document.createElement('canvas').getContext('2d')
  }

  // --- state -------------------------------------------------------------------------------------

  get fillStyle (): string | CanvasGradient | CanvasPattern { return this.state.fillStyle }
  set fillStyle (value: string | CanvasGradient | CanvasPattern) { this.state.fillStyle = value }
  get strokeStyle (): string | CanvasGradient | CanvasPattern { return this.state.strokeStyle }
  set strokeStyle (value: string | CanvasGradient | CanvasPattern) { this.state.strokeStyle = value }
  get lineWidth (): number { return this.state.lineWidth }
  set lineWidth (value: number) { if (value > 0 && isFinite(value)) this.state.lineWidth = value }
  get font (): string { return this.state.font }
  set font (value: string) { this.state.font = value }
  get textAlign (): CanvasTextAlign { return this.state.textAlign }
  set textAlign (value: CanvasTextAlign) { this.state.textAlign = value }
  get textBaseline (): CanvasTextBaseline { return this.state.textBaseline }
  set textBaseline (value: CanvasTextBaseline) { this.state.textBaseline = value }

  save (): void {
    this.stack.push({ ...this.state, matrix: [...this.state.matrix] as Matrix })
    this.doc.saveGraphicsState()
  }

  restore (): void {
    const previous = this.stack.pop()
    if (!previous) return
    this.state = previous
    this.doc.restoreGraphicsState()
  }

  translate (x: number, y: number): void { this.transform([1, 0, 0, 1, x, y]) }
  scale (x: number, y: number): void { this.transform([x, 0, 0, y, 0, 0]) }
  rotate (angle: number): void {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    this.transform([cos, sin, -sin, cos, 0, 0])
  }

  private transform (n: Matrix): void {
    const m = this.state.matrix
    this.state.matrix = [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5]
    ]
  }

  private toPage (x: number, y: number): { x: number; y: number } {
    const m = this.state.matrix
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
  }

  // Uniform scale factor of the current transform (renderers never skew or scale non-uniformly).
  private get scaleFactor (): number {
    const m = this.state.matrix
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
  }

  // --- paths -------------------------------------------------------------------------------------

  beginPath (): void {
    this.path = []
    this.currentLocal = null
    this.subpathStartLocal = null
  }

  moveTo (x: number, y: number): void {
    this.path.push({ op: 'M', ...this.toPage(x, y) })
    this.currentLocal = { x, y }
    this.subpathStartLocal = { x, y }
  }

  lineTo (x: number, y: number): void {
    if (!this.currentLocal) { this.moveTo(x, y); return }
    this.path.push({ op: 'L', ...this.toPage(x, y) })
    this.currentLocal = { x, y }
  }

  closePath (): void {
    if (!this.currentLocal) return
    this.path.push({ op: 'Z' })
    this.currentLocal = this.subpathStartLocal
  }

  arc (x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
    const startX = x + radius * Math.cos(startAngle)
    const startY = y + radius * Math.sin(startAngle)
    if (this.currentLocal) this.lineTo(startX, startY)
    else this.moveTo(startX, startY)
    this.arcSegments(x, y, radius, startAngle, normalizeSweep(endAngle - startAngle, counterclockwise))
  }

  arcTo (x1: number, y1: number, x2: number, y2: number, radius: number): void {
    const p0 = this.currentLocal
    if (!p0) { this.moveTo(x1, y1); return }
    const v1 = { x: p0.x - x1, y: p0.y - y1 }
    const v2 = { x: x2 - x1, y: y2 - y1 }
    const len1 = Math.hypot(v1.x, v1.y)
    const len2 = Math.hypot(v2.x, v2.y)
    const cross = v1.x * v2.y - v1.y * v2.x
    // Degenerate cases draw a straight line to (x1, y1), exactly like canvas.
    if (radius <= 0 || len1 === 0 || len2 === 0 || Math.abs(cross) < 1e-9) { this.lineTo(x1, y1); return }

    const u1 = { x: v1.x / len1, y: v1.y / len1 }
    const u2 = { x: v2.x / len2, y: v2.y / len2 }
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))) / 2
    const tangentDist = radius / Math.tan(halfAngle)
    const t1 = { x: x1 + u1.x * tangentDist, y: y1 + u1.y * tangentDist }
    const t2 = { x: x1 + u2.x * tangentDist, y: y1 + u2.y * tangentDist }
    const bisector = { x: u1.x + u2.x, y: u1.y + u2.y }
    const bisectorLen = Math.hypot(bisector.x, bisector.y)
    const centerDist = radius / Math.sin(halfAngle)
    const center = { x: x1 + (bisector.x / bisectorLen) * centerDist, y: y1 + (bisector.y / bisectorLen) * centerDist }

    this.lineTo(t1.x, t1.y)
    const start = Math.atan2(t1.y - center.y, t1.x - center.x)
    const end = Math.atan2(t2.y - center.y, t2.x - center.x)
    let sweep = end - start
    while (sweep > Math.PI) sweep -= Math.PI * 2
    while (sweep < -Math.PI) sweep += Math.PI * 2
    this.arcSegments(center.x, center.y, radius, start, sweep)
  }

  // Appends an arc (already starting at the current point) as cubic Béziers of at most 90° each.
  private arcSegments (cx: number, cy: number, radius: number, start: number, sweep: number): void {
    if (sweep === 0 || radius <= 0) return
    const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9))
    const step = sweep / count
    const k = (4 / 3) * Math.tan(step / 4)
    let angle = start
    for (let i = 0; i < count; i++) {
      const next = angle + step
      const cos0 = Math.cos(angle)
      const sin0 = Math.sin(angle)
      const cos1 = Math.cos(next)
      const sin1 = Math.sin(next)
      const c1 = this.toPage(cx + radius * (cos0 - k * sin0), cy + radius * (sin0 + k * cos0))
      const c2 = this.toPage(cx + radius * (cos1 + k * sin1), cy + radius * (sin1 - k * cos1))
      const end = { x: cx + radius * cos1, y: cy + radius * sin1 }
      const endPage = this.toPage(end.x, end.y)
      this.path.push({ op: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: endPage.x, y: endPage.y })
      this.currentLocal = end
      angle = next
    }
  }

  private emitPath (segments: Segment[]): boolean {
    if (!segments.some((segment) => segment.op !== 'M' && segment.op !== 'Z')) return false
    for (const segment of segments) {
      switch (segment.op) {
        case 'M': this.doc.moveTo(segment.x, segment.y); break
        case 'L': this.doc.lineTo(segment.x, segment.y); break
        case 'C': this.doc.curveTo(segment.x1, segment.y1, segment.x2, segment.y2, segment.x, segment.y); break
        case 'Z': this.doc.close(); break
      }
    }
    return true
  }

  fill (): void {
    if (this.state.fillStyle instanceof PdfLinearGradient) {
      // Only fillRect (the legend's colour ramps) needs a true gradient; a general path gets its
      // average colour rather than nothing.
      this.fillPath(this.path, this.state.fillStyle.colorAt(0.5))
      return
    }
    this.fillPath(this.path, this.resolveColor(this.state.fillStyle))
  }

  stroke (): void {
    const color = this.resolveColor(this.state.strokeStyle)
    if (color.a <= 0) return
    this.withOpacity(color.a, 'stroke', () => {
      this.doc.setDrawColor(color.r, color.g, color.b)
      this.doc.setLineWidth(this.state.lineWidth * this.scaleFactor)
      if (this.emitPath(this.path)) this.doc.stroke()
    })
  }

  clip (): void {
    if (!this.emitPath(this.path)) return
    this.doc.clip()
    this.doc.discardPath()
  }

  private fillPath (segments: Segment[], color: Rgba): void {
    if (color.a <= 0) return
    this.withOpacity(color.a, 'fill', () => {
      this.doc.setFillColor(color.r, color.g, color.b)
      if (this.emitPath(segments)) this.doc.fill()
    })
  }

  // fillRect/strokeRect leave the current path untouched, as on canvas.
  private rectSegments (x: number, y: number, w: number, h: number): Segment[] {
    return [
      { op: 'M', ...this.toPage(x, y) },
      { op: 'L', ...this.toPage(x + w, y) },
      { op: 'L', ...this.toPage(x + w, y + h) },
      { op: 'L', ...this.toPage(x, y + h) },
      { op: 'Z' }
    ]
  }

  fillRect (x: number, y: number, w: number, h: number): void {
    const style = this.state.fillStyle
    if (style instanceof PdfLinearGradient) {
      this.fillGradientRect(style, x, y, w, h)
      return
    }
    this.fillPath(this.rectSegments(x, y, w, h), this.resolveColor(style))
  }

  strokeRect (x: number, y: number, w: number, h: number): void {
    const saved = this.path
    this.path = this.rectSegments(x, y, w, h)
    this.stroke()
    this.path = saved
  }

  // A horizontal (or vertical) linear gradient drawn as thin vector bands, each slightly overlapping
  // the next so viewers don't show hairline seams between them. ~0.5pt bands are visually smooth.
  private fillGradientRect (gradient: PdfLinearGradient, x: number, y: number, w: number, h: number): void {
    const horizontal = Math.abs(gradient.x1 - gradient.x0) >= Math.abs(gradient.y1 - gradient.y0)
    const axisStart = horizontal ? gradient.x0 : gradient.y0
    const axisLength = (horizontal ? gradient.x1 - gradient.x0 : gradient.y1 - gradient.y0) || 1
    const extent = horizontal ? w : h
    const bandCount = Math.max(2, Math.min(256, Math.ceil((Math.abs(extent) * this.scaleFactor) / 0.5)))
    const bandSize = extent / bandCount
    for (let i = 0; i < bandCount; i++) {
      const bandStart = (horizontal ? x : y) + i * bandSize
      const t = (bandStart + bandSize / 2 - axisStart) / axisLength
      const overlap = i < bandCount - 1 ? bandSize * 0.5 : 0
      const segments = horizontal
        ? this.rectSegments(bandStart, y, bandSize + overlap, h)
        : this.rectSegments(x, bandStart, w, bandSize + overlap)
      this.fillPath(segments, gradient.colorAt(Math.max(0, Math.min(1, t))))
    }
  }

  createLinearGradient (x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    return new PdfLinearGradient(x0, y0, x1, y1, (color) => this.parseColor(color))
  }

  // --- text --------------------------------------------------------------------------------------

  measureText (text: string): TextMetrics {
    this.measureCtx.font = this.state.font
    this.measureCtx.textAlign = this.state.textAlign
    this.measureCtx.textBaseline = this.state.textBaseline
    return this.measureCtx.measureText(text)
  }

  fillText (text: string, x: number, y: number): void {
    if (!text) return
    const style = this.state.fillStyle
    const color = style instanceof PdfLinearGradient ? style.colorAt(0) : this.resolveColor(style)
    if (color.a <= 0) return

    if (!isWinAnsiEncodable(text)) {
      this.fillTextAsImage(text, x, y)
      return
    }

    const parsed = parseCssFont(this.state.font)
    const pdfFont = toPdfFont(parsed)
    const scale = this.scaleFactor
    this.doc.setFont(pdfFont.name, pdfFont.style)
    this.doc.setFontSize(parsed.sizePx * scale)

    // Horizontal alignment uses the PDF font's own width, so right/centre-aligned text ends exactly
    // where it should even if the browser font's width differs slightly. Line breaks were already
    // decided by the renderer using measureText (the browser font), so they match the preview.
    const widthLocal = this.doc.getTextWidth(text) / scale
    const align = this.state.textAlign
    const alignOffset = align === 'right' || align === 'end' ? -widthLocal : align === 'center' ? -widthLocal / 2 : 0
    const anchor = this.toPage(x + alignOffset, y + this.baselineOffset(parsed.sizePx))
    const m = this.state.matrix
    const angle = -(Math.atan2(m[1], m[0]) * 180) / Math.PI

    this.withOpacity(color.a, 'fill', () => {
      this.doc.setTextColor(color.r, color.g, color.b)
      this.doc.text(text, anchor.x, anchor.y, { baseline: 'alphabetic', ...(Math.abs(angle) > 1e-6 ? { angle } : {}) })
    })
  }

  // Distance (local px, downward) from the line textBaseline names to the alphabetic baseline jsPDF
  // positions text on — measured with the browser's own font so it matches canvas exactly.
  private baselineOffset (sizePx: number): number {
    const baseline = this.state.textBaseline
    if (baseline === 'alphabetic') return 0
    this.measureCtx.font = this.state.font
    this.measureCtx.textBaseline = 'alphabetic'
    const fromAlphabetic = this.measureCtx.measureText('Hg').fontBoundingBoxAscent
    this.measureCtx.textBaseline = baseline
    const fromRequested = this.measureCtx.measureText('Hg').fontBoundingBoxAscent
    if (typeof fromAlphabetic !== 'number' || typeof fromRequested !== 'number' || !isFinite(fromAlphabetic - fromRequested)) {
      return FALLBACK_BASELINE_OFFSETS[baseline] * sizePx
    }
    return fromAlphabetic - fromRequested
  }

  // Characters outside the standard fonts' WinAnsi set (see fonts.ts) are drawn by the browser onto a
  // small high-resolution canvas and embedded as an image at the exact spot canvas would have drawn
  // them — correct and sharp, though not selectable as text.
  private fillTextAsImage (text: string, x: number, y: number): void {
    const metrics = this.measureText(text)
    const pad = 2
    const left = (metrics.actualBoundingBoxLeft ?? 0) + pad
    const right = (metrics.actualBoundingBoxRight ?? metrics.width) + pad
    const ascent = (metrics.actualBoundingBoxAscent ?? parseCssFont(this.state.font).sizePx) + pad
    const descent = (metrics.actualBoundingBoxDescent ?? 0) + pad
    const widthLocal = left + right
    const heightLocal = ascent + descent
    const resolution = RASTER_TEXT_PX_PER_PT * this.scaleFactor

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(widthLocal * resolution))
    canvas.height = Math.max(1, Math.ceil(heightLocal * resolution))
    const ctx = canvas.getContext('2d')
    ctx.scale(resolution, resolution)
    ctx.font = this.state.font
    ctx.textAlign = this.state.textAlign
    ctx.textBaseline = this.state.textBaseline
    ctx.fillStyle = typeof this.state.fillStyle === 'string' ? this.state.fillStyle : '#000000'
    ctx.fillText(text, left, ascent)
    this.drawImage(canvas, x - left, y - ascent, widthLocal, heightLocal)
  }

  // --- images ------------------------------------------------------------------------------------

  drawImage (image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void {
    const corners = [this.toPage(dx, dy), this.toPage(dx + dw, dy + dh)]
    const x = Math.min(corners[0].x, corners[1].x)
    const y = Math.min(corners[0].y, corners[1].y)
    const w = Math.abs(corners[1].x - corners[0].x)
    const h = Math.abs(corners[1].y - corners[0].y)
    if (w <= 0 || h <= 0) return

    const isJpeg = this.jpegImages.has(image)
    let encoded = this.encodedImages.get(image)
    if (!encoded) {
      // Encoded once per source; the alias makes jsPDF embed a reused image only once in the file.
      encoded = { alias: `img${this.encodedImages.size + 1}`, data: this.encodeImage(image, isJpeg) }
      this.encodedImages.set(image, encoded)
    }
    this.doc.addImage(encoded.data, isJpeg ? 'JPEG' : 'PNG', x, y, w, h, encoded.alias, isJpeg ? 'NONE' : 'FAST')
  }

  private encodeImage (image: CanvasImageSource, asJpeg: boolean): string | HTMLCanvasElement {
    const size = imageSize(image)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, size.width)
    canvas.height = Math.max(1, size.height)
    const ctx = canvas.getContext('2d')
    if (asJpeg) {
      // JPEG has no alpha: flatten onto white, as the page itself is white.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return asJpeg ? canvas.toDataURL('image/jpeg', this.jpegQuality) : canvas
  }

  // --- colour & opacity --------------------------------------------------------------------------

  private resolveColor (style: string | CanvasGradient | CanvasPattern): Rgba {
    if (typeof style === 'string') return this.parseColor(style)
    if (style instanceof PdfLinearGradient) return style.colorAt(0)
    return { r: 0, g: 0, b: 0, a: 1 }
  }

  // Lets the browser parse any CSS colour (hex, rgb[a](), named, 'transparent') by assigning it to a
  // canvas fillStyle and reading back the normalised form — invalid colours are ignored exactly as a
  // real canvas would ignore them.
  private parseColor (color: string): Rgba {
    const cached = this.colorCache.get(color)
    if (cached) return cached
    this.colorCtx.fillStyle = '#000000'
    this.colorCtx.fillStyle = color
    const normalized = String(this.colorCtx.fillStyle)
    let result: Rgba = { r: 0, g: 0, b: 0, a: 1 }
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized)
    const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(normalized)
    if (hex) {
      result = { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 }
    } else if (rgba) {
      result = { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) }
    }
    this.colorCache.set(color, result)
    return result
  }

  private withOpacity (alpha: number, kind: 'fill' | 'stroke', draw: () => void): void {
    if (alpha >= 1) { draw(); return }
    this.doc.saveGraphicsState()
    // jsPDF's typings declare GState as a method, but it is a constructor at runtime.
    const GStateCtor = (this.doc as unknown as { GState: new (params: { opacity?: number; 'stroke-opacity'?: number }) => unknown }).GState
    this.doc.setGState(new GStateCtor(kind === 'fill' ? { opacity: alpha } : { 'stroke-opacity': alpha }))
    draw()
    this.doc.restoreGraphicsState()
  }
}

// Canvas arc() sweep rules: a clockwise arc whose end is before its start wraps forward, and any sweep
// of a full turn or more draws exactly one full circle.
function normalizeSweep (sweep: number, counterclockwise: boolean): number {
  const fullTurn = Math.PI * 2
  if (!counterclockwise) {
    if (sweep >= fullTurn) return fullTurn
    const wrapped = ((sweep % fullTurn) + fullTurn) % fullTurn
    return wrapped
  }
  if (-sweep >= fullTurn) return -fullTurn
  const wrapped = ((-sweep % fullTurn) + fullTurn) % fullTurn
  return -wrapped
}

function imageSize (image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
  if (image instanceof HTMLVideoElement) return { width: image.videoWidth, height: image.videoHeight }
  if (image instanceof SVGImageElement) return { width: image.width.baseVal.value, height: image.height.baseVal.value }
  const sized = image as { width: number; height: number }
  return { width: Math.round(sized.width), height: Math.round(sized.height) }
}
