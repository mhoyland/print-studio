import type { ImmutableObject } from 'seamless-immutable'

export interface ElementBase {
  id: string
  name: string
  type: 'mapFrame' | 'text' | 'rect' | 'northArrow' | 'image' | 'scaleBar' | 'legend' | 'attributeTable' | 'popup'
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  locked?: boolean
  visible?: boolean
  strokeColor?: string
  strokeWidth?: number
  cornerRadius?: number
  fill?: { enabled: boolean; color: string }
}

export type TextElement = ElementBase & {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom' // defaults to 'middle' when unset
  editableAtRuntime?: boolean
}

export type RectElement = ElementBase & {
  type: 'rect'
}

export type NorthArrowElement = ElementBase & {
  type: 'northArrow'
  style: 'classic' | 'compass' | 'minimal' | 'compassRose'
  color: string
  rotation: number
  syncToMapRotation: boolean
  mapFrameId?: string
}

export type ImageElement = ElementBase & {
  type: 'image'
  source: 'upload' | 'portalItem'
  url?: string
  portalItemId?: string
  lockAspect: boolean
}

export type ScaleBarElement = ElementBase & {
  type: 'scaleBar'
  unit: 'km' | 'm' | 'mi' | 'ft'
  style: 'line' | 'alternating'
  fontSize?: number // manual text/bar size control, like LegendElement's — see renderScaleBar.ts
  align?: 'left' | 'center' | 'right' // defaults to 'left' when unset — the drawn bar is usually
                                       // narrower than the element's own box (rounded down to a "nice"
                                       // distance), so this decides where that leftover space goes;
                                       // see renderScaleBar.ts's drawSegment
  mapFrameId?: string
}

export type LegendElement = ElementBase & {
  type: 'legend'
  autoFitHeight: boolean
  fontSize?: number // manual text/swatch size control — see renderLegend.ts for why this isn't auto-derived from box size
  showTitle?: boolean // defaults to true
  title?: string // optional override; defaults to the literal word "Legend" when unset (not element.name,
                  // unlike AttributeTableElement/PopupElement) — see renderLegend.ts
  columns?: 1 | 2 | 3 | 4 | 'auto' // defaults to 'auto' (fits as many columns as the box's width/height
                                    // allow) when unset — see renderLegend.ts's paintSwatches
}

export type MapFrameElement = ElementBase & {
  type: 'mapFrame'
  mapWidgetId?: string
}

export type AttributeTableElement = ElementBase & {
  type: 'attributeTable'
  layerId?: string // id of the map's operational layer to query, within the widget's connected map widget
  fields: string[] // jimuFieldNames of the selected columns, in schema order; first 4 are selected by default when a layer is first picked
  fieldLabels?: { [jimuFieldName: string]: string } // optional header overrides — falls back to the field's alias
  fontSize?: number // body row text size — defaults to DEFAULT_FONT_SIZE (see renderAttributeTable.ts)
  headerFill?: string
  headerTextColor?: string
  bodyTextColor?: string
  showTitle?: boolean // defaults to true; prints `${title ?? name} | Total count: N` above the table
  title?: string // optional override for the title line's text; falls back to `name` when unset
  showRowNumbers?: boolean // defaults to true; prints a leading "#" column
}

export type PopupElement = ElementBase & {
  type: 'popup'
  layerId?: string // id of the map's operational layer to query, within the widget's connected map widget
  fields: string[] // jimuFieldNames shown as label/value rows, in order. When a layer is first picked, auto-populated from
                    // that layer's popupTemplate field list (its "fields" content, or its top-level fieldInfos as a
                    // fallback) if it has one; otherwise left empty for manual picking, same field-checklist UI as
                    // AttributeTableElement.
  fieldLabels?: { [jimuFieldName: string]: string } // optional label overrides — falls back to the popup's own field label/alias
  title?: string // optional override for the title line; falls back to the layer's popupTemplate.title (with {field}
                  // placeholders substituted from the shown feature) at render time, then to `name` if the layer has no
                  // popup title either
  fontSize?: number
  titleTextColor?: string
  labelTextColor?: string // the field-label column's text color
  valueTextColor?: string
}
// Only a single feature is ever shown — the first of the layer's currently selected features, per
// feature (not a list of rows like AttributeTableElement). Deliberately scoped to a layer's plain
// "fields" popup content (title + field list): the ArcGIS Maps SDK's popup content model also
// supports media/charts, attachments, Arcade-expression text, and related records, none of which
// have a reasonable static/synchronous equivalent on a print canvas, so those are left unrendered
// rather than attempted.

export type LayoutElement =
  | TextElement | RectElement | NorthArrowElement
  | ImageElement | ScaleBarElement | LegendElement | MapFrameElement | AttributeTableElement | PopupElement

export interface Layout {
  id: string
  name: string
  pageSize: 'letter' | 'tabloid' | 'a4' | 'a3'
  orientation: 'portrait' | 'landscape'
  elements: LayoutElement[]
  portalItemId?: string // Phase 8: set once this template has been saved to Portal at least once, so a later "Save to Portal" updates that same item instead of creating a duplicate
}

export interface Config {
  templates: Layout[] // the designer's curated set of templates — see print-studio-spec.md Phase 7
  allowViewerLayoutEdit?: boolean
  allowViewerAddElements?: boolean // Phase 9: only meaningful when allowViewerLayoutEdit is also on — see setting.tsx
  // Lets viewers make their own templates at runtime (New, or Duplicate of any listed template). They
  // are kept in the viewer's browser alongside imported templates, and are fully editable by them.
  allowViewerCreateTemplates?: boolean
  hideOnExport?: {
    legend?: boolean
    northArrow?: boolean
    scaleBar?: boolean
  }
  // Print scale and PDF map resolution (Phase 14) are chosen by the viewer at runtime, in the widget's
  // Advanced section, so they aren't stored here.
}

export type IMConfig = ImmutableObject<Config>
