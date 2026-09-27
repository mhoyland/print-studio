import type { PopupElement } from '../../config'
import { paintContainer } from './paintContainer'
import { drawRowDivider, drawColumnDividers, wrapText, drawSingleLine, countFittingRows } from './textLayout'
import type { Painter } from './painter'

export const DEFAULT_FONT_SIZE = 11
const DEFAULT_TITLE_TEXT_COLOR = '#000000'
const DEFAULT_LABEL_TEXT_COLOR = '#6e6e6e'
const DEFAULT_VALUE_TEXT_COLOR = '#000000'
const ROW_DIVIDER_COLOR = '#dcdcdc'
const OVERFLOW_TEXT_COLOR = '#767676'
const CELL_PADDING_X = 4
const CELL_PADDING_Y = 3
const OUTER_PADDING = 6
const MAX_LINES_PER_CELL = 3
const LABEL_COLUMN_RATIO = 0.4

export interface PopupData { title: string; values: { [jimuFieldName: string]: string } }

interface RowPlan { labelLines: string[]; valueLines: string[]; height: number }

// `data` is the pre-fetched popup info for the layer's first selected feature (see exportRenderer.ts's
// preloadPopupData) — `undefined` in the live editor, which never queries the map (a placeholder
// feature is drawn instead, purely to preview the card's shape/style); `null` when queried at export
// time but nothing is selected (prints the field labels with blank values, so it reads as intentional
// rather than broken, same philosophy as AttributeTableElement's headers-only empty state); otherwise
// the real title + field values for the first selected feature ("first" because only a single feature
// is ever shown here, per this element's whole premise).
export function renderPopup (ctx: Painter, element: PopupElement, data?: PopupData | null): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return

  const fields = element.fields
  if (fields.length === 0) {
    paintContainer(ctx, element)
    return
  }

  const fontSize = element.fontSize ?? DEFAULT_FONT_SIZE
  const scale = fontSize / DEFAULT_FONT_SIZE
  const lineHeight = fontSize * 1.3
  const cellPaddingX = CELL_PADDING_X * scale
  const cellPaddingY = CELL_PADDING_Y * scale
  const outerPadding = OUTER_PADDING * scale

  const isPlaceholder = data === undefined
  const titleText = isPlaceholder ? 'Sample feature' : (data?.title ?? element.title ?? element.name)
  const values: { [field: string]: string } = isPlaceholder
    ? Object.fromEntries(fields.map((field) => [field, 'Sample value']))
    : (data?.values ?? {})

  // Border/fill now cover the whole element, title included, rather than being scoped to just the
  // field-list card sub-rect below it — see the matching comment in renderAttributeTable.ts.
  const titleHeight = lineHeight + cellPaddingY * 2
  const cardTop = element.y + titleHeight
  const cardHeight = element.h - titleHeight
  paintContainer(ctx, element)

  ctx.save()
  ctx.textBaseline = 'middle'

  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.fillStyle = element.titleTextColor ?? DEFAULT_TITLE_TEXT_COLOR
  drawSingleLine(ctx, titleText, element.x + outerPadding, element.y + titleHeight / 2, element.w - outerPadding * 2)

  const availableWidth = element.w - outerPadding * 2
  const availableHeight = cardHeight - outerPadding * 2
  const tableX = element.x + outerPadding
  const tableY = cardTop + outerPadding
  const bottom = tableY + availableHeight

  const labelColumnWidth = Math.max(50 * scale, availableWidth * LABEL_COLUMN_RATIO)
  const valueColumnWidth = availableWidth - labelColumnWidth
  const labelTextColor = element.labelTextColor ?? DEFAULT_LABEL_TEXT_COLOR
  const valueTextColor = element.valueTextColor ?? DEFAULT_VALUE_TEXT_COLOR
  const labels = fields.map((field) => element.fieldLabels?.[field] ?? field)

  // Each field is its own row — label in a narrower left column, value in the rest — wrapped onto up
  // to MAX_LINES_PER_CELL lines each rather than truncated to one, matching AttributeTableElement's
  // per-row dynamic height so a long value doesn't get cut off.
  ctx.font = `${fontSize}px sans-serif`
  const rowPlans: RowPlan[] = fields.map((field, index) => {
    const labelLines = wrapText(ctx, labels[index], labelColumnWidth - cellPaddingX * 2, MAX_LINES_PER_CELL)
    const valueLines = wrapText(ctx, values[field] ?? '', valueColumnWidth - cellPaddingX * 2, MAX_LINES_PER_CELL)
    const lineCount = Math.max(1, labelLines.length, valueLines.length)
    return { labelLines, valueLines, height: lineCount * lineHeight + cellPaddingY * 2 }
  })

  const overflowRowHeight = lineHeight + cellPaddingY * 2
  const rowHeights = rowPlans.map((plan) => plan.height)
  let rowsShown = countFittingRows(rowHeights, tableY, bottom, overflowRowHeight, false)
  if (rowsShown < rowPlans.length) {
    rowsShown = countFittingRows(rowHeights, tableY, bottom, overflowRowHeight, true)
  }

  let cursorY = tableY
  for (let rowIndex = 0; rowIndex < rowsShown; rowIndex++) {
    const { labelLines, valueLines, height } = rowPlans[rowIndex]

    ctx.fillStyle = labelTextColor
    const labelBlockHeight = labelLines.length * lineHeight
    const labelStartY = cursorY + (height - labelBlockHeight) / 2 + lineHeight / 2
    labelLines.forEach((line, lineIndex) => { ctx.fillText(line, tableX + cellPaddingX, labelStartY + lineIndex * lineHeight) })

    ctx.fillStyle = valueTextColor
    const valueBlockHeight = valueLines.length * lineHeight
    const valueStartY = cursorY + (height - valueBlockHeight) / 2 + lineHeight / 2
    valueLines.forEach((line, lineIndex) => { ctx.fillText(line, tableX + labelColumnWidth + cellPaddingX, valueStartY + lineIndex * lineHeight) })

    cursorY += height
    drawRowDivider(ctx, tableX, cursorY, availableWidth, ROW_DIVIDER_COLOR)
  }

  drawColumnDividers(ctx, [tableX + labelColumnWidth], tableY, cursorY, ROW_DIVIDER_COLOR)

  const overflowCount = fields.length - rowsShown
  if (overflowCount > 0) {
    ctx.font = `italic ${fontSize}px sans-serif`
    ctx.fillStyle = OVERFLOW_TEXT_COLOR
    const label = `+${overflowCount} more field${overflowCount === 1 ? '' : 's'}`
    drawSingleLine(ctx, label, tableX + cellPaddingX, cursorY + overflowRowHeight / 2, availableWidth - cellPaddingX * 2)
  }

  ctx.restore()
}
