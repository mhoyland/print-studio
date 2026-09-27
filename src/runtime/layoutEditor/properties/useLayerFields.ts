import { React } from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'

export interface FieldOption { jimuName: string; name: string; label: string }
export interface LayerOption { id: string; title: string }

// Shared by AttributeTableProps and PopupProps, both of which need "pick one of the connected map's
// feature layers" — not a hook itself (no state/effect involved), just a plain live read.
export function getLayerOptions (jimuMapView: JimuMapView | null): LayerOption[] {
  return (jimuMapView?.getAllJimuLayerViews() ?? [])
    .filter((view) => view.layer?.type === 'feature')
    .map((view) => ({ id: view.layer.id as string, title: (view.layer.title || view.layer.id) as string }))
}

// Fetches the picked layer's field schema — used for a field checklist, and (for PopupProps) to map
// a popupTemplate's raw field names back to jimuFieldNames. Returns null while loading or when no
// layer is picked, or an empty array if the layer genuinely has no fields.
export function useLayerFields (jimuMapView: JimuMapView | null, layerId: string | undefined): FieldOption[] | null {
  const [fields, setFields] = React.useState<FieldOption[] | null>(null)

  React.useEffect(() => {
    setFields(null)
    if (!jimuMapView || !layerId) return
    let cancelled = false
    const jimuLayerView = jimuMapView.getAllJimuLayerViews().find((view) => view.layer?.id === layerId)
    if (!jimuLayerView) return
    jimuLayerView.getOrCreateLayerDataSource()
      .then((dataSource) => {
        if (cancelled) return
        const schemaFields = dataSource.getSchema()?.fields ?? {}
        const options = Object.values(schemaFields).map((field: any) => ({
          jimuName: field.jimuName as string,
          name: field.name as string,
          label: (field.alias || field.name) as string
        }))
        setFields(options)
      })
      .catch(() => { if (!cancelled) setFields([]) })
    return () => { cancelled = true }
  }, [jimuMapView, layerId])

  return fields
}
