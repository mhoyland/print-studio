import { React, hooks } from 'jimu-core'
import { Label, Checkbox, NumericInput } from 'jimu-ui'
import { ColorPicker } from 'jimu-ui/basic/color-picker'
import type { ElementBase } from '../../../config'
import defaultMessages from '../../../translations/default'

export interface ContainerStyleFieldsProps {
  element: ElementBase
  onChange: (patch: Partial<ElementBase>) => void
}

// Shared by every per-type properties panel — border/fill/cornerRadius live on ElementBase so
// any element type can opt into a painted container (paintContainer.ts is the renderer-side
// counterpart of this).
const ContainerStyleFields = (props: ContainerStyleFieldsProps): React.ReactElement => {
  const { element, onChange } = props
  const translate = hooks.useTranslation(defaultMessages)
  const fillEnabled = element.fill?.enabled ?? false
  const fillColor = element.fill?.color ?? '#ffffff'

  return (
    <div className="mb-3">
      <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('container')}</div>

      <div className="d-flex align-items-center justify-content-between mb-2">
        <Label size="sm" style={{ marginBottom: 0 }}>{translate('borderColor')}</Label>
        <ColorPicker
          color={element.strokeColor ?? '#000000'}
          onChange={(strokeColor) => { onChange({ strokeColor }) }}
        />
      </div>
      <div className="mb-2">
        <Label size="sm">{translate('borderWidth')}</Label>
        <NumericInput
          size="sm"
          min={0}
          value={element.strokeWidth ?? 0}
          onChange={(value) => { if (value !== undefined) onChange({ strokeWidth: value }) }}
        />
      </div>
      <div className="mb-2">
        <Label size="sm">{translate('cornerRadius')}</Label>
        <NumericInput
          size="sm"
          min={0}
          value={element.cornerRadius ?? 0}
          onChange={(value) => { if (value !== undefined) onChange({ cornerRadius: value }) }}
        />
      </div>
      <div className="d-flex align-items-center justify-content-between">
        <div className="d-flex align-items-center" style={{ gap: 6 }}>
          <Checkbox
            checked={fillEnabled}
            onChange={(_evt, checked) => { onChange({ fill: { enabled: checked, color: fillColor } }) }}
          />
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('backgroundFill')}</Label>
        </div>
        {fillEnabled && (
          <ColorPicker
            color={fillColor}
            onChange={(color) => { onChange({ fill: { enabled: true, color } }) }}
          />
        )}
      </div>
    </div>
  )
}

export default ContainerStyleFields
