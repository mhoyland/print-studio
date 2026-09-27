import { React, hooks } from 'jimu-core'
import { Label, TextArea, NumericInput, Select, Option, Checkbox, Button, ButtonGroup } from 'jimu-ui'
import { ColorPicker } from 'jimu-ui/basic/color-picker'
import { AlignTopOutlined } from 'jimu-icons/outlined/directional/align-top'
import { AlignVerticalCenterOutlined } from 'jimu-icons/outlined/directional/align-vertical-center'
import { AlignBottomOutlined } from 'jimu-icons/outlined/directional/align-bottom'
import { TextLeftOutlined } from 'jimu-icons/outlined/editor/text-left'
import { TextCenterOutlined } from 'jimu-icons/outlined/editor/text-center'
import { TextRightOutlined } from 'jimu-icons/outlined/editor/text-right'
import type { TextElement } from '../../../config'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import defaultMessages from '../../../translations/default'

export interface TextPropsProps {
  element: TextElement
  onChange: (patch: Partial<TextElement>) => void
  viewerMode?: boolean
}

// Only fonts with a same-width PDF standard font (Helvetica, Times, Courier), so text lands in the
// same place in the PDF as in the preview — see pdf/fonts.ts. A template that already uses another
// font (Georgia, Verdana) keeps it listed so it isn't silently changed; the PDF substitutes for it.
const FONT_FAMILIES = ['Arial', 'Times New Roman', 'Courier New']
const ALIGN_OPTIONS: Array<{ value: TextElement['align']; labelKey: string; Icon: React.ComponentType<{ size?: number }> }> = [
  { value: 'left', labelKey: 'alignLeft', Icon: TextLeftOutlined },
  { value: 'center', labelKey: 'alignCenter', Icon: TextCenterOutlined },
  { value: 'right', labelKey: 'alignRight', Icon: TextRightOutlined }
]
const VERTICAL_ALIGN_OPTIONS: Array<{ value: NonNullable<TextElement['verticalAlign']>; labelKey: string; Icon: React.ComponentType<{ size?: number }> }> = [
  { value: 'top', labelKey: 'alignTop', Icon: AlignTopOutlined },
  { value: 'middle', labelKey: 'alignMiddle', Icon: AlignVerticalCenterOutlined },
  { value: 'bottom', labelKey: 'alignBottom', Icon: AlignBottomOutlined }
]

const TextProps = (props: TextPropsProps): React.ReactElement => {
  const { element, onChange, viewerMode } = props
  const translate = hooks.useTranslation(defaultMessages)

  return (
    <div>
      <PositionSizeFields element={element} onChange={onChange} />

      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('toolText')}</div>
        <Label size="sm">{translate('content')}</Label>
        <TextArea
          height={70}
          value={element.text}
          onChange={(evt) => { onChange({ text: evt.target.value }) }}
        />

        <div className="mt-2">
          <Label size="sm">{translate('font')}</Label>
          <Select
            size="sm"
            value={element.fontFamily}
            onChange={(_evt, value) => { onChange({ fontFamily: value as string }) }}
          >
            {(FONT_FAMILIES.includes(element.fontFamily) ? FONT_FAMILIES : [...FONT_FAMILIES, element.fontFamily]).map((font) => <Option key={font} value={font}>{font}</Option>)}
          </Select>
        </div>

        <div className="d-flex mt-2" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Label size="sm">{translate('size')}</Label>
            <NumericInput
              size="sm"
              min={1}
              value={element.fontSize}
              onChange={(value) => { if (value !== undefined) onChange({ fontSize: value }) }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Label size="sm">{translate('weight')}</Label>
            <Select
              size="sm"
              value={element.fontWeight}
              onChange={(_evt, value) => { onChange({ fontWeight: Number(value) }) }}
            >
              <Option value={400}>{translate('normal')}</Option>
              <Option value={700}>{translate('bold')}</Option>
            </Select>
          </div>
        </div>

        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('color')}</Label>
          <ColorPicker color={element.color} onChange={(color) => { onChange({ color }) }} />
        </div>

        <div className="d-flex mt-2" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Label size="sm">{translate('horizontalAlign')}</Label>
            <ButtonGroup>
              {ALIGN_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  icon
                  size="sm"
                  title={translate(option.labelKey)}
                  aria-label={translate(option.labelKey)}
                  active={element.align === option.value}
                  onClick={() => { onChange({ align: option.value }) }}
                >
                  <option.Icon size={16} />
                </Button>
              ))}
            </ButtonGroup>
          </div>
          <div style={{ flex: 1 }}>
            <Label size="sm">{translate('verticalAlign')}</Label>
            <ButtonGroup>
              {VERTICAL_ALIGN_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  icon
                  size="sm"
                  title={translate(option.labelKey)}
                  aria-label={translate(option.labelKey)}
                  active={(element.verticalAlign ?? 'middle') === option.value}
                  onClick={() => { onChange({ verticalAlign: option.value }) }}
                >
                  <option.Icon size={16} />
                </Button>
              ))}
            </ButtonGroup>
          </div>
        </div>

        {!viewerMode && (
          <div className="d-flex align-items-center mt-2" style={{ gap: 6 }}>
            <Checkbox
              checked={element.editableAtRuntime ?? false}
              onChange={(_evt, checked) => { onChange({ editableAtRuntime: checked }) }}
            />
            <Label size="sm" style={{ marginBottom: 0 }}>{translate('editableAtRuntime')}</Label>
          </div>
        )}
      </div>

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

export default TextProps
