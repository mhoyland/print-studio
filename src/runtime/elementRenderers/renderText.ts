import type { TextElement } from '../../config'
import { paintContainer } from './paintContainer'
import type { Painter } from './painter'

// Keeps the text off the element's own edges regardless of alignment — most noticeable with a
// background fill or border, where flush-left/flush-top text otherwise reads as touching the edge of
// its own box, but applied unconditionally since unshaded text benefits from the same small margin.
const TEXT_PADDING = 4

export function renderText (ctx: Painter, element: TextElement): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return
  paintContainer(ctx, element)

  ctx.save()
  ctx.font = `${element.fontWeight} ${element.fontSize}px ${element.fontFamily}`
  ctx.fillStyle = element.color
  ctx.textBaseline = 'top'
  ctx.textAlign = element.align

  const x = element.align === 'right'
    ? element.x + element.w - TEXT_PADDING
    : element.align === 'center'
      ? element.x + element.w / 2
      : element.x + TEXT_PADDING

  const lineHeight = element.fontSize * 1.25
  const availableWidth = Math.max(0, element.w - TEXT_PADDING * 2)
  const lines = wrapLines(ctx, element.text, availableWidth)
  const totalHeight = lines.length * lineHeight
  const startY = getStartY(element, totalHeight)

  lines.forEach((line, index) => { ctx.fillText(line, x, startY + index * lineHeight) })
  ctx.restore()
}

// Defaults to vertically centered — if the wrapped text is taller than element.h, 'middle' overflows
// evenly above and below rather than only downward, which reads better than a top-anchored block by
// default. 'top'/'bottom' anchor to that edge instead (with the same TEXT_PADDING margin), for anyone
// who wants the old fixed behavior. 'middle' needs no padding of its own — a centered block is never
// touching the top/bottom edge unless it's already overflowing the box entirely.
function getStartY (element: TextElement, totalHeight: number): number {
  const verticalAlign = element.verticalAlign ?? 'middle'
  switch (verticalAlign) {
    case 'top':
      return element.y + TEXT_PADDING
    case 'bottom':
      return element.y + (element.h - totalHeight) - TEXT_PADDING
    case 'middle':
      return element.y + (element.h - totalHeight) / 2
  }
}

// Splits on explicit newlines first (so a user-entered line break always produces one, matching the
// runtime input's multi-line textarea) and then word-wraps each paragraph independently. Returns the
// wrapped lines rather than drawing them directly, since the total line count is needed up front to
// center the block vertically before anything is painted.
function wrapLines (ctx: Painter, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    lines.push(...wrapParagraph(ctx, paragraph, maxWidth))
  }
  return lines
}

function wrapParagraph (ctx: Painter, paragraph: string, maxWidth: number): string[] {
  const words = paragraph.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word
    if (line && ctx.measureText(testLine).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = testLine
    }
  }
  lines.push(line)
  return lines
}
