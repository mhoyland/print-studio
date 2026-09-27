import { React, hooks } from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'
import { Label, TextInput, Button } from 'jimu-ui'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import type { LayoutElement } from '../../config'
import type { ArrangeDirection } from './LayoutEditor'
import defaultMessages from '../../translations/default'
import TextProps from './properties/TextProps'
import RectProps from './properties/RectProps'
import NorthArrowProps from './properties/NorthArrowProps'
import ImageProps from './properties/ImageProps'
import ScaleBarProps from './properties/ScaleBarProps'
import LegendProps from './properties/LegendProps'
import AttributeTableProps from './properties/AttributeTableProps'
import PopupProps from './properties/PopupProps'
import PositionSizeFields from './properties/PositionSizeFields'
import ContainerStyleFields from './properties/ContainerStyleFields'

export interface PropertiesPanelProps {
  element?: LayoutElement
  onChange: (patch: Partial<LayoutElement>) => void
  onArrange: (direction: ArrangeDirection) => void
  onDelete: (elementId: string) => void
  // Only the attribute table's properties panel needs live map access (to list layers/fields) —
  // every other panel is styling-only and works from the element's own stored data.
  jimuMapView: JimuMapView | null
  // The runtime viewer editor shows the same styling fields (text size, color, border, etc.) as the
  // designer. Renaming and the "Editable at runtime" toggle (governs what *other* future viewers can
  // do, not this session) are design-only for the designer's own elements — but both are exposed for
  // elements the viewer added themselves this session (gated on `canManage` below): without a name, a
  // viewer-added text element falls back to its generic default (e.g. "Text 1") as the label shown
  // above its editable field in widget.tsx, which isn't meaningful once exported and re-imported into a
  // later session; without the runtime-editable flag, it wouldn't show up as an editable field at all.
  // Locked elements aren't selectable at all in viewer mode (see ElementWrapper's `interactive`), so
  // this only ever renders for something the viewer is actually allowed to touch.
  viewerMode: boolean
  // Phase 9: whether the *currently selected* element is one the viewer is allowed to delete/reorder/
  // replace-the-file-of — always true at design time; in viewer mode, only true for elements the
  // viewer added this session (see LayoutEditor's isOwnElement). Gates Delete here, and is threaded
  // into RectProps' Arrange section and ImageProps' upload controls (replacing their old blanket
  // `!viewerMode` checks) so a viewer-added element is actually usable — e.g. a freshly added image
  // element needs *some* way to pick its file.
  isOwnElement: (elementId: string) => boolean
}

// Dispatches to the per-type panel based on element.type. Each panel is responsible for its own
// type-specific fields; Position & size and border/fill are shared, so panels compose them directly
// rather than duplicating the same markup six times.
const PropertiesPanel = (props: PropertiesPanelProps): React.ReactElement => {
  const { element, onChange, onArrange, onDelete, viewerMode, jimuMapView, isOwnElement } = props
  const translate = hooks.useTranslation(defaultMessages)

  if (!element) {
    return (
      <div className="text-disabled p-3" style={{ fontSize: 13 }}>
        {translate('selectElementPrompt')}
      </div>
    )
  }

  const canManage = !viewerMode || isOwnElement(element.id)

  return (
    <div className="p-3" style={{ fontSize: 13 }}>
      <div className="d-flex align-items-end mb-3" style={{ gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Label size="sm">{translate('name')}</Label>
          {canManage
            ? (
              <TextInput
                size="sm"
                value={element.name}
                onChange={(evt) => { onChange({ name: evt.target.value }) }}
              />
              )
            : (
              <div style={{ fontWeight: 600 }}>{element.name}</div>
              )}
        </div>
        {/* The runtime editor has its own dedicated full-width Delete button below (viewer-owned
            elements only) — this icon-button form is design-time only, so the two never both show. */}
        {!viewerMode && element.type !== 'mapFrame' && (
          <Button
            icon
            size="sm"
            type="tertiary"
            title={translate('deleteElement')}
            aria-label={translate('deleteElement')}
            onClick={() => { onDelete(element.id) }}
          >
            <TrashOutlined size={16} />
          </Button>
        )}
      </div>
      {canManage && viewerMode && element.type !== 'mapFrame' && (
        <Button
          block
          size="sm"
          type="tertiary"
          className="mb-3"
          title={translate('deleteElement')}
          aria-label={translate('deleteElement')}
          onClick={() => { onDelete(element.id) }}
        >
          <TrashOutlined size={14} className="mr-1" />
          {translate('delete')}
        </Button>
      )}
      {renderTypeProps(element, onChange, onArrange, viewerMode, jimuMapView, canManage)}
    </div>
  )
}

function renderTypeProps (
  element: LayoutElement,
  onChange: (patch: Partial<LayoutElement>) => void,
  onArrange: (direction: ArrangeDirection) => void,
  viewerMode: boolean,
  jimuMapView: JimuMapView | null,
  canManage: boolean
): React.ReactElement {
  switch (element.type) {
    case 'text':
      // Same as RectProps/ImageProps: `!canManage` rather than the raw `viewerMode` flag, so a viewer-
      // added text element (this session, with allowViewerAddElements on) can still have its own
      // "Editable at runtime" flag set — needed for that flag to survive an export/re-import of a
      // viewer's own custom template into a later session, where it drives whether the text shows up
      // as an editable field at all (see widget.tsx's editableTextElements). The designer's original
      // text elements stay protected, same as before — that toggle is still design-only for those.
      return <TextProps element={element} onChange={onChange} viewerMode={!canManage} />
    case 'rect':
      return <RectProps element={element} onChange={onChange} onArrange={onArrange} viewerMode={!canManage} />
    case 'northArrow':
      return <NorthArrowProps element={element} onChange={onChange} />
    case 'image':
      return <ImageProps element={element} onChange={onChange} viewerMode={!canManage} />
    case 'scaleBar':
      return <ScaleBarProps element={element} onChange={onChange} />
    case 'legend':
      return <LegendProps element={element} onChange={onChange} />
    case 'attributeTable':
      return <AttributeTableProps element={element} onChange={onChange} jimuMapView={jimuMapView} />
    case 'popup':
      return <PopupProps element={element} onChange={onChange} jimuMapView={jimuMapView} />
    case 'mapFrame':
      // No mapFrame-specific fields until Phase 11 (multi-map binding) — position/size and
      // container styling still apply, so fall back to the shared fields alone.
      return (
        <div>
          <PositionSizeFields element={element} onChange={onChange} />
          <ContainerStyleFields element={element} onChange={onChange} />
        </div>
      )
  }
}

export default PropertiesPanel
