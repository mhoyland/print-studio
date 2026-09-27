import { saveAs } from 'jimu-core'
import type { Layout } from '../config'

// Local-file template save/load — available at both design time (TemplateManager.tsx) and runtime
// (TemplatePicker.tsx / widget.tsx), since it's plain client-side File API with no auth or portal
// dependency, unlike templateStore.portal.ts.

export function exportTemplateToFile (layout: Layout): void {
  const json = JSON.stringify(layout, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  saveAs(blob, `${layout.name || 'template'}.json`)
}

// Assigns a fresh id on import so an imported template can never collide with an existing one purely
// by chance (e.g. re-importing a file exported from this same widget instance).
export async function importTemplateFromFile (file: File): Promise<Layout> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!isLayout(parsed)) {
    throw new Error('That file is not a print/export template.')
  }
  // `portalItemId` is dropped too: a file can come from another portal or account, or point at an item
  // that has since been deleted, and a later "Save to Portal" would then try to update an item this
  // user doesn't have or that no longer exists (CONT_0001) instead of creating their own.
  const imported: Layout = { ...parsed, id: crypto.randomUUID() }
  delete imported.portalItemId
  return imported
}

export function isLayout (value: unknown): value is Layout {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { [key: string]: unknown }
  return typeof candidate.name === 'string' &&
    Array.isArray(candidate.elements) &&
    (candidate.pageSize === 'letter' || candidate.pageSize === 'tabloid' || candidate.pageSize === 'a4' || candidate.pageSize === 'a3') &&
    (candidate.orientation === 'portrait' || candidate.orientation === 'landscape')
}
