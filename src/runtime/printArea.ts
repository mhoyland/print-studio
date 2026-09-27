export interface PrintAreaRect { x: number; y: number; width: number; height: number }

// Matches the built-in Print widget's own map-only-layout fit: the box is centered in the current
// view and sized to the largest box of the target aspect ratio that fits with ~10% padding on the
// tighter dimension — not tied to map scale/extent, since (unlike the built-in widget, which feeds
// this into the ArcGIS print service as a map Extent) this widget only ever needs a screen-space crop
// rectangle for view.takeScreenshot's own `area` option.
const FIT_RATIO = 0.9

// aspectRatio is width/height of the thing being framed (the layout's mapFrame element). Returns null
// when there's nothing sane to compute (container not yet measured, or a degenerate aspect ratio).
export function computePrintAreaRect (containerWidth: number, containerHeight: number, aspectRatio: number): PrintAreaRect | null {
  if (containerWidth <= 0 || containerHeight <= 0 || !isFinite(aspectRatio) || aspectRatio <= 0) return null

  const maxWidth = containerWidth * FIT_RATIO
  const maxHeight = containerHeight * FIT_RATIO
  let width = maxWidth
  let height = width / aspectRatio
  if (height > maxHeight) {
    height = maxHeight
    width = height * aspectRatio
  }

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height
  }
}
