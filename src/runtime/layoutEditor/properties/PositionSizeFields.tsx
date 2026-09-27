import { React, hooks } from 'jimu-core'
import { Label, NumericInput } from 'jimu-ui'
import type { ElementBase } from '../../../config'
import defaultMessages from '../../../translations/default'

export interface PositionSizeFieldsProps {
  element: ElementBase
  onChange: (patch: Partial<ElementBase>) => void
}

// Shared by every per-type properties panel — typing exact numbers here updates the same
// x/y/w/h that dragging/resizing on the canvas does.
const PositionSizeFields = (props: PositionSizeFieldsProps): React.ReactElement => {
  const { element, onChange } = props
  const translate = hooks.useTranslation(defaultMessages)

  return (
    <div className="mb-3">
      <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('positionAndSize')}</div>
      <div className="d-flex" style={{ gap: 8 }}>
        <Field label={translate('fieldX')} value={element.x} onChange={(x) => { onChange({ x }) }} />
        <Field label={translate('fieldY')} value={element.y} onChange={(y) => { onChange({ y }) }} />
      </div>
      <div className="d-flex mt-2" style={{ gap: 8 }}>
        <Field label={translate('fieldW')} value={element.w} onChange={(w) => { onChange({ w: Math.max(1, w) }) }} />
        <Field label={translate('fieldH')} value={element.h} onChange={(h) => { onChange({ h: Math.max(1, h) }) }} />
      </div>
    </div>
  )
}

function Field (props: { label: string; value: number; onChange: (value: number) => void }): React.ReactElement {
  return (
    <div style={{ flex: 1 }}>
      <Label size="sm">{props.label}</Label>
      <NumericInput
        size="sm"
        value={Math.round(props.value)}
        onChange={(value) => { if (value !== undefined) props.onChange(value) }}
      />
    </div>
  )
}

export default PositionSizeFields
