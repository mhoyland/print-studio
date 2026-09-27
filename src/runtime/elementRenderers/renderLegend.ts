import { loadArcGISJSAPIModule } from 'jimu-core'
import type { LegendElement } from '../../config'
import { paintContainer } from './paintContainer'
import { wrapText } from './textLayout'
import type { Painter } from './painter'

export const DEFAULT_FONT_SIZE = 11
export const DEFAULT_TITLE = 'Legend'
const MIN_COLUMN_WIDTH = 90 // logical px before scaling — enough for a swatch + a short label
const MAX_RAMP_WIDTH = 200 // logical px before scaling — keeps a ramp bar from stretching the full
                            // width of a wide legend box; the swatch grid isn't capped the same way,
                            // since spreading it across more columns is what frees room for this bar
const INDENT_WIDTH = 12 // logical px before scaling, per nesting level — see LegendGroup.indent
const MAX_TITLE_LINES = 2 // caps how far a long layer/section title or swatch label wraps before
                           // the last shown line gets ellipsized — see textLayout.ts's wrapText

// A flat color/label row (unique-value/class-breaks), a continuous gradient bar (an opacity/color
// visual variable), a bivariate color grid (a "relationship" renderer — e.g. Esri's own
// "Predominant category + Strength of predominance" census layers combine one of these with a ramp),
// or a set of graduated circles (a size visual variable). Any legend element type without a dedicated
// row kind here falls back to a single labeled swatch — see legendElementToRows' default case.
export type LegendRow =
  | { kind: 'swatch'; label: string; color: string; icon: IconShape | null }
  | { kind: 'ramp'; title: string; stops: Array<{ color: string; label: string }> }
  | { kind: 'relationship'; title: string; colors: string[][]; labels: { top: string; bottom: string; left: string; right: string } }
  | { kind: 'size'; title: string; stops: Array<{ label: string; color: string; size: number }> }

// One row per contributing layer (or sub-layer, for a GroupLayer/multi-scale layer — see `indent`),
// each with its own title shown above its own symbology — rather than one flat pooled list of rows
// with no indication of which layer any given swatch/ramp belongs to.
export interface LegendGroup {
  title: string
  indent: number // 0 = a top-level layer; 1+ = a nested sub-layer (e.g. a census layer's "County")
  rows: LegendRow[]
}

// The handful of values every paint* helper below needs, bundled into one object purely to keep each
// function's own parameter count down (each used to take `top`/`bottom`/`fontSize`/`scale`/`padding` as
// five separate trailing parameters, tripping the max-params lint rule) — `bottom` is the one absolute
// Y coordinate content must not be drawn past; `top`, which changes at every call as drawing proceeds
// down the page, stays its own separate parameter rather than joining this object.
interface LegendPaintStyle {
  bottom: number
  fontSize: number
  scale: number
  padding: number
}

// Reuses the ArcGIS Maps SDK's own Legend logic (LegendViewModel — the same class the built-in Legend
// widget itself is a thin DOM wrapper around) rather than hand-parsing renderer.visualVariables
// ourselves. Two things make this worth the indirection over reading the renderer directly:
//   1. It already recurses into GroupLayer/sublayer children and applies each one's own scale-range
//      visibility (respectLayerVisibility defaults to true) — exactly the traversal a multi-scale
//      layer (e.g. a census layer with separate Nation/State/County/Tract/Block Group sublayers) needs.
//   2. For continuous ramps (opacity/color visual variables) and bivariate "relationship" grids, the
//      actual displayed stop values/labels/colors (e.g. "<51", ">100", or a computed color matrix) are
//      produced by Esri's own private ramp-utility code — nothing on the renderer object itself exposes
//      those already-rounded, already-labeled/colored values for us to read directly, so hand-rolling
//      this would produce different (likely uglier, possibly wrong) results than the real legend shows.
export async function computeLegendGroups (view: __esri.MapView | __esri.SceneView): Promise<LegendGroup[]> {
  if (!view?.map) return []

  const [LegendViewModel, reactiveUtils] = await Promise.all([
    loadArcGISJSAPIModule('esri/widgets/Legend/LegendViewModel') as Promise<typeof __esri.LegendViewModel>,
    loadArcGISJSAPIModule('esri/core/reactiveUtils') as Promise<typeof __esri.reactiveUtils>
  ])

  const viewModel = new LegendViewModel({ view })
  try {
    await reactiveUtils.whenOnce(() => viewModel.state === 'ready')
    const infos = viewModel.activeLayerInfos.toArray()
    await Promise.all(infos.map(async (info) => { await waitUntilReady(info, reactiveUtils) }))
    return infos.flatMap((info) => flattenActiveLayerInfo(info, 0))
  } finally {
    viewModel.destroy()
  }
}

