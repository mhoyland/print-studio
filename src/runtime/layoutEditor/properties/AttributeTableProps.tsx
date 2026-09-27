import { React, hooks } from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'
import { Label, Select, Option, Checkbox, TextInput, NumericInput } from 'jimu-ui'
import { ColorPicker } from 'jimu-ui/basic/color-picker'
import type { AttributeTableElement } from '../../../config'
import { DEFAULT_FONT_SIZE, DEFAULT_HEADER_FILL } from '../../elementRenderers/renderAttributeTable'
import { getLayerOptions, useLayerFields } from './useLayerFields'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import defaultMessages from '../../../translations/default'

export interface AttributeTablePropsProps {
  element: AttributeTableElement
  onChange: (patch: Partial<AttributeTableElement>) => void
  jimuMapView: JimuMapView | null
}

// Unlike an image's file or a text element's editable-at-runtime toggle, the layer/field picker here
// is left available in the runtime viewer editor too (not gated behind viewerMode) — a viewer
// repointing the table at a different layer or set of fields is exactly the kind of "adjust before I
// print" flexibility that element is for, and it's session-local like every other viewer edit.
const AttributeTableProps = (props: AttributeTablePropsProps): React.ReactElement => {
  const { element, onChange, jimuMapView } = props
  const translate = hooks.useTranslation(defaultMessages)
  const availableFields = useLayerFields(jimuMapView, element.layerId)
  const autoDefaultedLayerIdRef = React.useRef<string | null>(null)

  // Seeds the first 4 fields (with their aliases as header labels) the first time a layer is picked.
  // Guarded by both "fields is still empty" and a per-layerId ref so it never overwrites a selection
  // the designer deliberately cleared back down to zero.
  React.useEffect(() => {
    if (!availableFields || availableFields.length === 0) return
    if (element.fields.length > 0) return
    if (autoDefaultedLayerIdRef.current === element.layerId) return
    autoDefaultedLayerIdRef.current = element.layerId
    const defaults = availableFields.slice(0, 4)
    onChange({
      fields: defaults.map((field) => field.jimuName),
      fieldLabels: Object.fromEntries(defaults.map((field) => [field.jimuName, field.label]))
    })
  }, [availableFields, element.layerId, element.fields.length, onChange])

  const layerOptions = getLayerOptions(jimuMapView)

  const handleLayerChange = (layerId: string): void => {
    // Renames the element from the generic "Attribute table N" to the picked layer's own title —
    // it also feeds the default title line (`title ?? name`), so this is what gets a designer a
    // sensible printed caption without having to type one. Picking a different layer later renames
    // it again, same as the field selection resetting; a manual rename afterward is untouched unless
    // the layer is changed again.
    const layerTitle = layerOptions.find((option) => option.id === layerId)?.title
    onChange({ layerId: layerId || undefined, name: layerTitle ?? element.name, fields: [], fieldLabels: {} })
  }

  const toggleField = (jimuName: string, checked: boolean, alias: string): void => {
    const selected = new Set(element.fields)
    if (checked) selected.add(jimuName)
    else selected.delete(jimuName)
    const orderedFields = (availableFields ?? []).map((field) => field.jimuName).filter((name) => selected.has(name))
    const patch: Partial<AttributeTableElement> = { fields: orderedFields }
    if (checked && !element.fieldLabels?.[jimuName]) {
      patch.fieldLabels = { ...element.fieldLabels, [jimuName]: alias }
    }
    onChange(patch)
  }

  return (
    <div>
      <PositionSizeFields element={element} onChange={onChange} />

      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('dataSectionTitle')}</div>

        <Label size="sm">{translate('layer')}</Label>
        <Select
          size="sm"
          value={element.layerId ?? ''}
          onChange={(_evt, value) => { handleLayerChange(value as string) }}
        >
          <Option value="">{translate('selectALayerEllipsis')}</Option>
          {layerOptions.map((option) => <Option key={option.id} value={option.id}>{option.title}</Option>)}
        </Select>
        <div className="text-disabled small mt-1">{translate('attributeTablePrintHint')}</div>

        {element.layerId && (
          <div className="mt-2">
            <Label size="sm">{translate('fields')}</Label>
            {availableFields === null && <div className="text-disabled small">{translate('loadingFields')}</div>}
            {availableFields?.length === 0 && <div className="text-disabled small">{translate('noFieldsFound')}</div>}
            {availableFields?.map((field) => (
              <div key={field.jimuName} className="d-flex align-items-center mb-1" style={{ gap: 6 }}>
                <Checkbox
                  checked={element.fields.includes(field.jimuName)}
                  onChange={(_evt, checked) => { toggleField(field.jimuName, checked, field.label) }}
                />
                <Label size="sm" style={{ marginBottom: 0 }}>{field.label}</Label>
              </div>
            ))}
          </div>
        )}

        {element.fields.length > 0 && (
          <div className="mt-2">
            <Label size="sm">{translate('columnHeaders')}</Label>
            {element.fields.map((field) => {
              const alias = availableFields?.find((option) => option.jimuName === field)?.label ?? field
              return (
                <div key={field} className="d-flex align-items-center mb-1" style={{ gap: 6 }}>
                  <Label size="sm" style={{ width: 90, marginBottom: 0, flexShrink: 0 }} title={alias}>{alias}</Label>
                  <TextInput
                    size="sm"
                    placeholder={alias}
                    value={element.fieldLabels?.[field] ?? ''}
                    onChange={(evt) => { onChange({ fieldLabels: { ...element.fieldLabels, [field]: evt.target.value } }) }}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      <SectionDivider />
      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('tableStyleSectionTitle')}</div>

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
            placeholder={element.name}
            value={element.title ?? ''}
            onChange={(evt) => { onChange({ title: evt.target.value }) }}
          />
        )}

        <div className="d-flex align-items-center mt-2" style={{ gap: 6 }}>
          <Checkbox
            checked={element.showRowNumbers ?? true}
            onChange={(_evt, checked) => { onChange({ showRowNumbers: checked }) }}
          />
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('showRowNumbers')}</Label>
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

        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('headerFill')}</Label>
          <ColorPicker
            color={element.headerFill ?? DEFAULT_HEADER_FILL}
            onChange={(color) => { onChange({ headerFill: color }) }}
          />
        </div>
        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('headerTextColor')}</Label>
          <ColorPicker
            color={element.headerTextColor ?? '#000000'}
            onChange={(color) => { onChange({ headerTextColor: color }) }}
          />
        </div>
        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('bodyTextColor')}</Label>
          <ColorPicker
            color={element.bodyTextColor ?? '#000000'}
            onChange={(color) => { onChange({ bodyTextColor: color }) }}
          />
        </div>
      </div>

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

export default AttributeTableProps
