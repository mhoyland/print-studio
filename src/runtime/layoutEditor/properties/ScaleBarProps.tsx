import { React, hooks } from 'jimu-core'
import { Label, Select, Option, NumericInput } from 'jimu-ui'
import type { ScaleBarElement } from '../../../config'
import { DEFAULT_FONT_SIZE } from '../../elementRenderers/renderScaleBar'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import defaultMessages from '../../../translations/default'

export interface ScaleBarPropsProps {
  element: ScaleBarElement
  onChange: (patch: Partial<ScaleBarElement>) => void
}

const UNIT_OPTIONS: Array<{ value: ScaleBarElement['unit']; labelKey: string }> = [
  { value: 'km', labelKey: 'unitKilometers' },
  { value: 'm', labelKey: 'unitMeters' },
  { value: 'mi', labelKey: 'unitMiles' },
  { value: 'ft', labelKey: 'unitFeet' }
]

const STYLE_OPTIONS: Array<{ value: ScaleBarElement['style']; labelKey: string }> = [
  { value: 'line', labelKey: 'styleLine' },
  { value: 'alternating', labelKey: 'styleAlternatingBar' }
]

const ALIGN_OPTIONS: Array<{ value: NonNullable<ScaleBarElement['align']>; labelKey: string }> = [
  { value: 'left', labelKey: 'alignLeft' },
  { value: 'center', labelKey: 'alignCenter' },
  { value: 'right', labelKey: 'alignRight' }
]

const ScaleBarProps = (props: ScaleBarPropsProps): React.ReactElement => {
  const { element, onChange } = props
  const translate = hooks.useTranslation(defaultMessages)

  return (
    <div>
      <PositionSizeFields element={element} onChange={onChange} />

      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('toolScaleBar')}</div>

        <Label size="sm">{translate('units')}</Label>
        <Select
          size="sm"
          value={element.unit}
          onChange={(_evt, value) => { onChange({ unit: value as ScaleBarElement['unit'] }) }}
        >
          {UNIT_OPTIONS.map((option) => <Option key={option.value} value={option.value}>{translate(option.labelKey)}</Option>)}
        </Select>

        <div className="mt-2">
          <Label size="sm">{translate('style')}</Label>
          <Select
            size="sm"
            value={element.style}
            onChange={(_evt, value) => { onChange({ style: value as ScaleBarElement['style'] }) }}
          >
            {STYLE_OPTIONS.map((option) => <Option key={option.value} value={option.value}>{translate(option.labelKey)}</Option>)}
          </Select>
        </div>

        <div className="mt-2">
          <Label size="sm">{translate('horizontalAlign')}</Label>
          <Select
            size="sm"
            value={element.align ?? 'left'}
            onChange={(_evt, value) => { onChange({ align: value as ScaleBarElement['align'] }) }}
          >
            {ALIGN_OPTIONS.map((option) => <Option key={option.value} value={option.value}>{translate(option.labelKey)}</Option>)}
          </Select>
        </div>

        <div className="mt-2">
          <Label size="sm">{translate('fontSize')}</Label>
          <NumericInput
            size="sm"
            min={4}
            max={72}
            value={element.fontSize ?? DEFAULT_FONT_SIZE}
            onChange={(value) => { if (value !== undefined) onChange({ fontSize: value }) }}
          />
        </div>
      </div>

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

export default ScaleBarProps