// `ready` becomes true once an ActiveLayerInfo's own legendElements finish computing (symbol
// rasterization etc. is itself async) — the view model's own top-level `state === 'ready'` only means
// the *list* of active layer infos has been populated, not that every one of them has finished, so
// each is awaited individually (recursively, since group/sublayer children have their own `ready`).
async function waitUntilReady (info: __esri.ActiveLayerInfo, reactiveUtils: typeof __esri.reactiveUtils): Promise<void> {
  if (!info.ready) await reactiveUtils.whenOnce(() => info.ready)
  const children = info.children?.toArray?.() ?? []
  await Promise.all(children.map(async (child) => { await waitUntilReady(child, reactiveUtils) }))
}

// One group per ActiveLayerInfo that actually contributes something (its own rows, or a descendant
// that does) — a pure container (a GroupLayer with no renderer of its own, only sub-layer children)
// still gets its own title-only group, matching the built-in legend's "layer name" header appearing
// above a nested "County"-style sub-layer heading, rather than only showing the innermost sub-layer.
function flattenActiveLayerInfo (info: __esri.ActiveLayerInfo, indent: number): LegendGroup[] {
  const title = info.title ?? 'Layer'
  const rows = (info.legendElements ?? []).flatMap((element) => legendElementToRows(element, title))
  const childGroups = (info.children?.toArray?.() ?? []).flatMap((child) => flattenActiveLayerInfo(child, indent + 1))
  const ownGroup: LegendGroup[] = (rows.length > 0 || childGroups.length > 0) ? [{ title, indent, rows }] : []
  return [...ownGroup, ...childGroups]
}

function legendElementToRows (element: __esri.LegendElement, fallbackTitle: string): LegendRow[] {
  switch (element.type) {
    case 'symbol-table':
      return (element.infos ?? [])
        .filter((info): info is __esri.SymbolTableElementInfo => !!(info as __esri.SymbolTableElementInfo)?.symbol)
        .map((info) => ({
          kind: 'swatch' as const,
          label: resolveTitle(info.label) || fallbackTitle,
          color: symbolToCss(info.symbol),
          icon: parsePathIcon(info.symbol)
        }))
    case 'opacity-ramp':
    case 'color-ramp':
    case 'stretch-ramp':
      // Unlike a plain symbol-table swatch, this section already has its own visible heading drawn
      // right above it by the enclosing group (the layer/sub-layer's own title) — falling back to
      // that same fallbackTitle here when the SDK doesn't provide one of its own would just repeat it
      // a second time immediately below, which is exactly what happened before this was removed.
      return [{
        kind: 'ramp' as const,
        title: resolveTitle(element.title),
        stops: (element.infos ?? []).map((stop) => ({
          color: colorToCss(stop.color),
          label: stop.label ?? String(stop.value ?? '')
        }))
      }]
    case 'relationship-ramp':
      // The SDK inserts the two source fields' own axis-direction arrow icons as ordinary rows in the
      // layer's ADJACENT symbol-table element (see ActiveLayerInfo's own relationship handling) — not
      // on this element itself, which carries no field-label data of its own. Those rows are handled
      // by the 'symbol-table' case above (via parsePathIcon), not here.
      return [{
        kind: 'relationship' as const,
        title: resolveTitle(element.title),
        colors: (element.colors ?? []).map((row) => row.map((color) => colorToCss(color))),
        labels: {
          top: element.labels?.top ?? '',
          bottom: element.labels?.bottom ?? '',
          left: element.labels?.left ?? '',
          right: element.labels?.right ?? ''
        }
      }]
    case 'size-ramp':
      return [{
        kind: 'size' as const,
        title: resolveTitle(element.title),
        stops: (element.infos ?? []).map((stop) => ({
          label: stop.label ?? String(stop.value ?? ''),
          color: symbolToCss(stop.symbol),
          size: typeof stop.size === 'number' ? stop.size : (stop.size?.width ?? 12)
        }))
      }]
    default:
      // HeatmapRampElement, UnivariateColorSizeRampElement, PieChartRampElement — no dedicated visual
      // for these yet. A single labeled swatch beats silently dropping the layer's content entirely,
      // matching this element's existing fallback philosophy — and it's now at least correctly grouped
      // under its own layer title rather than floating in an unlabeled flat list.
      return [{ kind: 'swatch' as const, label: resolveTitle((element as { title?: unknown }).title) || fallbackTitle, color: '#888888', icon: null }]
  }
}

