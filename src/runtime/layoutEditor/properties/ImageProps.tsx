import { React, hooks } from 'jimu-core'
import { Label, Checkbox, Button, ButtonGroup } from 'jimu-ui'
import type { ImageElement } from '../../../config'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import PortalImagePicker from '../PortalImagePicker'
import defaultMessages from '../../../translations/default'

export interface ImagePropsProps {
  element: ImageElement
  onChange: (patch: Partial<ImageElement>) => void
  // Replacing the image file/Portal item is a template-identity decision, so it's hidden in the
  // runtime viewer editor — but the preview and "Lock aspect ratio" (which affects how a viewer's own
  // resize behaves) still show.
  viewerMode?: boolean
}

const MAX_IMAGE_BYTES = 1024 * 1024

const SOURCE_OPTIONS: Array<{ value: ImageElement['source']; labelKey: string }> = [
  { value: 'upload', labelKey: 'sourceUpload' },
  { value: 'portalItem', labelKey: 'sourcePortal' }
]

// The image source is set right here, per-element, rather than in the widget's Setting panel —
// that made sense back when there could only ever be one logo, but now any number of image
// elements can be added from the toolbar, so each needs its own independently-set source.
const ImageProps = (props: ImagePropsProps): React.ReactElement => {
  const { element, onChange, viewerMode } = props
  const translate = hooks.useTranslation(defaultMessages)
  const [error, setError] = React.useState<string>(null)
  const [isPortalPickerOpen, setIsPortalPickerOpen] = React.useState(false)
  // Not persisted on the element (only `portalItemId` is) — just a nicer confirmation label for
  // whatever was picked *this session*; re-selecting the same element later without re-picking falls
  // back to showing the raw id, which is still enough to confirm something is set.
  const [pickedPortalTitle, setPickedPortalTitle] = React.useState<string | null>(null)

  const onFileSelected = (evt: React.ChangeEvent<HTMLInputElement>): void => {
    const file = evt.target.files?.[0]
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      setError(translate('imageMustBeSmaller'))
      return
    }
    setError(null)

    const reader = new FileReader()
    reader.onload = () => {
      onChange({ source: 'upload', url: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  const handlePortalPick = (portalItemId: string, title: string): void => {
    onChange({ source: 'portalItem', portalItemId, url: undefined })
    setPickedPortalTitle(title)
    setIsPortalPickerOpen(false)
  }

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  return (
    <div>
      <PositionSizeFields element={element} onChange={onChange} />

      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('toolImage')}</div>

        {element.source === 'upload' && element.url && (
          <img
            src={element.url}
            alt=""
            style={{ maxWidth: '100%', maxHeight: 80, display: 'block', marginBottom: 8, border: '1px solid var(--sys-color-divider-primary)' }}
          />
        )}

        {!viewerMode && (
          <>
            <ButtonGroup className="mb-2">
              {SOURCE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  active={element.source === option.value}
                  onClick={() => { onChange({ source: option.value }) }}
                >
                  {translate(option.labelKey)}
                </Button>
              ))}
            </ButtonGroup>

            {element.source === 'upload' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/svg+xml"
                  style={{ display: 'none' }}
                  onChange={onFileSelected}
                />
                <Button size="sm" block onClick={() => { fileInputRef.current?.click() }}>
                  {element.url ? translate('replaceImage') : translate('uploadImageFile')}
                </Button>
                <div className="text-disabled small mt-1">{translate('pngOrSvgUpTo1Mb')}</div>
                {error && <div className="small" style={{ color: 'var(--sys-color-error)' }}>{error}</div>}
              </>
            )}

            {element.source === 'portalItem' && (
              <>
                {element.portalItemId && (
                  <div className="text-disabled small mb-1 text-truncate">
                    {translate('usingPortalImage', { value: pickedPortalTitle ?? element.portalItemId })}
                  </div>
                )}
                <Button size="sm" block onClick={() => { setIsPortalPickerOpen(true) }}>
                  {element.portalItemId ? translate('changeEllipsis') : translate('browsePortalEllipsis')}
                </Button>
                <PortalImagePicker
                  isOpen={isPortalPickerOpen}
                  onClose={() => { setIsPortalPickerOpen(false) }}
                  onPick={handlePortalPick}
                />
              </>
            )}
          </>
        )}

        <div className="d-flex align-items-center mt-2" style={{ gap: 6 }}>
          <Checkbox
            checked={element.lockAspect}
            onChange={(_evt, checked) => { onChange({ lockAspect: checked }) }}
          />
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('lockAspectRatio')}</Label>
        </div>
      </div>

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

export default ImageProps
