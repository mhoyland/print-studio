import { esri, SessionManager } from 'jimu-core'

// Design-time only (see ImageProps.tsx / PortalImagePicker.tsx) — same jimu-core `esri.restPortal`
// re-export and session pattern as templateStore.portal.ts, see its own comment for why.

export interface PortalImageSummary {
  portalItemId: string
  title: string
  thumbnailUrl?: string
}

export type PortalImageScope = 'mine' | 'org'

function getSession () {
  return SessionManager.getInstance().getMainSession()
}

// The thumbnail endpoint accepts the token directly in the query string (unlike getItemData, which
// needs a proper authenticated request) — that's the standard, documented way to fetch one, so a
// plain <img src> works here even for an org-private item, without going through resolvePortalImageUrl's
// blob/object-URL dance. `item.thumbnail` (when present) is just a relative filename the search result
// already includes, e.g. "thumbnail/thumb.png" — not present on every item, so this can return undefined.
function getThumbnailUrl (item: { id: string; thumbnail?: string }, session: ReturnType<typeof getSession>): string | undefined {
  if (!item.thumbnail) return undefined
  const portal = session.portal ?? 'https://www.arcgis.com/sharing/rest'
  return `${portal}/content/items/${item.id}/info/${item.thumbnail}?token=${session.token}`
}

// An unscoped `type:"Image"` search matches every public Image item across all of ArcGIS Online, not
// just this org — scoping is required, not optional. 'org' needs the signed-in user's org id, which
// isn't on the session itself and takes its own request to look up (getUser).
async function getScopeFilter (session: ReturnType<typeof getSession>, scope: PortalImageScope): Promise<string> {
  if (scope === 'mine') return `owner:"${session.username}"`
  const user = await esri.restPortal.getUser({ authentication: session })
  if (!user.orgId) throw new Error('Could not determine your organization.')
  return `orgid:"${user.orgId}"`
}

export async function searchPortalImages (query: string, scope: PortalImageScope): Promise<PortalImageSummary[]> {
  const session = getSession()
  const scopeFilter = await getScopeFilter(session, scope)
  const terms = query.trim()
  const q = terms ? `type:"Image" AND ${scopeFilter} AND (${terms})` : `type:"Image" AND ${scopeFilter}`
  const result = await esri.restPortal.searchItems({ q, authentication: session, num: 50 })
  return result.results.map((item) => ({
    portalItemId: item.id,
    title: item.title,
    thumbnailUrl: getThumbnailUrl(item, session)
  }))
}

// Uploads a local file straight into the signed-in user's Portal content as a new Image item — lets a
// designer add something to browse/reuse via Select-from-Portal without first having to leave the
// widget and upload through ArcGIS Online directly (e.g. when an org has no existing image items yet).
// The same file is also sent as the `thumbnail` param (a separate field from `file` in the underlying
// multipart request, per the REST API's Add Item operation) — ArcGIS Online doesn't auto-generate a
// thumbnail from an uploaded Image item's own file, so without this the item would have none and this
// picker's list would only ever show it as a blank placeholder.
export async function uploadImageToPortal (file: File, title: string): Promise<PortalImageSummary> {
  const session = getSession()
  const response = await esri.restPortal.createItem({
    item: { title, type: 'Image' },
    file,
    params: { thumbnail: file },
    authentication: session
  })
  return { portalItemId: response.id, title }
}

// Resolved via an authenticated request into a blob (then an object URL), rather than a raw
// cross-origin `<img src>` pointed at the portal — that would depend on the item being public and
// carries no token, so it'd break for anything access-restricted. Used both for the live editor
// preview and at export time (see Canvas.tsx / exportRenderer.ts), same as an uploaded image's
// `data:` URI is used today.
export async function resolvePortalImageUrl (portalItemId: string): Promise<string> {
  const session = getSession()
  const blob = await esri.restPortal.getItemData(portalItemId, { authentication: session, file: true }) as Blob
  return URL.createObjectURL(blob)
}