// `title`/`label` on legend elements can be a plain string, or a structured "how to format this"
// object (e.g. `{ field: 'POP' }`) that the DOM Legend widget formats internally with logic that
// isn't itself exposed publicly — so this only handles the common shapes (a plain string, or an
// object with its own `.title`/`.field` string) rather than fully replicating that formatting.
function resolveTitle (title: unknown): string {
  if (typeof title === 'string') return title
  if (title && typeof title === 'object') {
    const candidate = title as { title?: unknown; field?: unknown }
    if (typeof candidate.title === 'string') return candidate.title
    if (typeof candidate.field === 'string') return candidate.field
  }
  return ''
}

function symbolToCss (symbol: __esri.SymbolTableElementInfo['symbol'] | undefined): string {
  const color = (symbol as { color?: __esri.Color })?.color
  return color ? colorToCss(color) : '#888888'
}

function colorToCss (color: __esri.Color | undefined): string {
  return color?.toCss ? color.toCss(true) : '#888888'
}

// A `SimpleMarkerSymbol` with `style: 'path'` draws a custom SVG icon rather than a flat-colored dot
// (e.g. the axis-direction arrow icons Esri's own Legend inserts for a bivariate "relationship"
// renderer's two source fields — see legendElementToRows' relationship-ramp comment). Filling such a
// symbol's flat swatch color would draw nothing useful for one of these (its "color" is typically
// unset — only the outline is), so the actual path is parsed and stroked/filled instead.
export interface IconShape {
  subpaths: Array<Array<{ x: number; y: number }>>
  angle: number
  strokeColor: string
  fillColor: string | null
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function parsePathIcon (symbol: unknown): IconShape | null {
  const marker = symbol as { style?: string; path?: string; angle?: number; color?: __esri.Color; outline?: { color?: __esri.Color } }
  if (marker?.style !== 'path' || !marker.path) return null
  const subpaths = parseSvgPath(marker.path)
  const points = subpaths.flat()
  if (points.length === 0) return null

  const hasFill = !!marker.color && (marker.color.a ?? 1) > 0
  return {
    subpaths,
    angle: marker.angle ?? 0,
    strokeColor: marker.outline?.color ? colorToCss(marker.outline.color) : '#555555',
    fillColor: hasFill ? colorToCss(marker.color) : null,
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y))
  }
}

// Parses the small SVG path dialect a `path`-style SimpleMarkerSymbol uses: absolute moveto/lineto
// commands only (no curves are part of this marker style) — e.g. `"M10,5 L5,0 0,5 M5,0 L5,15"`. A new
// "M" starts a fresh subpath; a coordinate pair with no command letter of its own implicitly repeats
// the previous one (standard SVG shorthand — an "M" followed by extra pairs is a moveto then linetos).
function parseSvgPath (path: string): Array<Array<{ x: number; y: number }>> {
  const tokens = path.match(/[ML]|-?\d*\.?\d+/g) ?? []
  const subpaths: Array<Array<{ x: number; y: number }>> = []
  let current: Array<{ x: number; y: number }> = []
  let command = ''
  let i = 0
  while (i < tokens.length) {
    if (tokens[i] === 'M' || tokens[i] === 'L') {
      command = tokens[i]
      i++
      continue
    }
    const x = Number(tokens[i])
    const y = Number(tokens[i + 1])
    i += 2
    if (Number.isNaN(x) || Number.isNaN(y)) continue
    if (command === 'M') {
      if (current.length > 0) subpaths.push(current)
      current = [{ x, y }]
      command = 'L' // subsequent bare pairs after an M are implicit linetos
    } else {
      current.push({ x, y })
    }
  }
  if (current.length > 0) subpaths.push(current)
  return subpaths
}

