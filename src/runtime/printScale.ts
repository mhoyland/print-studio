// Scale helpers for the runtime Advanced section (spec Phase 14). Scales are true scale denominators
// at the map frame's centre: 24000 means 1:24,000 measured with a ruler on the printout.

export function isValidScale (value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && value >= 1
}

export function formatScale (scale: number): string {
  return `1:${Math.round(scale).toLocaleString()}`
}
