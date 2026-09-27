import { React, hooks } from 'jimu-core'
import { Label, Select, Option, Checkbox, NumericInput } from 'jimu-ui'
import { ColorPicker } from 'jimu-ui/basic/color-picker'
import type { NorthArrowElement } from '../../../config'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import defaultMessages from '../../../translations/default'

export interface NorthArrowPropsProps {
  element: NorthArrowElement
  onChange: (patch: Partial<NorthArrowElement>) => void
}

const STYLE_OPTIONS: Array<{ value: NorthArrowElement['style']; labelKey: string }> = [
  { value: 'classic', labelKey: 'styleClassic' },
  { value: 'compass', labelKey: 'styleCompass' },
  { value: 'minimal', labelKey: 'styleMinimal' },
  { value: 'compassRose', labelKey: 'styleCompassRose' }
]

const NorthArrowProps = (props: NorthArrowPropsProps): React.ReactElement => {
  const { element, onChange } = props
  const translate = hooks.useTranslation(defaultMessages)

  return (
    <div>
      <PositionSizeFields element={element} onChange={onChange} />

      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('northArrowSectionTitle')}</div>

        <Label size="sm">{translate('style')}</Label>
        <Select
          size="sm"
          value={element.style}
          onChange={(_evt, value) => { onChange({ style: value as NorthArrowElement['style'] }) }}
        >
          {STYLE_OPTIONS.map((option) => <Option key={option.value} value={option.value}>{translate(option.labelKey)}</Option>)}
        </Select>

        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('color')}</Label>
          <ColorPicker color={element.color} onChange={(color) => { onChange({ color }) }} />
        </div>

        <div className="d-flex align-items-center mt-2" style={{ gap: 6 }}>
          <Checkbox
            checked={element.syncToMapRotation}
            onChange={(_evt, checked) => { onChange({ syncToMapRotation: checked }) }}
          />
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('syncToMapRotation')}</Label>
        </div>

        <div className="mt-2">
          <Label size="sm">{translate('rotationDegrees')}</Label>
          <NumericInput
            size="sm"
            disabled={element.syncToMapRotation}
            value={element.rotation}
            onChange={(value) => { if (value !== undefined) onChange({ rotation: value }) }}
          />
        </div>
      </div>

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

export default NorthArrowProps