// Draws `icon`'s parsed subpaths centered at (centerX, centerY), uniformly scaled to fit within a
// `boxSize`-square box (leaving a small margin) and rotated by the symbol's own `angle`.
function drawPathIcon (ctx: Painter, icon: IconShape, centerX: number, centerY: number, boxSize: number): void {
  const width = Math.max(1e-6, icon.maxX - icon.minX)
  const height = Math.max(1e-6, icon.maxY - icon.minY)
  const iconScale = (boxSize * 0.9) / Math.max(width, height)
  const midX = (icon.minX + icon.maxX) / 2
  const midY = (icon.minY + icon.maxY) / 2

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate((icon.angle * Math.PI) / 180)
  ctx.scale(iconScale, iconScale)
  ctx.translate(-midX, -midY)
  ctx.lineWidth = 1 / iconScale
  ctx.strokeStyle = icon.strokeColor
  ctx.fillStyle = icon.fillColor ?? 'transparent'
  for (const subpath of icon.subpaths) {
    if (subpath.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(subpath[0].x, subpath[0].y)
    for (const point of subpath.slice(1)) ctx.lineTo(point.x, point.y)
    if (icon.fillColor) ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

// Draws `text` left-aligned at (x, top), wrapped onto up to MAX_TITLE_LINES lines if it doesn't fit
// `maxWidth` (the last shown line ellipsized if it still doesn't, rather than overflowing past
// whatever's drawn next to or below it — the bug this was added to fix). Returns the vertical space
// the (possibly multi-line) text used — zero, drawing nothing, for an empty title (some legend
// elements, e.g. a relationship-ramp, legitimately have no title of their own from the SDK; reserving
// a blank line for one would just leave an odd gap, and substituting the enclosing group's own layer
// title as a fallback there previously produced a visible duplicate of it right below itself). Caller
// sets `ctx.font` beforehand; textBaseline is 'middle' throughout this renderer, so each line's own y
// is that line's vertical center.
function drawWrappedTitle (ctx: Painter, text: string, x: number, top: number, maxWidth: number, lineHeight: number): number {
  if (!text) return 0
  const lines = wrapText(ctx, text, maxWidth, MAX_TITLE_LINES)
  ctx.textAlign = 'left'
  lines.forEach((line, index) => { ctx.fillText(line, x, top + lineHeight / 2 + index * lineHeight) })
  return lines.length * lineHeight
}

export function paintLegend (ctx: Painter, element: LegendElement, groups: LegendGroup[]): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return
  paintContainer(ctx, element)
  if (groups.length === 0) return

  const fontSize = element.fontSize ?? DEFAULT_FONT_SIZE
  const scale = fontSize / DEFAULT_FONT_SIZE
  const padding = 6 * scale
  const titleLineHeight = fontSize * 1.3
  const showTitle = element.showTitle ?? true
  const bottom = element.y + element.h

  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  let cursorY = element.y
  if (showTitle) {
    cursorY += padding
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillStyle = '#000000'
    cursorY += drawWrappedTitle(ctx, element.title ?? DEFAULT_TITLE, element.x + padding, cursorY, element.w - padding * 2, titleLineHeight)
    cursorY += padding
  }

  const style: LegendPaintStyle = { bottom, fontSize, scale, padding }
  for (const group of groups) {
    if (cursorY >= bottom) break
    cursorY += paintGroup(ctx, element, group, cursorY, style)
  }

  ctx.restore()
}

// Draws one layer's title (indented per group.indent — a nested sub-layer's heading sits slightly
// smaller and offset from its parent layer's own title) followed by that layer's own symbology only —
// swatches (its own multi-column layout, independent of every other group's), then ramps, relationship
// grids, and size ramps below. Returns the total vertical space this group used.
function paintGroup (
  ctx: Painter,
  element: LegendElement,
  group: LegendGroup,
  top: number,
  style: LegendPaintStyle
): number {
  const { fontSize, scale, padding } = style
  const indentPx = group.indent * INDENT_WIDTH * scale
  const indentedElement: LegendElement = { ...element, x: element.x + indentPx, w: Math.max(0, element.w - indentPx) }

  let cursorY = top
  const headerFontSize = group.indent === 0 ? fontSize : Math.max(4, fontSize - 1)
  const headerLineHeight = headerFontSize * 1.3
  ctx.font = `bold ${headerFontSize}px sans-serif`
  ctx.fillStyle = '#000000'
  cursorY += drawWrappedTitle(ctx, group.title, indentedElement.x + padding, cursorY, indentedElement.w - padding * 2, headerLineHeight)
  cursorY += padding / 2

  const swatchRows = group.rows.filter((row): row is Extract<LegendRow, { kind: 'swatch' }> => row.kind === 'swatch')
  const rampRows = group.rows.filter((row): row is Extract<LegendRow, { kind: 'ramp' }> => row.kind === 'ramp')
  const relationshipRows = group.rows.filter((row): row is Extract<LegendRow, { kind: 'relationship' }> => row.kind === 'relationship')
  const sizeRows = group.rows.filter((row): row is Extract<LegendRow, { kind: 'size' }> => row.kind === 'size')

  cursorY += paintSwatches(ctx, indentedElement, swatchRows, cursorY, style)
  cursorY += paintRamps(ctx, indentedElement, rampRows, cursorY, style)
  cursorY += paintRelationships(ctx, indentedElement, relationshipRows, cursorY, style)
  cursorY += paintSizeRamps(ctx, indentedElement, sizeRows, cursorY, style)

  return cursorY - top + padding // trailing gap before the next group
}

// Returns the vertical space actually used.
function paintSwatches (
  ctx: Painter,
  element: LegendElement,
  rows: Array<Extract<LegendRow, { kind: 'swatch' }>>,
  top: number,
  style: LegendPaintStyle
): number {
  if (rows.length === 0) return 0
  const { bottom, fontSize, scale, padding } = style

  const swatchSize = 12 * scale
  const singleLineRowHeight = 18 * scale
  const labelLineHeight = fontSize * 1.15
  const labelGap = 6 * scale
  const availableWidth = element.w - padding * 2
  const availableHeight = bottom - top - padding * 2

  // Entries that don't fit in one column spill into additional columns to the right, filling each
  // column top-to-bottom before starting the next (matching how a printed legend is usually read) —
  // rather than being clipped once the box height runs out. Columns are equal width, not auto-sized
  // to each column's own longest label, which keeps this simple at the cost of some wasted space
  // when one column's labels are much shorter than another's. Column count/width is figured out first
  // assuming single-line labels (below); once columnWidth is known, labels that don't actually fit it
  // get wrapped, which can grow the row height beyond that initial single-line assumption — see the
  // second pass after columnWidth is computed.
  const rowsPerColumnFromHeight = Math.max(1, Math.floor(availableHeight / singleLineRowHeight))

  let columnCount: number
  let rowsPerColumn: number
  if (element.columns && element.columns !== 'auto') {
    // A designer-fixed column count — always exactly this many, never auto-adjusted by the box's own
    // width/height the way 'auto' is below. Entries that still don't fit vertically at that fixed
    // count are clipped the same way an auto-fit legend is when its box is too short, rather than
    // silently growing extra columns to compensate.
    columnCount = element.columns
    rowsPerColumn = Math.max(1, Math.min(rowsPerColumnFromHeight, Math.ceil(rows.length / columnCount)))
  } else {
    // Row count is capped by whichever is *smaller* — how many rows the available height allows, or
    // how few rows are actually needed once entries are spread across every column the available width
    // allows. Using only the height-derived row count meant widening a legend box never reduced how many
    // rows the swatches used, even though the box had the width to spare — which left a wide-but-short
    // box with no room for a ramp section below, since the swatches always claimed as many rows as they
    // technically could regardless of unused spare width. (The ramp bar itself is capped at
    // MAX_RAMP_WIDTH instead of being left to stretch the full box width — see paintRamps — so this
    // doesn't also need a column cap of its own to keep a wide legend from looking stretched.)
    const maxColumnsByWidth = Math.max(1, Math.floor(availableWidth / (MIN_COLUMN_WIDTH * scale)))
    const minRowsAtMaxColumns = Math.ceil(rows.length / maxColumnsByWidth)
    rowsPerColumn = Math.max(1, Math.min(rowsPerColumnFromHeight, minRowsAtMaxColumns))
    const columnsNeeded = Math.ceil(rows.length / rowsPerColumn)
    columnCount = Math.max(1, Math.min(columnsNeeded, maxColumnsByWidth))
  }
  const columnWidth = availableWidth / columnCount
  const labelMaxWidth = Math.max(0, columnWidth - swatchSize - labelGap - padding / 2)

  ctx.font = `${fontSize}px sans-serif`

  // Labels that don't fit their column's own width wrap onto up to MAX_TITLE_LINES lines (ellipsized
  // if still too long) instead of overflowing past the column into whatever's drawn next to it. Every
  // row in this swatch grid shares one uniform height, sized to the tallest wrapped label actually
  // shown — simpler than variable per-row heights, at the cost of some unused space next to shorter
  // labels — and re-deriving how many rows fit at that (possibly taller) height can mean fewer entries
  // fit than the single-line estimate above assumed; anything that no longer fits is clipped, same as
  // this grid already does whenever a legend simply has more entries than room.
  const candidateRows = rows.slice(0, columnCount * rowsPerColumn)
  const wrappedLabels = candidateRows.map((row) => wrapText(ctx, row.label, labelMaxWidth, MAX_TITLE_LINES))
  const maxLines = Math.max(1, ...wrappedLabels.map((lines) => lines.length))
  const rowHeight = Math.max(swatchSize, maxLines * labelLineHeight) + 4 * scale

  const actualRowsPerColumn = Math.max(1, Math.floor(availableHeight / rowHeight))
  const rowsUsed = Math.min(actualRowsPerColumn, rowsPerColumn)
  const visibleCount = Math.min(candidateRows.length, columnCount * rowsUsed)
  const visibleRows = candidateRows.slice(0, visibleCount)
  const visibleLabels = wrappedLabels.slice(0, visibleCount)

  visibleRows.forEach((row, index) => {
    const columnIndex = Math.floor(index / rowsUsed)
    const rowIndex = index % rowsUsed
    const entryX = element.x + padding + columnIndex * columnWidth
    const entryY = top + padding + rowIndex * rowHeight
    const lines = visibleLabels[index]

    if (row.icon) {
      drawPathIcon(ctx, row.icon, entryX + swatchSize / 2, entryY + swatchSize / 2, swatchSize)
    } else {
      ctx.fillStyle = row.color
      ctx.fillRect(entryX, entryY, swatchSize, swatchSize)
      ctx.strokeStyle = '#999999'
      ctx.strokeRect(entryX, entryY, swatchSize, swatchSize)
    }

    ctx.fillStyle = '#000000'
    ctx.textAlign = 'left'
    const textBlockHeight = lines.length * labelLineHeight
    const textStartY = entryY + Math.max(swatchSize, textBlockHeight) / 2 - textBlockHeight / 2 + labelLineHeight / 2
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, entryX + swatchSize + labelGap, textStartY + lineIndex * labelLineHeight)
    })
  })

  return rowsUsed > 0 ? padding * 2 + rowsUsed * rowHeight : 0
}

