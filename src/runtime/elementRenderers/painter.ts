// The drawing surface every element renderer paints onto — exactly the subset of Canvas 2D these
// renderers actually use, and nothing more. A real CanvasRenderingContext2D satisfies it structurally
// (live editor canvases, the PNG export canvas), and pdf/pdfPainter.ts implements it over jsPDF for
// vector PDF export (spec Phase 13). Renderers are typed against this rather than the full canvas
// context so the compiler flags any newly used canvas feature the PDF backend doesn't support yet,
// instead of it silently going missing from PDF output.
export interface Painter {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline

  save: () => void
  restore: () => void
  translate: (x: number, y: number) => void
  rotate: (angle: number) => void
  scale: (x: number, y: number) => void

  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean) => void
  arcTo: (x1: number, y1: number, x2: number, y2: number, radius: number) => void
  closePath: () => void
  fill: () => void
  stroke: () => void
  clip: () => void

  fillRect: (x: number, y: number, w: number, h: number) => void
  strokeRect: (x: number, y: number, w: number, h: number) => void
  fillText: (text: string, x: number, y: number) => void
  measureText: (text: string) => TextMetrics
  drawImage: (image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) => void
  createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => CanvasGradient
}
