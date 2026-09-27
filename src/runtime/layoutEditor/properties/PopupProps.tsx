import { React, hooks } from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'
import { Label, Select, Option, Checkbox, TextInput, NumericInput } from 'jimu-ui'
import { ColorPicker } from 'jimu-ui/basic/color-picker'
import type { PopupElement } from '../../../config'
import { DEFAULT_FONT_SIZE } from '../../elementRenderers/renderPopup'
import { getLayerOptions, useLayerFields, type FieldOption } from './useLayerFields'
import PositionSizeFields from './PositionSizeFields'
import ContainerStyleFields from './ContainerStyleFields'
import SectionDivider from './SectionDivider'
import defaultMessages from '../../../translations/default'

export interface PopupPropsProps {
  element: PopupElement
  onChange: (patch: Partial<PopupElement>) => void
  jimuMapView: JimuMapView | null
}

// Available in the runtime viewer editor too, same reasoning as AttributeTableProps — repointing the
// card at a different layer or field is "adjust before I print" flexibility, and it's session-local.
const PopupProps = (props: PopupPropsProps): React.ReactElement => {
  const { element, onChange, jimuMapView } = props
  const translate = hooks.useTranslation(defaultMessages)
  const availableFields = useLayerFields(jimuMapView, element.layerId)
  const autoDefaultedLayerIdRef = React.useRef<string | null>(null)

  // Seeds the field list from the layer's own popupTemplate the first time a layer is picked — its
  // "fields" content (or the older top-level fieldInfos, as a fallback) is exactly what the ArcGIS
  // popup would show for this feature, filtered to plain field references (relationship/Arcade-derived
  // ones are skipped — see PopupElement's comment in config.ts for why). If the layer's popup isn't
  // configured with a plain field list at all, this simply finds nothing and leaves `fields` empty, so
  // the checklist below is exactly how the designer builds the card by hand instead.
  React.useEffect(() => {
    if (!availableFields || availableFields.length === 0) return
    if (element.fields.length > 0) return
    if (autoDefaultedLayerIdRef.current === element.layerId) return
    autoDefaultedLayerIdRef.current = element.layerId
    const layer = jimuMapView?.getAllJimuLayerViews().find((view) => view.layer?.id === element.layerId)?.layer
    const popupDefaults = extractPopupFieldDefaults(layer, availableFields)
    if (popupDefaults.length === 0) return
    onChange({
      fields: popupDefaults.map((field) => field.jimuName),
      fieldLabels: Object.fromEntries(popupDefaults.map((field) => [field.jimuName, field.label]))
    })
  }, [availableFields, element.layerId, element.fields.length, onChange, jimuMapView])

  const layerOptions = getLayerOptions(jimuMapView)
  const pickedLayer = jimuMapView?.getAllJimuLayerViews().find((view) => view.layer?.id === element.layerId)?.layer as any
  const popupTitleTemplate: string | undefined = pickedLayer?.popupTemplate?.title

  const handleLayerChange = (layerId: string): void => {
    const layerTitle = layerOptions.find((option) => option.id === layerId)?.title
    onChange({ layerId: layerId || undefined, name: layerTitle ?? element.name, fields: [], fieldLabels: {} })
  }

  const toggleField = (jimuName: string, checked: boolean, alias: string): void => {
    const selected = new Set(element.fields)
    if (checked) selected.add(jimuName)
    else selected.delete(jimuName)
    const orderedFields = (availableFields ?? []).map((field) => field.jimuName).filter((name) => selected.has(name))
    const patch: Partial<PopupElement> = { fields: orderedFields }
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
        <div className="text-disabled small mt-1">{translate('popupPrintHint')}</div>

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
            <Label size="sm">{translate('fieldLabels')}</Label>
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

        <div className="mt-2">
          <Label size="sm">{translate('title')}</Label>
          <TextInput
            size="sm"
            placeholder={popupTitleTemplate ?? element.name}
            value={element.title ?? ''}
            onChange={(evt) => { onChange({ title: evt.target.value }) }}
          />
          <div className="text-disabled small mt-1">
            {popupTitleTemplate
              ? translate('popupTitleHintWithTemplate', { placeholder: '{field}' })
              : translate('popupTitleHintNoTemplate', { placeholder: '{fieldName}' })}
          </div>
        </div>
      </div>

      <SectionDivider />
      <div className="mb-3">
        <div className="text-disabled mb-1" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('cardStyleSectionTitle')}</div>

        <Label size="sm">{translate('fontSize')}</Label>
        <NumericInput
          size="sm"
          min={4}
          max={72}
          value={element.fontSize ?? DEFAULT_FONT_SIZE}
          onChange={(value) => { if (value !== undefined) onChange({ fontSize: value }) }}
        />

        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('titleColor')}</Label>
          <ColorPicker
            color={element.titleTextColor ?? '#000000'}
            onChange={(color) => { onChange({ titleTextColor: color }) }}
          />
        </div>
        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('labelColor')}</Label>
          <ColorPicker
            color={element.labelTextColor ?? '#6e6e6e'}
            onChange={(color) => { onChange({ labelTextColor: color }) }}
          />
        </div>
        <div className="d-flex align-items-center justify-content-between mt-2">
          <Label size="sm" style={{ marginBottom: 0 }}>{translate('valueColor')}</Label>
          <ColorPicker
            color={element.valueTextColor ?? '#000000'}
            onChange={(color) => { onChange({ valueTextColor: color }) }}
          />
        </div>
      </div>

      <SectionDivider />
      <ContainerStyleFields element={element} onChange={onChange} />
    </div>
  )
}

// Reads whatever a layer's own popupTemplate configured as its plain field list — the "fields"
// content element takes precedence (matching how the real ArcGIS popup resolves it), falling back to
// the older top-level fieldInfos. Relationship- and Arcade-expression-derived field names
// ("relationships/…", "expression/…") are skipped, since neither has a reasonable value to show
// without actually evaluating them, which this element doesn't attempt (see config.ts).
function extractPopupFieldDefaults (layer: any, availableFields: FieldOption[]): Array<{ jimuName: string; label: string }> {
  const popupTemplate = layer?.popupTemplate
  if (!popupTemplate) return []
  const content = popupTemplate.content
  const fieldsContent = Array.isArray(content) ? content.find((item: any) => item?.type === 'fields') : undefined
  const fieldInfos: any[] = fieldsContent?.fieldInfos ?? popupTemplate.fieldInfos ?? []

  const fieldByRawName = new Map(availableFields.map((field) => [field.name, field]))
  const result: Array<{ jimuName: string; label: string }> = []
  for (const info of fieldInfos) {
    if (info?.visible === false) continue
    const rawName: string | undefined = info?.fieldName
    if (!rawName || rawName.startsWith('relationships/') || rawName.startsWith('expression/')) continue
    const field = fieldByRawName.get(rawName)
    if (!field) continue
    result.push({ jimuName: field.jimuName, label: info.label || field.label })
  }
  return result
}

export default PopupProps
