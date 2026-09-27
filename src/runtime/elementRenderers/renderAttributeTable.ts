import type { AttributeTableElement } from '../../config'
import { paintContainer } from './paintContainer'
import { drawRowDivider, drawColumnDividers, wrapText, drawSingleLine, countFittingRows } from './textLayout'
import type { Painter } from './painter'

export const DEFAULT_FONT_SIZE = 11
export const DEFAULT_HEADER_FILL = '#e6ddf7'
const DEFAULT_HEADER_TEXT_COLOR = '#000000'
const DEFAULT_BODY_TEXT_COLOR = '#000000'
const ROW_DIVIDER_COLOR = '#dcdcdc'
const OVERFLOW_TEXT_COLOR = '#767676'
const CELL_PADDING_X = 4
const CELL_PADDING_Y = 3
const OUTER_PADDING = 6
const MAX_LINES_PER_CELL = 3
const NUMBER_COLUMN_LABEL = '#'

interface RowPlan { wrappedCells: string[][]; height: number }

// `rows` is the pre-fetched, already-formatted selected-feature data (see exportRenderer.ts's
// preloadAttributeTableRows), one row per selected feature and one string per element.fields entry,
// in that same order. It's `undefined` in the live editor, which never queries the map — a few
// placeholder rows are drawn instead purely to show the table's shape/style while laying it out. An
// empty array (queried at export time, nothing selected) is deliberately treated differently: that
// prints as a headers-only table rather than falling back to placeholder text, so a designer can tell
// "nothing selected" apart from "still loading".
export function renderAttributeTable (ctx: Painter, element: AttributeTableElement, rows?: string[][]): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return

  const columns = element.fields
  if (columns.length === 0) {
    paintContainer(ctx, element)
    return
  }

  const fontSize = element.fontSize ?? DEFAULT_FONT_SIZE
  const scale = fontSize / DEFAULT_FONT_SIZE
  const lineHeight = fontSize * 1.3
  const cellPaddingX = CELL_PADDING_X * scale
  const cellPaddingY = CELL_PADDING_Y * scale
  const outerPadding = OUTER_PADDING * scale

  const dataRows = rows ?? Array.from({ length: 3 }, () => columns.map(() => 'Sample'))

  const showTitle = element.showTitle ?? true
  const showRowNumbers = element.showRowNumbers ?? true
  const titleHeight = showTitle ? lineHeight + cellPaddingY * 2 : 0

  // Border/fill now cover the whole element, title included, rather than being scoped to just the
  // table grid sub-rect below it — otherwise a chosen background color left the title line sitting on
  // bare canvas above a visibly separate filled box, which read as a rendering bug rather than styling.
  const tableTop = element.y + titleHeight
  const tableHeight = element.h - titleHeight
  paintContainer(ctx, element)

  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.font = `${fontSize}px sans-serif`

  if (showTitle) {
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillStyle = element.bodyTextColor ?? DEFAULT_BODY_TEXT_COLOR
    const titleText = `${element.title ?? element.name} | Total count: ${dataRows.length}`
    drawSingleLine(ctx, titleText, element.x + outerPadding, element.y + titleHeight / 2, element.w - outerPadding * 2)
  }

  const availableWidth = element.w - outerPadding * 2
  const availableHeight = tableHeight - outerPadding * 2
  const tableX = element.x + outerPadding
  const tableY = tableTop + outerPadding

  ctx.font = `bold ${fontSize}px sans-serif`
  const numberColumnWidth = showRowNumbers
    ? Math.max(20 * scale, ctx.measureText(String(dataRows.length)).width + cellPaddingX * 2)
    : 0
  const dataColumnWidth = (availableWidth - numberColumnWidth) / columns.length

  const headerFill = element.headerFill ?? DEFAULT_HEADER_FILL
  const headerTextColor = element.headerTextColor ?? DEFAULT_HEADER_TEXT_COLOR
  const bodyTextColor = element.bodyTextColor ?? DEFAULT_BODY_TEXT_COLOR
  const labels = columns.map((field) => element.fieldLabels?.[field] ?? field)
  const headerRowHeight = lineHeight + cellPaddingY * 2

  // Header row
  ctx.fillStyle = headerFill
  ctx.fillRect(tableX, tableY, availableWidth, Math.min(headerRowHeight, availableHeight))
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.fillStyle = headerTextColor
  if (showRowNumbers) {
    drawSingleLine(ctx, NUMBER_COLUMN_LABEL, tableX + cellPaddingX, tableY + headerRowHeight / 2, numberColumnWidth - cellPaddingX * 2)
  }
  labels.forEach((label, index) => {
    const cellX = tableX + numberColumnWidth + index * dataColumnWidth
    drawSingleLine(ctx, label, cellX + cellPaddingX, tableY + headerRowHeight / 2, dataColumnWidth - cellPaddingX * 2)
  })
  drawRowDivider(ctx, tableX, tableY + headerRowHeight, availableWidth, ROW_DIVIDER_COLOR)

  // Body rows — wrapped onto multiple lines (up to MAX_LINES_PER_CELL) rather than truncated to a
  // single line, so a long value like a category name reads in full instead of getting cut off with
  // an ellipsis. Each row's own height follows its tallest cell, so short rows stay compact and only
  // a long value pushes its own row taller — not every row uniformly.
  ctx.font = `${fontSize}px sans-serif`
  const rowPlans: RowPlan[] = dataRows.map((row) => {
    const wrappedCells = columns.map((_field, colIndex) => wrapText(ctx, row[colIndex] ?? '', dataColumnWidth - cellPaddingX * 2, MAX_LINES_PER_CELL))
    const lineCount = Math.min(MAX_LINES_PER_CELL, Math.max(1, ...wrappedCells.map((lines) => lines.length)))
    return { wrappedCells, height: lineCount * lineHeight + cellPaddingY * 2 }
  })

  const bodyTop = tableY + headerRowHeight
  const bottom = tableY + availableHeight
  const overflowRowHeight = lineHeight + cellPaddingY * 2

  // Rows that don't fit print as a final "+N more" summary line rather than clipping mid-row — first
  // try fitting everything with no reservation, and only reserve a slot for that summary line if a
  // first pass shows not everything actually fits.
  const rowHeights = rowPlans.map((plan) => plan.height)
  let rowsShown = countFittingRows(rowHeights, bodyTop, bottom, overflowRowHeight, false)
  if (rowsShown < rowPlans.length) {
    rowsShown = countFittingRows(rowHeights, bodyTop, bottom, overflowRowHeight, true)
  }

  let cursorY = bodyTop
  for (let rowIndex = 0; rowIndex < rowsShown; rowIndex++) {
    const { wrappedCells, height } = rowPlans[rowIndex]
    ctx.fillStyle = bodyTextColor
    if (showRowNumbers) {
      drawSingleLine(ctx, String(rowIndex + 1), tableX + cellPaddingX, cursorY + height / 2, numberColumnWidth - cellPaddingX * 2)
    }
    columns.forEach((_field, colIndex) => {
      const cellX = tableX + numberColumnWidth + colIndex * dataColumnWidth
      const lines = wrappedCells[colIndex]
      const blockHeight = lines.length * lineHeight
      const startY = cursorY + (height - blockHeight) / 2 + lineHeight / 2
      lines.forEach((line, lineIndex) => { ctx.fillText(line, cellX + cellPaddingX, startY + lineIndex * lineHeight) })
    })
    cursorY += height
    drawRowDivider(ctx, tableX, cursorY, availableWidth, ROW_DIVIDER_COLOR)
  }

  // Vertical grid lines between columns (including between the "#" column and the first field),
  // spanning the header and whatever body rows actually got drawn — but not the "+N more" line below,
  // which reads as a plain caption rather than another row in the grid.
  const columnBoundaries: number[] = []
  if (showRowNumbers) columnBoundaries.push(tableX + numberColumnWidth)
  for (let index = 1; index < columns.length; index++) {
    columnBoundaries.push(tableX + numberColumnWidth + index * dataColumnWidth)
  }
  drawColumnDividers(ctx, columnBoundaries, tableY, cursorY, ROW_DIVIDER_COLOR)

  const overflowCount = dataRows.length - rowsShown
  if (overflowCount > 0) {
    ctx.font = `italic ${fontSize}px sans-serif`
    ctx.fillStyle = OVERFLOW_TEXT_COLOR
    drawSingleLine(ctx, `+${overflowCount} more`, tableX + cellPaddingX, cursorY + overflowRowHeight / 2, availableWidth - cellPaddingX * 2)
  }

  ctx.restore()
}

