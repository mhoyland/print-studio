import { React, hooks } from 'jimu-core'
import { Modal, ModalHeader, ModalBody, Button, ButtonGroup, TextInput } from 'jimu-ui'
import { searchPortalImages, uploadImageToPortal, type PortalImageSummary, type PortalImageScope } from '../portalImage'
import defaultMessages from '../../translations/default'

export interface PortalImagePickerProps {
  isOpen: boolean
  onClose: () => void
  onPick: (portalItemId: string, title: string) => void
}

const MAX_IMAGE_BYTES = 1024 * 1024
const SCOPE_OPTIONS: Array<{ value: PortalImageScope; labelKey: string }> = [
  { value: 'mine', labelKey: 'portalMyContent' },
  { value: 'org', labelKey: 'portalMyOrganization' }
]

// Design-time only — browses the signed-in user's own or org's "Image" items (an unscoped search
// would otherwise match every public Image item across all of ArcGIS Online, not just this org — see
// portalImage.ts) and hands back the chosen item's id, which ImageProps.tsx stores as `portalItemId`;
// resolving it to an actual displayable image happens separately at render/export time (Canvas.tsx /
// exportRenderer.ts), not here. Also offers uploading a local file straight into Portal, for the case
// where the org/user has no existing image items to pick from yet.
const PortalImagePicker = (props: PortalImagePickerProps): React.ReactElement => {
  const { isOpen, onClose, onPick } = props
  const translate = hooks.useTranslation(defaultMessages)
  const [query, setQuery] = React.useState('')
  const [scope, setScope] = React.useState<PortalImageScope>('mine')
  const [items, setItems] = React.useState<PortalImageSummary[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  // Thumbnail loading depends on the portal serving its thumbnail endpoint the same way ArcGIS Online
  // does (token accepted directly in the query string) — likely fine, but not verified against every
  // portal configuration, so a failed load falls back to the plain placeholder square rather than
  // showing a broken-image icon.
  const [failedThumbnailIds, setFailedThumbnailIds] = React.useState<Set<string>>(new Set())

  const runSearch = React.useCallback((searchQuery: string, searchScope: PortalImageScope): void => {
    setItems(null)
    setError(null)
    setFailedThumbnailIds(new Set())
    const search = async (): Promise<void> => {
      try {
        setItems(await searchPortalImages(searchQuery, searchScope))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void search()
  }, [])

  React.useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setScope('mine')
    runSearch('', 'mine')
  }, [isOpen, runSearch])

  const handleScopeChange = (nextScope: PortalImageScope): void => {
    setScope(nextScope)
    runSearch(query, nextScope)
  }

  const handleUploadFile = async (evt: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = evt.target.files?.[0]
    evt.target.value = ''
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      setError(translate('imageMustBeSmaller'))
      return
    }
    setIsUploading(true)
    setError(null)
    try {
      const uploaded = await uploadImageToPortal(file, file.name.replace(/\.[^.]+$/, ''))
      onPick(uploaded.portalItemId, uploaded.title)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      <ModalHeader toggle={onClose}>{translate('selectImageFromPortal')}</ModalHeader>
      <ModalBody>
        <ButtonGroup className="mb-2">
          {SCOPE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              active={scope === option.value}
              onClick={() => { handleScopeChange(option.value) }}
            >
              {translate(option.labelKey)}
            </Button>
          ))}
        </ButtonGroup>

        <div className="d-flex mb-3" style={{ gap: 8 }}>
          <TextInput
            size="sm"
            placeholder={translate('searchByTitleEllipsis')}
            value={query}
            onChange={(evt) => { setQuery(evt.target.value) }}
            onKeyDown={(evt) => { if (evt.key === 'Enter') runSearch(query, scope) }}
          />
          <Button size="sm" onClick={() => { runSearch(query, scope) }}>{translate('search')}</Button>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 12 }}>
          {items === null && !error && <div className="text-disabled">{translate('searchingEllipsis')}</div>}
          {items?.length === 0 && <div className="text-disabled">{translate('noImagesFound')}</div>}
          {items?.map((item) => (
            <div key={item.portalItemId} className="d-flex align-items-center justify-content-between mb-2" style={{ paddingRight: 4 }}>
              <div className="d-flex align-items-center" style={{ minWidth: 0, marginRight: 8 }}>
                {item.thumbnailUrl && !failedThumbnailIds.has(item.portalItemId)
                  ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      style={{ width: 32, height: 32, objectFit: 'contain', marginRight: 8, flexShrink: 0, border: '1px solid var(--sys-color-divider-primary)', backgroundColor: '#fff' }}
                      onError={() => { setFailedThumbnailIds((prev) => new Set(prev).add(item.portalItemId)) }}
                    />
                    )
                  : (
                    <div
                      style={{ width: 32, height: 32, marginRight: 8, flexShrink: 0, border: '1px solid var(--sys-color-divider-primary)', backgroundColor: 'var(--sys-color-action-selected)' }}
                    />
                    )}
                <span className="text-truncate">{item.title}</span>
              </div>
              <Button size="sm" type="primary" style={{ flexShrink: 0 }} onClick={() => { onPick(item.portalItemId, item.title) }}>{translate('select')}</Button>
            </div>
          ))}
        </div>

        {error && <div className="mb-2" style={{ color: 'var(--sys-color-error)' }}>{error}</div>}

        <div style={{ borderTop: '1px solid var(--sys-color-divider-primary)', paddingTop: 12 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/svg+xml"
            style={{ display: 'none' }}
            onChange={(evt) => { void handleUploadFile(evt) }}
          />
          <Button size="sm" block disabled={isUploading} onClick={() => { fileInputRef.current?.click() }}>
            {isUploading ? translate('uploadingEllipsis') : translate('uploadNewImageToPortalEllipsis')}
          </Button>
          <div className="text-disabled small mt-1">{translate('portalUploadHint')}</div>
        </div>
      </ModalBody>
    </Modal>
  )
}

export default PortalImagePicker
