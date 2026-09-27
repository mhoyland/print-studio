import type { Layout } from '../config'

// 150dpi pixel dimensions for each portrait page size; getPageSizePx flips w/h for landscape.
const PAGE_SIZES_PX: { [size in Layout['pageSize']]: { w: number; h: number } } = {
  letter: { w: 1275, h: 1650 },
  tabloid: { w: 1650, h: 2550 },
  a4: { w: 1240, h: 1754 },
  a3: { w: 1754, h: 2481 }
}

export function getPageSizePx (layout: Pick<Layout, 'pageSize' | 'orientation'>): { w: number; h: number } {
  const base = PAGE_SIZES_PX[layout.pageSize] ?? PAGE_SIZES_PX.letter
  return layout.orientation === 'landscape' ? { w: base.h, h: base.w } : base
}
