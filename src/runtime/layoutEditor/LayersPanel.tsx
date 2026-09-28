import { React, hooks } from 'jimu-core'
import { VisibleOutlined } from 'jimu-icons/outlined/application/visible'
import { InvisibleOutlined } from 'jimu-icons/outlined/application/invisible'
import { LockOutlined } from 'jimu-icons/outlined/editor/lock'
import { UnlockOutlined } from 'jimu-icons/outlined/editor/unlock'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import { UpSmallOutlined } from 'jimu-icons/outlined/directional/up-small'
import { DownSmallOutlined } from 'jimu-icons/outlined/directional/down-small'
import type { LayoutElement } from '../../config'
import type { ArrangeDirection } from './LayoutEditor'
import defaultMessages from '../../translations/default'

export interface LayersPanelProps {
  elements: LayoutElement[]
  selectedElementId: string | null
  onSelect: (elementId: string) => void
  onToggleVisible: (elementId: string) => void
  onToggleLocked: (elementId: string) => void
  onDelete: (elementId: string) => void
  onArrange: (elementId: string, direction: ArrangeDirection) => void
  // Phase 9: in the runtime viewer editor (with allowViewerAddElements on), Arrange/Delete/Lock are
  // only shown for elements the viewer added this session — the designer's originals stay
  // nudge/restyle-only, same protection PropertiesPanel's Delete button already applies. Both
  // undefined at design time, where everything is always fully manageable.
  viewerMode?: boolean
  isOwnElement?: (elementId: string) => boolean
}

const LayersPanel = (props: LayersPanelProps): React.ReactElement => {
  const { elements, selectedElementId, onSelect, onToggleVisible, onToggleLocked, onDelete, onArrange, viewerMode, isOwnElement } = props
  const translate = hooks.useTranslation(defaultMessages)
  // Sorted front-most first, matching a printed stack read top-to-bottom — "move up" in this list
  // means "move forward" (toward the front), one step at a time.
  const sortedElements = [...elements].sort((a, b) => b.zIndex - a.zIndex)

  return (
    <div
      className="print-export-layers-panel"
      style={{ width: 220, borderRight: '1px solid var(--sys-color-divider-primary)', overflowY: 'auto' }}
    >
      <div className="text-disabled px-2 py-2" style={{ fontSize: 11, textTransform: 'uppercase' }}>{translate('layers')}</div>
      {sortedElements.map((element, index) => {
        const isVisible = element.visible ?? true
        const isSelected = element.id === selectedElementId
        // The map frame is always painted first/backmost on export regardless of its stored zIndex
        // (see exportRenderer.ts), so reordering it here wouldn't be reflected in the export — it's
        // excluded from Arrange (and Delete) for that reason, same as before Phase 9. In viewer mode,
        // both are further restricted (along with Lock) to elements the viewer added this session —
        // otherwise a viewer could unlock a designer-locked element via this panel, defeating the
        // whole point of `locked` as a viewer-facing protection.
        const isOwnInViewerMode = !viewerMode || (isOwnElement?.(element.id) ?? false)
        const canArrange = element.type !== 'mapFrame' && isOwnInViewerMode
        const canLock = isOwnInViewerMode
        const isFirst = index === 0
        const isLast = index === sortedElements.length - 1
        return (
          <div
            key={element.id}
            onClick={() => { onSelect(element.id) }}
            className="d-flex align-items-center px-2 py-1"
            style={{
              cursor: 'pointer',
              gap: 4,
              backgroundColor: isSelected ? 'var(--sys-color-action-selected)' : 'transparent',
              // The theme's text colour paired with its selected background, so the name and icons stay
              // readable on a dark selection colour (they inherit it via currentColor).
              color: isSelected ? 'var(--sys-color-action-selected-text)' : undefined
            }}
          >
            <IconButton
              label={isVisible ? translate('hide') : translate('show')}
              onClick={() => { onToggleVisible(element.id) }}
            >
              {isVisible ? <VisibleOutlined size={14} /> : <InvisibleOutlined size={14} />}
            </IconButton>
            <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {element.name}
            </span>
            {canArrange && (
              <>
                <IconButton
                  label={translate('moveUp')}
                  disabled={isFirst}
                  onClick={() => { onArrange(element.id, 'forward') }}
                >
                  <UpSmallOutlined size={14} />
                </IconButton>
                <IconButton
                  label={translate('moveDown')}
                  disabled={isLast}
                  onClick={() => { onArrange(element.id, 'backward') }}
                >
                  <DownSmallOutlined size={14} />
                </IconButton>
              </>
            )}
            {canLock && (
              <IconButton
                label={element.locked ? translate('unlock') : translate('lock')}
                faint={!element.locked}
                onClick={() => { onToggleLocked(element.id) }}
              >
                {element.locked ? <LockOutlined size={14} /> : <UnlockOutlined size={14} />}
              </IconButton>
            )}
            {canArrange && (
              <IconButton
                label={isSelected ? translate('delete') : translate('selectToDelete')}
                faint={!isSelected}
                onClick={() => {
                  if (isSelected) onDelete(element.id)
                  else onSelect(element.id)
                }}
              >
                <TrashOutlined size={14} />
              </IconButton>
            )}
          </div>
        )
      })}
    </div>
  )
}

function IconButton (props: { label: string; faint?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  const isInert = props.faint || props.disabled
  return (
    <span
      role="button"
      aria-label={props.label}
      aria-disabled={props.disabled}
      title={props.label}
      onClick={(evt) => {
        evt.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
      style={{
        display: 'inline-flex',
        opacity: isInert ? 0.35 : 1,
        cursor: props.disabled ? 'default' : 'pointer'
      }}
    >
      {props.children}
    </span>
  )
}

export default LayersPanel