function paintRamps (
  ctx: Painter,
  element: LegendElement,
  rows: Array<Extract<LegendRow, { kind: 'ramp' }>>,
  top: number,
  style: LegendPaintStyle
): number {
  if (rows.length === 0) return 0
  const { bottom, fontSize, scale, padding } = style

  const titleLineHeight = fontSize * 1.3
  const barHeight = 14 * scale
  const barGap = 4 * scale
  const rampGap = 10 * scale
  // Capped rather than stretched to the box's full width — a legend box widened to fit more swatch
  // columns would otherwise drag the ramp bar out to a stretched, disproportionate length with it.
  // Left-aligned (not centered), matching the title/swatches above it.
  const barWidth = Math.max(0, Math.min(MAX_RAMP_WIDTH * scale, element.w - padding * 2))
  const barX = element.x + padding
  const titleMaxWidth = Math.max(barWidth, element.w - padding * 2)

  let cursorY = top
  for (const row of rows) {
    if (cursorY + titleLineHeight * MAX_TITLE_LINES + barGap + barHeight > bottom) break

    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillStyle = '#000000'
    cursorY += drawWrappedTitle(ctx, row.title, barX, cursorY, titleMaxWidth, titleLineHeight)
    cursorY += barGap

    if (row.stops.length > 0 && barWidth > 0) {
      const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0)
      const lastIndex = row.stops.length - 1
      row.stops.forEach((stop, index) => {
        gradient.addColorStop(lastIndex === 0 ? 0 : index / lastIndex, stop.color)
      })
      ctx.fillStyle = gradient
      ctx.fillRect(barX, cursorY, barWidth, barHeight)
      ctx.strokeStyle = '#999999'
      ctx.strokeRect(barX, cursorY, barWidth, barHeight)

      ctx.font = `${fontSize}px sans-serif`
      ctx.fillStyle = '#000000'
      const labelY = cursorY + barHeight + barGap + fontSize / 2
      ctx.textAlign = 'left'
      ctx.fillText(row.stops[0].label, barX, labelY)
      if (lastIndex > 0) {
        ctx.textAlign = 'right'
        ctx.fillText(row.stops[lastIndex].label, barX + barWidth, labelY)
      }
      ctx.textAlign = 'left'
      cursorY += barHeight + barGap + fontSize + rampGap
    } else {
      cursorY += rampGap
    }
  }
  return cursorY - top
}

