import { React, hooks } from 'jimu-core'
import { Label, NumericInput, Checkbox, TextInput, Select, Option } from 'jimu-ui'
import type { LegendElement } from '../../../config'
import { DEFAULT_FONT_SIZE, DEFAULT_TITLE } from '../../elementRenderers/renderLegend'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import defaultMessages from '../../../translations/default'

export interface LegendPropsProps {
  element: LegendElement
  onChange: (patch: Partial<LegendElement>) => void
}

const COLUMN_OPTIONS: Array<{ value: NonNullable<LegendElement['columns']>; labelKey: string }> = [
  { value: 'auto', labelKey: 'columnsAuto' },
  { value: 1, labelKey: 'columns1' },
  { value: 2, labelKey: 'columns2' },
  { value: 3, labelKey: 'columns3' },
  { value: 4, labelKey: 'columns4' }
]

// `autoFitHeight` isn't exposed here yet — renderLegend.ts doesn't actually act on it (it always
// paints against the element's stored `h`), so a toggle here would silently do nothing. Wiring it up
// properly means growing/shrinking `h` itself to match the live entry count, which is a small follow-up.
const LegendProps = (props: LegendPropsProps): React.ReactElement => {
  const { element, onChange } = props
  const translate = hooks.useTranslation(defaultMessages)

  return (
    <div>
      <PositionSizeFields element={element} onChange={onChange} />

      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('toolLegend')}</div>

        <div className="d-flex align-items-center" style={{ gap: 6 }}>
          <Checkbox
            checked={element.showTitle ?? true}
            onChange={(_evt, checked) => { onChange({ showTitle: checked }) }}
          />
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('showTitle')}</Label>
        </div>
        {(element.showTitle ?? true) && (
          <TextInput
            className="mt-1"
            size="sm"
            placeholder={DEFAULT_TITLE}
            value={element.title ?? ''}
            onChange={(evt) => { onChange({ title: evt.target.value }) }}
          />
        )}

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
        <div className="text-disabled small mt-1">{translate('legendFontSizeHint')}</div>

        <div className="mt-2">
          <Label size="sm">{translate('columns')}</Label>
          <Select
            size="sm"
            value={element.columns ?? 'auto'}
            onChange={(_evt, value) => { onChange({ columns: (value === 'auto' ? 'auto' : Number(value)) as LegendElement['columns'] }) }}
          >
            {COLUMN_OPTIONS.map((option) => <Option key={option.value} value={option.value}>{translate(option.labelKey)}</Option>)}
          </Select>
        </div>
      </div>

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

export default LegendProps
