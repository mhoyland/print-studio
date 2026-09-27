import type { Layout } from '../config'
import { isLayout } from './templateStore.local'

// Persists only the viewer's own locally-imported templates (never the designer's config templates —
// those are already durably saved in the widget's own config) across a page refresh, via
// window.localStorage. Keyed per widget instance so multiple instances of this widget in the same app
// don't clobber each other's imports. This is deliberately a browser-local convenience, not a durable
// store — end users of this widget typically only have Portal viewer access, so there's no Portal-based
// alternative available to them the way there is for the designer at design time (templateStore.portal.ts).

const STORAGE_KEY_PREFIX = 'print-studio:importedTemplates:'
// Which of those templates the viewer made themselves (New/Duplicate) rather than imported — those are
// theirs to edit freely (see LayoutEditorProps.ownTemplate).
const OWNED_KEY_PREFIX = 'print-studio:ownedTemplateIds:'
// Fingerprint of each browser-stored template as last saved to (or imported from) a file — see
// templateFingerprint.ts.
const SAVED_FINGERPRINTS_KEY_PREFIX = 'print-studio:savedFingerprints:'

export function loadImportedTemplates (widgetId: string): Layout[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + widgetId)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLayout)
  } catch {
    // Corrupt JSON, storage disabled (e.g. some browsers' private-browsing modes), etc. — imported
    // templates just won't be restored in that case; the rest of the widget works normally.
    return []
  }
}

export function saveImportedTemplates (widgetId: string, templates: Layout[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + widgetId, JSON.stringify(templates))
  } catch {
    // Quota exceeded or storage disabled — same reasoning as loadImportedTemplates above.
  }
}

export function loadOwnedTemplateIds (widgetId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(OWNED_KEY_PREFIX + widgetId) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function saveOwnedTemplateIds (widgetId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(OWNED_KEY_PREFIX + widgetId, JSON.stringify(ids))
  } catch {
    // Same reasoning as saveImportedTemplates.
  }
}

export function loadSavedFingerprints (widgetId: string): { [templateId: string]: string } {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SAVED_FINGERPRINTS_KEY_PREFIX + widgetId) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as { [templateId: string]: string }
  } catch {
    return {}
  }
}

export function saveSavedFingerprints (widgetId: string, fingerprints: { [templateId: string]: string }): void {
  try {
    window.localStorage.setItem(SAVED_FINGERPRINTS_KEY_PREFIX + widgetId, JSON.stringify(fingerprints))
  } catch {
    // Same reasoning as saveImportedTemplates.
  }
}