// A bivariate "relationship" renderer's color grid (e.g. Esri's "Klimaateffectatlas" layer combining
// two fields into one NxN color matrix) — drawn as its own titled square grid, centered within the
// available width (rather than flush left, which left it stranded in one corner while the corner
// labels' free side sat mostly empty), with the SDK's own computed corner labels flanking its left/
// right edges directly. This mirrors the built-in Legend widget's own (non-diamond) corner placement —
// `left` at the top-left, `top` at the top-right, `bottom` at the bottom-left, and `right` at the
// bottom-right — rather than a full pixel match of its 45°-rotated "diamond" layout (used when the
// renderer has a `focus` value), which also draws small axis-direction arrow lines that aren't
// reachable from outside the SDK's own unexported rendering code.
function paintRelationships (
  ctx: Painter,
  element: LegendElement,
  rows: Array<Extract<LegendRow, { kind: 'relationship' }>>,
  top: number,
  style: LegendPaintStyle
): number {
  if (rows.length === 0) return 0
  const { bottom, fontSize, scale, padding } = style

  const titleLineHeight = fontSize * 1.3
  const cellSize = 14 * scale
  const cornerFontSize = Math.max(4, fontSize - 2)
  const cornerLineHeight = cornerFontSize * 1.2
  const sectionGap = 10 * scale
  const labelGap = 6 * scale
  const contentLeft = element.x + padding
  const maxLabelWidth = Math.max(0, element.w - padding * 2)

  let cursorY = top
  for (const row of rows) {
    const gridSize = Math.max(1, row.colors.length) * cellSize
    const gridX = contentLeft + Math.max(0, (maxLabelWidth - gridSize) / 2)
    // The margin freed up on either side of the now-centered grid, minus a small gap — since the grid
    // is centered, this is the same on both sides, so one width serves both left and right labels.
    const sideLabelWidth = Math.max(0, gridX - contentLeft - labelGap)

    ctx.font = `${cornerFontSize}px sans-serif`
    const leftLines = row.labels.left ? wrapText(ctx, row.labels.left, sideLabelWidth, MAX_TITLE_LINES) : []
    const topLines = row.labels.top ? wrapText(ctx, row.labels.top, sideLabelWidth, MAX_TITLE_LINES) : []
    const bottomLines = row.labels.bottom ? wrapText(ctx, row.labels.bottom, sideLabelWidth, MAX_TITLE_LINES) : []
    const rightLines = row.labels.right ? wrapText(ctx, row.labels.right, sideLabelWidth, MAX_TITLE_LINES) : []
    const aboveLines = Math.max(leftLines.length, topLines.length)
    const belowLines = Math.max(bottomLines.length, rightLines.length)

    const blockHeight = titleLineHeight + aboveLines * cornerLineHeight + gridSize + belowLines * cornerLineHeight
    if (cursorY + blockHeight > bottom) break

    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillStyle = '#000000'
    cursorY += drawWrappedTitle(ctx, row.title, contentLeft, cursorY, maxLabelWidth, titleLineHeight)

    ctx.font = `${cornerFontSize}px sans-serif`
    if (aboveLines > 0) {
      ctx.textAlign = 'right'
      leftLines.forEach((line, index) => { ctx.fillText(line, gridX - labelGap, cursorY + cornerLineHeight / 2 + index * cornerLineHeight) })
      ctx.textAlign = 'left'
      topLines.forEach((line, index) => { ctx.fillText(line, gridX + gridSize + labelGap, cursorY + cornerLineHeight / 2 + index * cornerLineHeight) })
      cursorY += aboveLines * cornerLineHeight
    }

    const n = row.colors.length
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        // colors[0] is the "low" row in the SDK's own data — drawn at the bottom of the grid so the
        // grid reads bottom-to-top the same way the "top" corner label above implies.
        const x = gridX + c * cellSize
        const y = cursorY + (n - 1 - r) * cellSize
        ctx.fillStyle = row.colors[r][c]
        ctx.fillRect(x, y, cellSize, cellSize)
        ctx.strokeStyle = '#999999'
        ctx.strokeRect(x, y, cellSize, cellSize)
      }
    }
    cursorY += gridSize

    if (belowLines > 0) {
      ctx.textAlign = 'right'
      bottomLines.forEach((line, index) => { ctx.fillText(line, gridX - labelGap, cursorY + cornerLineHeight / 2 + index * cornerLineHeight) })
      ctx.textAlign = 'left'
      rightLines.forEach((line, index) => { ctx.fillText(line, gridX + gridSize + labelGap, cursorY + cornerLineHeight / 2 + index * cornerLineHeight) })
      cursorY += belowLines * cornerLineHeight
    }
    ctx.textAlign = 'left'
    cursorY += sectionGap
  }
  return cursorY - top
}

