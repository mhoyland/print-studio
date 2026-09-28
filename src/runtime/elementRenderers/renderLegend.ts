import { loadArcGISJSAPIModule } from 'jimu-core'
import type { LegendElement } from '../../config'
import { paintContainer } from './paintContainer'
import { wrapText } from './textLayout'
import type { Painter } from './painter'

export const DEFAULT_FONT_SIZE = 11
export const DEFAULT_TITLE = 'Legend'
const MAX_RAMP_WIDTH = 200 // logical px before scaling — keeps a ramp bar from stretching across a wide column
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

// --- Layout: rows that flow through columns -------------------------------------------------------
//
// Layers are placed in columns like newspaper text. Where they fit, whole layers go into columns (a
// layer's symbols stay together). Where they don't, a layer flows: every layer is a sequence of blocks
// (its heading, one per symbol row, one per graduated-circle row, one per colour ramp or bivariate
// grid) that continue at the top of the next column. A heading is kept with the block after it, so it
// is never stranded at the bottom of a column, and a continued layer carries on without repeating its
// heading, as ArcGIS Pro does. Columns are balanced (as short as possible) and all the requested
// columns are used when there's enough to put in them. With `columns: 'auto'`, the fewest columns
// that fit the box are used, as width allows.

interface Block {
  height: number
  // True for headings: a column break is never placed straight after this block.
  keepWithNext?: boolean
  draw: (x: number, y: number) => void
}

interface LegendMetrics {
  fontSize: number
  scale: number
  padding: number
}

const COLUMN_GAP = 16 // logical px before scaling, between columns
const AUTO_MIN_COLUMN_WIDTH = 150 // logical px before scaling — the narrowest column 'auto' will use
const MAX_AUTO_COLUMNS = 6

export function paintLegend (ctx: Painter, element: LegendElement, groups: LegendGroup[]): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return
  paintContainer(ctx, element)
  if (groups.length === 0) return

  const fontSize = element.fontSize ?? DEFAULT_FONT_SIZE
  const scale = fontSize / DEFAULT_FONT_SIZE
  const padding = 6 * scale
  const metrics: LegendMetrics = { fontSize, scale, padding }
  const showTitle = element.showTitle ?? true
  const contentLeft = element.x + padding
  const contentWidth = Math.max(0, element.w - padding * 2)
  const bottom = element.y + element.h - padding

  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  // The legend's own title spans all columns.
  let top = element.y + padding
  if (showTitle) {
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillStyle = '#000000'
    const titleLineHeight = fontSize * 1.3
    const lines = wrapTitle(ctx, element.title ?? DEFAULT_TITLE, contentWidth)
    drawLines(ctx, lines, contentLeft, top, titleLineHeight)
    top += lines.length * titleLineHeight + padding
  }
  const columnHeight = Math.max(0, bottom - top)

  const gap = COLUMN_GAP * scale
  // For a column count: the column width, and the units to place — whole layers if they fit the box,
  // otherwise individual blocks so layers can flow on into the next column.
  const layoutFor = (columnCount: number): { width: number; units: Block[]; fits: boolean } => {
    const width = Math.max(0, (contentWidth - gap * (columnCount - 1)) / columnCount)
    const layerBlocks = groups.map((group) => groupBlocks(ctx, group, width, metrics))
    const wholeLayers = layerBlocks.map(combineBlocks)
    if (flow(wholeLayers, columnCount, columnHeight).fits) return { width, units: wholeLayers, fits: true }
    const blocks = layerBlocks.flat()
    return { width, units: blocks, fits: flow(blocks, columnCount, columnHeight).fits }
  }

  let columnCount: number
  let layout: { width: number; units: Block[]; fits: boolean }
  if (element.columns && element.columns !== 'auto') {
    columnCount = element.columns
    layout = layoutFor(columnCount)
  } else {
    // Fewest columns that fit the box's height, no narrower than AUTO_MIN_COLUMN_WIDTH.
    const maxByWidth = Math.max(1, Math.min(MAX_AUTO_COLUMNS, Math.floor((contentWidth + gap) / (AUTO_MIN_COLUMN_WIDTH * scale + gap))))
    columnCount = 1
    layout = layoutFor(1)
    while (columnCount < maxByWidth && !layout.fits) {
      columnCount++
      layout = layoutFor(columnCount)
    }
  }

  const columns = flow(layout.units, columnCount, balancedHeight(layout.units, columnCount, columnHeight)).columns
  columns.slice(0, columnCount).forEach((column, index) => {
    const x = contentLeft + index * (layout.width + gap)
    let y = top
    for (const block of column) {
      // Anything that still doesn't fit the box is left off, as before, rather than drawn past its edge.
      if (y + block.height > bottom + 0.5) break
      block.draw(x, y)
      y += block.height
    }
  })

  ctx.restore()
}

