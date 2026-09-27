import { esri, SessionManager } from 'jimu-core'
import type { Layout } from '../config'

// Design-time only (see TemplateManager.tsx) — never imported from widget.tsx or anywhere else that
// ends up in the always-loaded runtime bundle. Uses jimu-core's own re-export of
// @esri/arcgis-rest-portal (`esri.restPortal`) rather than importing that package directly: jimu-core
// is already loaded once by the Experience Builder app shell regardless of what this widget does, so
// referencing its copy adds no bundle weight of its own — unlike a direct `@esri/arcgis-rest-portal`
// import, which would bundle the whole library into whatever chunk pulled it in.
//
// Auth comes from `SessionManager.getInstance().getMainSession()` — the same signed-in session
// Experience Builder itself is already using, so there's no separate portal sign-in flow to build.
//
// The item `type` used to store a template's JSON is "Application Configuration", a generic
// AGO item type for app-defined JSON config not tied to any map/service. If a portal's validation
// rejects it, the fix is a one-line change here — the `printLayoutTemplate` tag (not the type) is
// what searchItems below actually filters on, so the exact type string isn't load-bearing elsewhere.
const PORTAL_ITEM_TYPE = 'Application Configuration'
const PORTAL_TAG = 'printLayoutTemplate'

export interface PortalTemplateSummary {
  portalItemId: string
  title: string
  modified: number
}

function getSession () {
  return SessionManager.getInstance().getMainSession()
}

// Scoped to the signed-in user's own items — a designer loads templates they (or the app) previously
// saved, not the whole org's.
export async function listPortalTemplates (): Promise<PortalTemplateSummary[]> {
  const session = getSession()
  const result = await esri.restPortal.searchItems({
    q: `type:"${PORTAL_ITEM_TYPE}" AND tags:"${PORTAL_TAG}" AND owner:"${session.username}"`,
    authentication: session,
    num: 100
  })
  return result.results.map((item) => ({
    portalItemId: item.id,
    title: item.title,
    modified: item.modified
  }))
}

// Fresh local id on load, same reasoning as templateStore.local.ts's importTemplateFromFile — never
// collides with an existing template purely by chance. `portalItemId` is set explicitly from the id
// just fetched from, not read back from the loaded JSON — the very first time a template is ever
// saved, its stored `text` is serialized *before* the new item's id is known (createItem hasn't
// returned yet), so the id is never actually present inside the data itself. Relying on that would
// mean this template forgets its own portal item on every load, and a later "Save to Portal" would
// look like a first save again and create a duplicate rather than updating.
export async function loadPortalTemplate (portalItemId: string): Promise<Layout> {
  const session = getSession()
  const data = await esri.restPortal.getItemData(portalItemId, { authentication: session }) as Layout
  return { ...data, id: crypto.randomUUID(), portalItemId }
}

// Creates a new Portal item the first time a template is saved, then updates that same item on every
// later save (tracked via Layout.portalItemId) — matching the per-template granularity local file
// export/import already uses.
export async function savePortalTemplate (layout: Layout): Promise<string> {
  const session = getSession()
  const text = JSON.stringify(layout)

  if (layout.portalItemId) {
    try {
      // `text` has to sit inside `item` here — unlike createItem below, updateItem only forwards the
      // fields of `item` to the portal and silently ignores a top-level `text`, which is how a re-save
      // used to succeed while only ever updating the title and never the template's actual content.
      await esri.restPortal.updateItem({
        item: { id: layout.portalItemId, title: layout.name, text },
        authentication: session
      })
      return layout.portalItemId
    } catch (error) {
      // The remembered item was deleted (or isn't accessible to this user) since it was last saved —
      // fall through and create a fresh item rather than leaving the template permanently unsavable.
      if (!(error instanceof Error && error.message.includes('CONT_0001'))) throw error
    }
  }

  const response = await esri.restPortal.createItem({
    item: { title: layout.name, type: PORTAL_ITEM_TYPE, tags: [PORTAL_TAG] },
    text,
    authentication: session
  })
  return response.id
}
