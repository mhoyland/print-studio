import type { Layout } from '../config'

// Tells whether a template stored in the viewer's browser has changes that aren't in a saved file.
// When a template is saved to file (or imported from one), its fingerprint is remembered
// (templateStore.localStorage.ts); comparing it with the template's current fingerprint then gives the
// states the widget shows ("Not saved to file", "Unsaved changes"). It knows a download was started,
// not that the file was kept.

export type TemplateFileStatus = 'notSaved' | 'changed' | 'saved'

// A short hash of the template's content. `id` and `portalItemId` are left out: they identify the
// template rather than describe it, and importing a file gives it a new id. Object keys are sorted
// first, so the same content always gives the same fingerprint however the layout was edited.
export function layoutFingerprint (layout: Layout): string {
  const { id: _id, portalItemId: _portalItemId, ...content } = layout
  const text = stableStringify(content)
  // FNV-1a, 32-bit: plenty for spotting a change in one template (this is not a security check).
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + text.length.toString(16)
}

export function templateFileStatus (layout: Layout, savedFingerprint: string | undefined): TemplateFileStatus {
  if (!savedFingerprint) return 'notSaved'
  return savedFingerprint === layoutFingerprint(layout) ? 'saved' : 'changed'
}

function stableStringify (value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as object).sort()
      .filter((key) => (value as { [key: string]: unknown })[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as { [key: string]: unknown })[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