// Places blocks into columns no taller than `height`. `fits` is false if they need more than
// `columnCount` columns, or a single block is taller than a column.
function flow (blocks: Block[], columnCount: number, height: number): { fits: boolean; columns: Block[][] } {
  const columns: Block[][] = [[]]
  let used = 0
  let fits = true
  blocks.forEach((block, index) => {
    const next = blocks[index + 1]
    const needed = block.height + (block.keepWithNext && next ? next.height : 0)
    // Once there are only as many units left as empty columns, give each its own column, so all the
    // requested columns are used rather than leaving the last ones empty.
    const unitsLeft = blocks.length - index
    const emptyColumnsLeft = columnCount - columns.length
    if (used > 0 && (used + needed > height || unitsLeft <= emptyColumnsLeft)) {
      columns.push([])
      used = 0
    }
    columns[columns.length - 1].push(block)
    used += block.height
    if (used > height + 0.5) fits = false
  })
  return { fits: fits && columns.length <= columnCount, columns }
}

// The shortest column height (up to the box's) that still fits every block into `columnCount` columns,
// so the columns come out even. If nothing fits, the box's own height (the overflow is then left off).
function balancedHeight (blocks: Block[], columnCount: number, maxHeight: number): number {
  if (columnCount <= 1 || !flow(blocks, columnCount, maxHeight).fits) return maxHeight
  let low = Math.max(0, ...blocks.map((block) => block.height))
  let high = maxHeight
  while (high - low > 0.5) {
    const mid = (low + high) / 2
    if (flow(blocks, columnCount, mid).fits) high = mid
    else low = mid
  }
  return high
}

// A whole layer as one unbreakable unit.
function combineBlocks (blocks: Block[]): Block {
  return {
    height: blocks.reduce((sum, block) => sum + block.height, 0),
    draw: (x, y) => {
      let top = y
      for (const block of blocks) {
        block.draw(x, top)
        top += block.height
      }
    }
  }
}

// --- Blocks for one layer --------------------------------------------------------------------------

// A layer's heading (indented per nesting level — a sub-layer's heading is slightly smaller) followed
// by its symbology: symbol rows, then colour ramps, bivariate grids and graduated circles.
function groupBlocks (ctx: Painter, group: LegendGroup, columnWidth: number, metrics: LegendMetrics): Block[] {
  const { fontSize, padding } = metrics
  // Sub-layers line up with every other layer (no indent); their smaller heading below shows the hierarchy.
  const indent = 0
  const width = Math.max(0, columnWidth - indent)
  const blocks: Block[] = []

  const headerFontSize = group.indent === 0 ? fontSize : Math.max(4, fontSize - 1)
  const headerFont = `bold ${headerFontSize}px sans-serif`
  const headerLineHeight = headerFontSize * 1.3
  ctx.font = headerFont
  const headerLines = group.title ? wrapTitle(ctx, group.title, width) : []
  blocks.push({
    height: headerLines.length * headerLineHeight + padding / 2,
    keepWithNext: true,
    draw: (x, y) => {
      ctx.font = headerFont
      ctx.fillStyle = '#000000'
      drawLines(ctx, headerLines, x + indent, y, headerLineHeight)
    }
  })

  const swatches = group.rows.filter((row): row is Extract<LegendRow, { kind: 'swatch' }> => row.kind === 'swatch')
  const sectionStart = blocks.length
  blocks.push(...swatches.map((row) => swatchBlock(ctx, row, indent, width, metrics)))
  for (const row of group.rows) {
    if (row.kind === 'ramp') blocks.push(rampBlock(ctx, row, indent, width, metrics))
    else if (row.kind === 'relationship') blocks.push(relationshipBlock(ctx, row, indent, width, metrics))
    else if (row.kind === 'size') blocks.push(...sizeBlocks(ctx, row, indent, width, metrics))
  }
  // Space after the layer, before the next one's heading.
  if (blocks.length > sectionStart) blocks[blocks.length - 1].height += padding
  return blocks
}