// Graduated circles at the SDK's own computed sizes (a size visual variable — e.g. wildfire hectares,
// each category a differently-sized circle of the same color) rather than identical fixed-size swatches,
// which lost that size information entirely. Stacked largest-to-smallest, matching the order the SDK
// itself provides and the built-in legend's own vertical layout for this element type.
function paintSizeRamps (
  ctx: Painter,
  element: LegendElement,
  rows: Array<Extract<LegendRow, { kind: 'size' }>>,
  top: number,
  style: LegendPaintStyle
): number {
  if (rows.length === 0) return 0
  const { bottom, fontSize, scale, padding } = style

  const titleLineHeight = fontSize * 1.3
  const rowGap = 4 * scale
  const sectionGap = 10 * scale
  const labelGap = 6 * scale
  const circleX = element.x + padding
  const titleMaxWidth = Math.max(0, element.w - padding * 2)

  let cursorY = top
  for (const row of rows) {
    if (row.stops.length === 0) continue
    const maxDiameter = Math.max(4, ...row.stops.map((stop) => stop.size)) * scale
    const rowHeight = maxDiameter + rowGap
    const blockHeight = titleLineHeight * MAX_TITLE_LINES + row.stops.length * rowHeight
    if (cursorY + blockHeight > bottom) break

    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillStyle = '#000000'
    cursorY += drawWrappedTitle(ctx, row.title, circleX, cursorY, titleMaxWidth, titleLineHeight)

    ctx.font = `${fontSize}px sans-serif`
    ctx.textAlign = 'left'
    for (const stop of row.stops) {
      const diameter = Math.max(4, stop.size * scale)
      const cx = circleX + maxDiameter / 2
      const cy = cursorY + maxDiameter / 2
      ctx.fillStyle = stop.color
      ctx.beginPath()
      ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#999999'
      ctx.stroke()
      ctx.fillStyle = '#000000'
      ctx.fillText(stop.label, circleX + maxDiameter + labelGap, cy)
      cursorY += rowHeight
    }
    cursorY += sectionGap
  }
  return cursorY - top
}
