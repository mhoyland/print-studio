import type { Layout } from '../config'
import { getPageSizePx } from './pageSize'

// Template construction shared by the Setting panel's New/Duplicate (TemplateManager.tsx) and the
// runtime's viewer-created templates (TemplatePicker.tsx, WidgetConfig.allowViewerCreateTemplates).

// A brand new template starts as a blank page with just a full-page map frame — the rest is built from
// the Toolbar. The designer's map frame starts locked, so later viewers can't nudge it by accident; a
// viewer's own new template starts with it unlocked, since they are its designer.
export function createBlankLayout (name: string, options: { mapFrameLocked: boolean }): Layout {
  const pageSize: Layout['pageSize'] = 'letter'
  const orientation: Layout['orientation'] = 'portrait'
  const { w, h } = getPageSizePx({ pageSize, orientation })
  const margin = Math.round(w * 0.03)
  return {
    id: crypto.randomUUID(),
    name,
    pageSize,
    orientation,
    elements: [
      {
        id: crypto.randomUUID(),
        name: 'Map frame',
        type: 'mapFrame',
        x: margin,
        y: margin,
        w: w - margin * 2,
        h: h - margin * 2,
        zIndex: 0,
        locked: options.mapFrameLocked,
        visible: true
      }
    ]
  }
}

// A deep, independent copy with a new id (so editing it never touches the original) and a new name.
// A Portal item link isn't carried over: the copy is a different template.
export function duplicateLayout (source: Layout, name: string): Layout {
  const copy: Layout = JSON.parse(JSON.stringify(source))
  delete copy.portalItemId
  return { ...copy, id: crypto.randomUUID(), name }
}

// `base`, or `base 2`, `base 3`... — whichever isn't already a template name.
export function uniqueTemplateName (base: string, existing: Layout[]): string {
  const names = new Set(existing.map((template) => template.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}