function swatchBlock (ctx: Painter, row: Extract<LegendRow, { kind: 'swatch' }>, indent: number, width: number, metrics: LegendMetrics): Block {
  const { fontSize, scale } = metrics
  const swatchSize = 12 * scale
  const labelGap = 6 * scale
  const labelLineHeight = fontSize * 1.15
  const font = `${fontSize}px sans-serif`
  ctx.font = font
  const lines = wrapText(ctx, row.label, Math.max(0, width - swatchSize - labelGap), MAX_TITLE_LINES)
  const textHeight = lines.length * labelLineHeight
  const height = Math.max(swatchSize, textHeight) + 4 * scale
  return {
    height,
    draw: (x, y) => {
      const left = x + indent
      if (row.icon) {
        drawPathIcon(ctx, row.icon, left + swatchSize / 2, y + swatchSize / 2, swatchSize)
      } else {
        ctx.fillStyle = row.color
        ctx.fillRect(left, y, swatchSize, swatchSize)
        ctx.strokeStyle = '#999999'
        ctx.strokeRect(left, y, swatchSize, swatchSize)
      }
      ctx.font = font
      ctx.fillStyle = '#000000'
      ctx.textAlign = 'left'
      const textTop = y + Math.max(swatchSize, textHeight) / 2 - textHeight / 2
      drawLines(ctx, lines, left + swatchSize + labelGap, textTop, labelLineHeight)
    }
  }
}

// A continuous colour ramp: its title, the gradient bar, and the first and last stop labels — kept
// together in one block. The bar is capped at MAX_RAMP_WIDTH so a wide column doesn't stretch it.
function rampBlock (ctx: Painter, row: Extract<LegendRow, { kind: 'ramp' }>, indent: number, width: number, metrics: LegendMetrics): Block {
  const { fontSize, scale } = metrics
  const titleLineHeight = fontSize * 1.3
  const barHeight = 14 * scale
  const barGap = 4 * scale
  const rampGap = 10 * scale
  const barWidth = Math.max(0, Math.min(MAX_RAMP_WIDTH * scale, width))
  const titleFont = `bold ${fontSize}px sans-serif`
  const labelFont = `${fontSize}px sans-serif`
  ctx.font = titleFont
  const titleLines = row.title ? wrapTitle(ctx, row.title, width) : []
  const hasBar = row.stops.length > 0 && barWidth > 0
  const height = titleLines.length * titleLineHeight + barGap + (hasBar ? barHeight + barGap + fontSize : 0) + rampGap
  return {
    height,
    draw: (x, y) => {
      const barX = x + indent
      ctx.font = titleFont
      ctx.fillStyle = '#000000'
      drawLines(ctx, titleLines, barX, y, titleLineHeight)
      if (!hasBar) return
      const barY = y + titleLines.length * titleLineHeight + barGap
      const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0)
      const lastIndex = row.stops.length - 1
      row.stops.forEach((stop, index) => { gradient.addColorStop(lastIndex === 0 ? 0 : index / lastIndex, stop.color) })
      ctx.fillStyle = gradient
      ctx.fillRect(barX, barY, barWidth, barHeight)
      ctx.strokeStyle = '#999999'
      ctx.strokeRect(barX, barY, barWidth, barHeight)
      ctx.font = labelFont
      ctx.fillStyle = '#000000'
      const labelY = barY + barHeight + barGap + fontSize / 2
      ctx.textAlign = 'left'
      ctx.fillText(row.stops[0].label, barX, labelY)
      if (lastIndex > 0) {
        ctx.textAlign = 'right'
        ctx.fillText(row.stops[lastIndex].label, barX + barWidth, labelY)
      }
      ctx.textAlign = 'left'
    }
  }
}

