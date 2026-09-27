// Snap-target math for dragging an element in the Layout Editor canvas — shared by every
// ElementWrapper instance (see its own comment for why this can't just be interact.js's built-in
// `snap` modifier). Pure geometry, no DOM/React/interact.js involved, so it's trivially testable on
// its own.

export interface Bounds { x: number; y: number; w: number; h: number }

export interface GuideLine {
  orientation: 'vertical' | 'horizontal'
  position: number // x for a vertical line, y for a horizontal one — logical page px
  start: number // the line's other axis start/end, logical page px
  end: number
}

export interface SnapResult {
  dx: number // 0 when the x-axis didn't snap
  dy: number // 0 when the y-axis didn't snap
  guides: GuideLine[]
}

interface AxisCandidate {
  value: number
  // The source's extent on the OTHER axis — a sibling's own span, or the full page for a page-level
  // candidate — used to size the guide line so it reaches both the dragged element and whatever it
  // aligned with (or the full page edge-to-edge for a page-level snap).
  rangeStart: number
  rangeEnd: number
}

// `dragged` is the element's tentative bounds mid-drag (before any snapping is applied); `others` is
// every other element's current bounds (design-time: every sibling; the actively-dragged one is
// excluded by the caller). `thresholdLogicalPx` is already zoom-converted by the caller, so this
// function only ever deals in the page's own logical coordinate space.
export function computeSnap (dragged: Bounds, others: Bounds[], pageWidth: number, pageHeight: number, thresholdLogicalPx: number): SnapResult {
  const xCandidates: AxisCandidate[] = [
    { value: 0, rangeStart: 0, rangeEnd: pageHeight },
    { value: pageWidth / 2, rangeStart: 0, rangeEnd: pageHeight },
    { value: pageWidth, rangeStart: 0, rangeEnd: pageHeight }
  ]
  const yCandidates: AxisCandidate[] = [
    { value: 0, rangeStart: 0, rangeEnd: pageWidth },
    { value: pageHeight / 2, rangeStart: 0, rangeEnd: pageWidth },
    { value: pageHeight, rangeStart: 0, rangeEnd: pageWidth }
  ]
  for (const other of others) {
    xCandidates.push(
      { value: other.x, rangeStart: other.y, rangeEnd: other.y + other.h },
      { value: other.x + other.w / 2, rangeStart: other.y, rangeEnd: other.y + other.h },
      { value: other.x + other.w, rangeStart: other.y, rangeEnd: other.y + other.h }
    )
    yCandidates.push(
      { value: other.y, rangeStart: other.x, rangeEnd: other.x + other.w },
      { value: other.y + other.h / 2, rangeStart: other.x, rangeEnd: other.x + other.w },
      { value: other.y + other.h, rangeStart: other.x, rangeEnd: other.x + other.w }
    )
  }

  const dragXPoints = [dragged.x, dragged.x + dragged.w / 2, dragged.x + dragged.w]
  const dragYPoints = [dragged.y, dragged.y + dragged.h / 2, dragged.y + dragged.h]

  const xMatch = findBestMatch(dragXPoints, xCandidates, thresholdLogicalPx)
  const yMatch = findBestMatch(dragYPoints, yCandidates, thresholdLogicalPx)

  const guides: GuideLine[] = []
  const dx = xMatch?.delta ?? 0
  const dy = yMatch?.delta ?? 0

  if (xMatch) {
    guides.push({
      orientation: 'vertical',
      position: xMatch.candidate.value,
      start: Math.min(xMatch.candidate.rangeStart, dragged.y + dy),
      end: Math.max(xMatch.candidate.rangeEnd, dragged.y + dy + dragged.h)
    })
  }
  if (yMatch) {
    guides.push({
      orientation: 'horizontal',
      position: yMatch.candidate.value,
      start: Math.min(yMatch.candidate.rangeStart, dragged.x + dx),
      end: Math.max(yMatch.candidate.rangeEnd, dragged.x + dx + dragged.w)
    })
  }

  return { dx, dy, guides }
}

// Finds the single closest-matching (point, candidate) pair within threshold, across all three of
// the dragged element's points on this axis — so e.g. its right edge can snap even while its left
// edge and center are nowhere near anything.
function findBestMatch (dragPoints: number[], candidates: AxisCandidate[], threshold: number): { candidate: AxisCandidate; delta: number } | null {
  let best: { candidate: AxisCandidate; delta: number } | null = null
  for (const point of dragPoints) {
    for (const candidate of candidates) {
      const delta = candidate.value - point
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { candidate, delta }
      }
    }
  }
  return best
}
