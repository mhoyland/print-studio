import { React, hooks } from 'jimu-core'
import { Modal, ModalHeader, ModalBody, Button } from 'jimu-ui'
import type { Layout } from '../config'
import { listPortalTemplates, loadPortalTemplate, type PortalTemplateSummary } from '../runtime/templateStore.portal'
import defaultMessages from './setting.messages'

export interface PortalTemplatePickerProps {
  isOpen: boolean
  onClose: () => void
  onLoad: (layout: Layout) => void
}

// Design-time only — searches the signed-in user's own "printLayoutTemplate"-tagged Portal items and
// loads the chosen one as a new template (see templateStore.portal.ts for why Load always assigns a
// fresh local id, same as the local-file import path).
const PortalTemplatePicker = (props: PortalTemplatePickerProps): React.ReactElement => {
  const { isOpen, onClose, onLoad } = props
  const translate = hooks.useTranslation(defaultMessages)
  const [items, setItems] = React.useState<PortalTemplateSummary[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loadingId, setLoadingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isOpen) return
    setItems(null)
    setError(null)
    const load = async (): Promise<void> => {
      try {
        setItems(await listPortalTemplates())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
  }, [isOpen])

  const handleLoad = async (portalItemId: string): Promise<void> => {
    setLoadingId(portalItemId)
    setError(null)
    try {
      const layout = await loadPortalTemplate(portalItemId)
      onLoad(layout)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      <ModalHeader toggle={onClose}>{translate('loadTemplateFromPortal')}</ModalHeader>
      <ModalBody>
        {items === null && !error && <div className="text-disabled">{translate('searchingPortalItemsEllipsis')}</div>}
        {error && <div style={{ color: 'var(--sys-color-error)' }}>{error}</div>}
        {items?.length === 0 && <div className="text-disabled">{translate('noTemplatesFoundInPortal')}</div>}
        {items?.map((item) => (
          <div key={item.portalItemId} className="d-flex align-items-center justify-content-between mb-2">
            <span className="text-truncate" style={{ marginRight: 8 }}>{item.title}</span>
            <Button
              size="sm"
              type="primary"
              disabled={loadingId === item.portalItemId}
              onClick={() => { void handleLoad(item.portalItemId) }}
            >
              {loadingId === item.portalItemId ? translate('loadingEllipsis') : translate('load')}
            </Button>
          </div>
        ))}
      </ModalBody>
    </Modal>
  )
}

export default PortalTemplatePicker
