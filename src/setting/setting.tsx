import { React, Immutable, hooks } from 'jimu-core'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import { MapWidgetSelector, SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Switch } from 'jimu-ui'
import type { IMConfig, Layout } from '../config'
import TemplateManager from './TemplateManager'
import defaultMessages from './setting.messages'

const Setting = (props: AllWidgetSettingProps<IMConfig>) => {
  const translate = hooks.useTranslation(defaultMessages)

  const templates = React.useMemo<Layout[]>(() => {
    return (props.config.templates ?? Immutable([])).asMutable({ deep: true }) as Layout[]
  }, [props.config.templates])

  const onMapWidgetSelected = (useMapWidgetIds: string[]): void => {
    props.onSettingChange({ id: props.widgetId, useMapWidgetIds })
  }

  const onTemplatesChange = (updated: Layout[]): void => {
    const newConfig = props.config.set('templates', Immutable(updated))
    props.onSettingChange({ id: props.widgetId, config: newConfig })
  }

  const onAllowViewerLayoutEditChange = (_evt: React.ChangeEvent<HTMLInputElement>, checked: boolean): void => {
    // allowViewerAddElements is only meaningful alongside this one (see its own hint below) — turning
    // this off resets it too, rather than leaving a dangling `true` with no effect that could
    // resurface confusingly if this is turned back on later.
    let newConfig = props.config.set('allowViewerLayoutEdit', checked)
    if (!checked) newConfig = newConfig.set('allowViewerAddElements', false)
    props.onSettingChange({ id: props.widgetId, config: newConfig })
  }

  const onAllowViewerAddElementsChange = (_evt: React.ChangeEvent<HTMLInputElement>, checked: boolean): void => {
    const newConfig = props.config.set('allowViewerAddElements', checked)
    props.onSettingChange({ id: props.widgetId, config: newConfig })
  }

  const onAllowViewerCreateTemplatesChange = (_evt: React.ChangeEvent<HTMLInputElement>, checked: boolean): void => {
    props.onSettingChange({ id: props.widgetId, config: props.config.set('allowViewerCreateTemplates', checked) })
  }

  const allowViewerLayoutEdit = props.config.allowViewerLayoutEdit ?? false

  return (
    <div className="widget-setting-print-export">
      <SettingSection title={translate('mapWidget')}>
        <SettingRow>
          <MapWidgetSelector useMapWidgetIds={props.useMapWidgetIds} onSelect={onMapWidgetSelected} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate('templates')}>
        <TemplateManager
          templates={templates}
          onChange={onTemplatesChange}
          useMapWidgetId={props.useMapWidgetIds?.[0]}
        />
      </SettingSection>

      <SettingSection title={translate('options')}>
        <SettingRow label={translate('allowViewerLayoutEdit')} flow="no-wrap">
          <Switch checked={allowViewerLayoutEdit} onChange={onAllowViewerLayoutEditChange} />
        </SettingRow>
        <div className="text-disabled small mb-3">{translate('allowViewerLayoutEditHint')}</div>

        <SettingRow label={translate('allowViewerAddElements')} flow="no-wrap">
          <Switch
            disabled={!allowViewerLayoutEdit}
            checked={props.config.allowViewerAddElements ?? false}
            onChange={onAllowViewerAddElementsChange}
          />
        </SettingRow>
        <div className="text-disabled small" style={{ opacity: allowViewerLayoutEdit ? 1 : 0.5 }}>{translate('allowViewerAddElementsHint')}</div>

        <SettingRow label={translate('allowViewerCreateTemplates')} flow="no-wrap" className="mt-3">
          <Switch checked={props.config.allowViewerCreateTemplates ?? false} onChange={onAllowViewerCreateTemplatesChange} />
        </SettingRow>
        <div className="text-disabled small">{translate('allowViewerCreateTemplatesHint')}</div>
      </SettingSection>
    </div>
  )
}

export default Setting
