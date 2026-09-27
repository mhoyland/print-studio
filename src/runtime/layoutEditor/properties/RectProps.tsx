import { React, hooks } from 'jimu-core'
import { Button } from 'jimu-ui'
import { BringFrontOutlined } from 'jimu-icons/outlined/directional/bring-front'
import { SendForwardOutlined } from 'jimu-icons/outlined/directional/send-forward'
import { SendBackwardOutlined } from 'jimu-icons/outlined/directional/send-backward'
import { BringBackOutlined } from 'jimu-icons/outlined/directional/bring-back'
import type { RectElement } from '../../../config'
import type { ArrangeDirection } from '../LayoutEditor'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import defaultMessages from '../../../translations/default'

export interface RectPropsProps {
  element: RectElement
  onChange: (patch: Partial<RectElement>) => void
  onArrange: (direction: ArrangeDirection) => void
  viewerMode?: boolean
}

const ARRANGE_ACTIONS: Array<{ direction: ArrangeDirection; labelKey: string; Icon: React.ComponentType<{ size?: number }> }> = [
  { direction: 'front', labelKey: 'bringToFront', Icon: BringFrontOutlined },
  { direction: 'forward', labelKey: 'bringForward', Icon: SendForwardOutlined },
  { direction: 'backward', labelKey: 'sendBackward', Icon: SendBackwardOutlined },
  { direction: 'back', labelKey: 'sendToBack', Icon: BringBackOutlined }
]

// A rect has no fields of its own beyond ElementBase — it's just the shared border/fill/cornerRadius
// styling on a plain box (used for neatlines sent to back, or highlighted callout boxes). Arrange only
// lives here for now since reordering is primarily motivated by the neatline use case.
const RectProps = (props: RectPropsProps): React.ReactElement => {
  const { element, onChange, onArrange, viewerMode } = props
  const translate = hooks.useTranslation(defaultMessages)

  return (
    <div>
      <PositionSizeFields element={element} onChange={onChange} />

      {!viewerMode && (
        <div className="mb-3">
          <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('arrange')}</div>
          <div className="d-flex" style={{ gap: 4 }}>
            {ARRANGE_ACTIONS.map(({ direction, labelKey, Icon }) => (
              <Button
                key={direction}
                icon
                size="sm"
                type="tertiary"
                title={translate(labelKey)}
                aria-label={translate(labelKey)}
                onClick={() => { onArrange(direction) }}
              >
                <Icon size={16} />
              </Button>
            ))}
          </div>
        </div>
      )}

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

export default RectProps
