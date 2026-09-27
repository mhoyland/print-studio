import type { Painter } from './painter'

// Small canvas text-layout helpers shared by any renderer that lays out cells/labels in a grid —
// currently renderAttributeTable.ts and renderPopup.ts. Kept framework-free (just ctx in, geometry
// out) so it stays trivially reusable without dragging in either renderer's own element type.

export function drawRowDivider (ctx: Painter, x: number, y: number, width: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + width, y)
  ctx.stroke()
  ctx.restore()
}

export function drawColumnDividers (ctx: Painter, xPositions: number[], top: number, bottom: number, color: string): void {
  if (xPositions.length === 0) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  xPositions.forEach((x) => {
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
  })
  ctx.stroke()
  ctx.restore()
}

// Word-wraps into up to `maxLines` lines; if the text still doesn't fit in that many lines, the last
// shown line gets truncated with an ellipsis rather than silently dropping the rest.
export function wrapText (ctx: Painter, text: string, maxWidth: number, maxLines: number): string[] {
  if (maxWidth <= 0) return [text]
  const words = text.split(' ')
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

  if (lines.length <= maxLines) return lines
  const shown = lines.slice(0, maxLines)
  shown[maxLines - 1] = ellipsize(ctx, shown[maxLines - 1], maxWidth)
  return shown
}

// How many leading rows (by height, top to bottom) fit within [top, bottom]. When `reserveOverflowSlot`
// is set, every row except the very last one considered must also leave room for a trailing "+N more"
// summary line afterward — callers typically call this once without reservation, and only redo it
// with reservation if that first pass shows not everything actually fits.
export function countFittingRows (rowHeights: number[], top: number, bottom: number, overflowRowHeight: number, reserveOverflowSlot: boolean): number {
  let cursorY = top
  let shown = 0
  for (; shown < rowHeights.length; shown++) {
    const isLastRow = shown === rowHeights.length - 1
    const reservation = reserveOverflowSlot && !isLastRow ? overflowRowHeight : 0
    if (cursorY + rowHeights[shown] + reservation > bottom) break
    cursorY += rowHeights[shown]
  }
  return shown
}

export function drawSingleLine (ctx: Painter, text: string, x: number, y: number, maxWidth: number): void {
  if (maxWidth <= 0) return
  ctx.fillText(ellipsize(ctx, text, maxWidth), x, y)
}

export function ellipsize (ctx: Painter, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let displayText = text
  while (displayText.length > 0 && ctx.measureText(`${displayText}…`).width > maxWidth) {
    displayText = displayText.slice(0, -1)
  }
  return displayText.length > 0 ? `${displayText}…` : ''
}