// A bivariate "relationship" renderer's colour grid, drawn as its own titled square grid centred in the
// column, with the SDK's corner labels beside it — `left` top-left, `top` top-right, `bottom`
// bottom-left, `right` bottom-right, mirroring the built-in Legend widget's (non-diamond) layout.
// Kept together in one block.
function relationshipBlock (ctx: Painter, row: Extract<LegendRow, { kind: 'relationship' }>, indent: number, width: number, metrics: LegendMetrics): Block {
  const { fontSize, scale } = metrics
  const titleLineHeight = fontSize * 1.3
  const cellSize = 14 * scale
  const cornerFontSize = Math.max(4, fontSize - 2)
  const cornerLineHeight = cornerFontSize * 1.2
  const sectionGap = 10 * scale
  const labelGap = 6 * scale
  const gridSize = Math.max(1, row.colors.length) * cellSize
  const gridOffset = Math.max(0, (width - gridSize) / 2)
  const sideLabelWidth = Math.max(0, gridOffset - labelGap)
  const titleFont = `bold ${fontSize}px sans-serif`
  const cornerFont = `${cornerFontSize}px sans-serif`

  ctx.font = titleFont
  const titleLines = row.title ? wrapTitle(ctx, row.title, width) : []
  ctx.font = cornerFont
  const wrap = (text: string): string[] => (text ? wrapText(ctx, text, sideLabelWidth, MAX_TITLE_LINES) : [])
  const leftLines = wrap(row.labels.left)
  const topLines = wrap(row.labels.top)
  const bottomLines = wrap(row.labels.bottom)
  const rightLines = wrap(row.labels.right)
  const aboveLines = Math.max(leftLines.length, topLines.length)
  const belowLines = Math.max(bottomLines.length, rightLines.length)
  const height = titleLines.length * titleLineHeight + (aboveLines + belowLines) * cornerLineHeight + gridSize + sectionGap

  return {
    height,
    draw: (x, y) => {
      const left = x + indent
      const gridX = left + gridOffset
      let cursorY = y
      ctx.font = titleFont
      ctx.fillStyle = '#000000'
      drawLines(ctx, titleLines, left, cursorY, titleLineHeight)
      cursorY += titleLines.length * titleLineHeight

      ctx.font = cornerFont
      ctx.textAlign = 'right'
      drawLines(ctx, leftLines, gridX - labelGap, cursorY, cornerLineHeight)
      ctx.textAlign = 'left'
      drawLines(ctx, topLines, gridX + gridSize + labelGap, cursorY, cornerLineHeight)
      cursorY += aboveLines * cornerLineHeight

      const n = row.colors.length
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          // colors[0] is the SDK's "low" row — drawn at the bottom so the grid reads bottom-to-top.
          const cellX = gridX + c * cellSize
          const cellY = cursorY + (n - 1 - r) * cellSize
          ctx.fillStyle = row.colors[r][c]
          ctx.fillRect(cellX, cellY, cellSize, cellSize)
          ctx.strokeStyle = '#999999'
          ctx.strokeRect(cellX, cellY, cellSize, cellSize)
        }
      }
      cursorY += gridSize

      ctx.fillStyle = '#000000'
      ctx.textAlign = 'right'
      drawLines(ctx, bottomLines, gridX - labelGap, cursorY, cornerLineHeight)
      ctx.textAlign = 'left'
      drawLines(ctx, rightLines, gridX + gridSize + labelGap, cursorY, cornerLineHeight)
    }
  }
}

// Graduated circles at the SDK's own computed sizes (a size visual variable), largest first as the SDK
// provides them: a title block kept with the first circle, then one block per circle, so a long size
// ramp can continue in the next column.
function sizeBlocks (ctx: Painter, row: Extract<LegendRow, { kind: 'size' }>, indent: number, width: number, metrics: LegendMetrics): Block[] {
  if (row.stops.length === 0) return []
  const { fontSize, scale } = metrics
  const titleLineHeight = fontSize * 1.3
  const rowGap = 4 * scale
  const sectionGap = 10 * scale
  const labelGap = 6 * scale
  const maxDiameter = Math.max(4, ...row.stops.map((stop) => stop.size)) * scale
  const titleFont = `bold ${fontSize}px sans-serif`
  const labelFont = `${fontSize}px sans-serif`
  ctx.font = titleFont
  const titleLines = row.title ? wrapTitle(ctx, row.title, width) : []

  const blocks: Block[] = [{
    height: titleLines.length * titleLineHeight,
    keepWithNext: true,
    draw: (x, y) => {
      ctx.font = titleFont
      ctx.fillStyle = '#000000'
      drawLines(ctx, titleLines, x + indent, y, titleLineHeight)
    }
  }]
  row.stops.forEach((stop, index) => {
    blocks.push({
      height: maxDiameter + rowGap + (index === row.stops.length - 1 ? sectionGap : 0),
      draw: (x, y) => {
        const circleLeft = x + indent
        const diameter = Math.max(4, stop.size * scale)
        const cx = circleLeft + maxDiameter / 2
        const cy = y + maxDiameter / 2
        ctx.fillStyle = stop.color
        ctx.beginPath()
        ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#999999'
        ctx.stroke()
        ctx.font = labelFont
        ctx.fillStyle = '#000000'
        ctx.textAlign = 'left'
        ctx.fillText(stop.label, circleLeft + maxDiameter + labelGap, cy)
      }
    })
  })
  return blocks
}

// Wraps a title onto up to MAX_TITLE_LINES lines (the last ellipsized if still too long). Caller sets
// ctx.font. An empty title takes no space at all (some legend elements, e.g. a relationship ramp,
// legitimately have none) rather than leaving a blank line.
function wrapTitle (ctx: Painter, text: string, maxWidth: number): string[] {
  return text ? wrapText(ctx, text, maxWidth, MAX_TITLE_LINES) : []
}

// textBaseline is 'middle' throughout this renderer, so each line is drawn at its own vertical centre.
function drawLines (ctx: Painter, lines: string[], x: number, top: number, lineHeight: number): void {
  lines.forEach((line, index) => { ctx.fillText(line, x, top + lineHeight / 2 + index * lineHeight) })
}
