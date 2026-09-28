import { React, hooks } from 'jimu-core'
import { Button } from 'jimu-ui'
import { TextPageOutlined } from 'jimu-icons/outlined/data/text-page'
import { RectangleOutlined } from 'jimu-icons/outlined/gis/rectangle'
import { ArrowUpOutlined } from 'jimu-icons/outlined/directional/arrow-up'
import { ImageOutlined } from 'jimu-icons/outlined/data/image'
import { MeasureOutlined } from 'jimu-icons/outlined/gis/measure'
import { WidgetLegendOutlined } from 'jimu-icons/outlined/brand/widget-legend'
import { TableOutlined } from 'jimu-icons/outlined/data/table'
import { WidgetFeatureInfoOutlined } from 'jimu-icons/outlined/brand/widget-feature-info'
import { MapViewOutlined } from 'jimu-icons/outlined/gis/map-view'
import type { LayoutElement } from '../../config'
import defaultMessages from '../../translations/default'

export type AddableElementType = Exclude<LayoutElement['type'], 'mapFrame'>

interface ToolDefinition {
  type: LayoutElement['type']
  labelKey: string
  Icon: React.ComponentType<{ size?: number }>
  addable: boolean
}

const TOOLS: ToolDefinition[] = [
  { type: 'text', labelKey: 'toolText', Icon: TextPageOutlined, addable: true },
  { type: 'rect', labelKey: 'toolRectangle', Icon: RectangleOutlined, addable: true },
  { type: 'image', labelKey: 'toolImage', Icon: ImageOutlined, addable: true },
  { type: 'popup', labelKey: 'toolPopup', Icon: WidgetFeatureInfoOutlined, addable: true },
  { type: 'attributeTable', labelKey: 'toolTable', Icon: TableOutlined, addable: true },
  { type: 'northArrow', labelKey: 'toolNorthPoint', Icon: ArrowUpOutlined, addable: true },
  { type: 'scaleBar', labelKey: 'toolScaleBar', Icon: MeasureOutlined, addable: true },
  { type: 'legend', labelKey: 'toolLegend', Icon: WidgetLegendOutlined, addable: true },
  // A layout has exactly one map frame until Phase 11 (multiple bound maps) — the tool stays
  // visible for shell completeness but doesn't add a second one.
  { type: 'mapFrame', labelKey: 'toolMap', Icon: MapViewOutlined, addable: false }
]

export interface ToolbarProps {
  pendingElementType: AddableElementType | null
  onSelectTool: (type: AddableElementType) => void
}

// Clicking a tool arms placement mode (Canvas shows a crosshair and lets the designer click or
// drag to place/draw the new element) rather than adding it immediately at a default spot.
const Toolbar = (props: ToolbarProps): React.ReactElement => {
  const { pendingElementType, onSelectTool } = props
  const translate = hooks.useTranslation(defaultMessages)

  return (
    <div
      className="print-export-toolbar d-flex flex-column align-items-center py-2"
      style={{ width: 80, borderRight: '1px solid var(--sys-color-divider-primary)' }}
    >
      {TOOLS.map(({ type, labelKey, Icon, addable }) => {
        const isPending = addable && type === pendingElementType
        const label = translate(labelKey)
        return (
          <Button
            key={type}
            variant="text"
            vertical
            disabled={!addable}
            title={addable ? translate('placeElement', { label: label.toLowerCase() }) : label}
            aria-label={addable ? translate('placeElement', { label: label.toLowerCase() }) : label}
            style={{
              height: 56,
              width: 72,
              marginBottom: 4,
              backgroundColor: isPending ? 'var(--sys-color-action-selected)' : undefined,
              // Paired theme text colour, so the icon and label stay readable on the selected background.
              color: isPending ? 'var(--sys-color-action-selected-text)' : undefined
            }}
            onClick={addable ? () => { onSelectTool(type as AddableElementType) } : undefined}
          >
            <Icon size={20} />
            {/* Forced single-line: the ambient theme's own font metrics decide how tight "North pt"/
                "Scale bar" fit, and under some themes that's tight enough to wrap onto a second line —
                which this fixed-height button then clips rather than growing to fit. Ellipsizing is a
                safety net for a still-tighter theme, not the expected outcome at this width/font-size. */}
            <span style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{label}</span>
          </Button>
        )
      })}
    </div>
  )
}

export default Toolbar
