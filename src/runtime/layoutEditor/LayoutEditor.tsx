import { React, hooks } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'
import { Modal, ModalBody, Button, TextInput, Select, Option } from 'jimu-ui'
import { CloseOutlined } from 'jimu-icons/outlined/editor/close'
import { ArrowUndoOutlined } from 'jimu-icons/outlined/directional/arrow-undo'
import { ArrowRedoOutlined } from 'jimu-icons/outlined/directional/arrow-redo'
import type { Layout, LayoutElement } from '../../config'
import Toolbar, { type AddableElementType } from './Toolbar'
import LayersPanel from './LayersPanel'
import Canvas from './Canvas'
import PropertiesPanel from './PropertiesPanel'
import type { ElementBounds } from './ElementWrapper'
import { createDefaultElement } from './elementDefaults'
import { useLayoutHistory } from './useLayoutHistory'
import defaultMessages from '../../translations/default'

export interface LayoutEditorProps {
  isOpen: boolean
  layout: Layout
  useMapWidgetId?: string
  // Phase 14: the print scale in effect (undefined for the current view), for the scale bar preview.
  printScale?: number
  onClose: () => void
  onSave: (layout: Layout) => void
  // The runtime viewer editor (opened from widget.tsx when WidgetConfig.allowViewerLayoutEdit is on)
  // reuses this same component rather than a second one. It hides the Toolbar, Layers panel, and
  // every header control except Close/Undo/Redo/Apply, and locked elements stop being
  // interactive/selectable (see Canvas's `interactive` prop). Its `onSave` is session-local — it
  // updates the runtime widget's own React state, never the widget's config.
  viewerMode?: boolean
  // Phase 9: only meaningful when viewerMode is also true (WidgetConfig.allowViewerAddElements).
  // Shows the Toolbar and Layers panel in viewer mode too, and lets a viewer delete/reorder elements
  // they added this session — but never the designer's original elements, identified via
  // `originalElementIds` (required whenever this is true).
  allowAddElements?: boolean
  originalElementIds?: Set<string>
  // Only meaningful with viewerMode: a template the viewer made themselves (WidgetConfig.
  // allowViewerCreateTemplates). Every element is theirs — movable even if locked, deletable,
  // reorderable — and page size and orientation can be changed, as at design time.
  ownTemplate?: boolean
}

export type ArrangeDirection = 'front' | 'forward' | 'backward' | 'back'

const EMPTY_ID_SET = new Set<string>()

const PAGE_SIZE_OPTIONS: Array<{ value: Layout['pageSize']; labelKey: string }> = [
  { value: 'letter', labelKey: 'pageSizeLetter' },
  { value: 'tabloid', labelKey: 'pageSizeTabloid' },
  { value: 'a4', labelKey: 'pageSizeA4' },
  { value: 'a3', labelKey: 'pageSizeA3' }
]

// `className` reaches .modal-dialog (the sizing wrapper); `contentClassName` reaches .modal-content
// (the inner card). jimu-ui's own theme styles it as `&.modal-dialog { max-width: 500px }` via emotion,
// which compiles to a two-class compound selector — higher specificity than a plain single-class
// override, so it wins the cascade regardless of DOM order unless we use !important here too.
const MODAL_STYLE = `
  .print-export-layout-editor-dialog { width: 96vw !important; max-width: 96vw !important; margin: 4vh auto !important; }
  .print-export-layout-editor-content { height: 92vh !important; }
`

// Elements are draggable/resizable (ElementWrapper, via interact.js) and addable from the toolbar for
// every type except mapFrame (a layout has exactly one map frame until Phase 11). This component only
// ever edits a single Layout at a time — template-level actions (add/duplicate/delete/save-to-file/
// load-from-file/Portal) live one level up, in TemplateManager.tsx (design time) and TemplatePicker.tsx
// (runtime). Save here just hands the edited Layout back via onSave — the widget's own config
// (design-time, written into templates[i]) or the runtime widget's session state (viewerMode) — see
// LayoutEditorProps.viewerMode.
const LayoutEditor = (props: LayoutEditorProps): React.ReactElement => {
  const { isOpen, layout: initialLayout, useMapWidgetId, printScale, onClose, onSave, viewerMode = false, allowAddElements = false, originalElementIds, ownTemplate = false } = props
  const translate = hooks.useTranslation(defaultMessages)
  const ownsTemplate = viewerMode && ownTemplate
  const showToolbarAndLayers = !viewerMode || allowAddElements || ownsTemplate
  // An element the viewer can freely delete/reorder — always true at design time; in viewer mode,
  // only true for elements added this session (outside the designer's original set). `mapFrame` is
  // excluded separately wherever this is used, same as before Phase 9.
  const isOwnElement = React.useCallback((elementId: string): boolean => {
    return !viewerMode || ownsTemplate || !(originalElementIds ?? EMPTY_ID_SET).has(elementId)
  }, [viewerMode, ownsTemplate, originalElementIds])
  const history = useLayoutHistory<Layout>(initialLayout)
  const layout = history.value
  const [selectedElementId, setSelectedElementId] = React.useState<string | null>(null)
  const [jimuMapView, setJimuMapView] = React.useState<JimuMapView>(null)
  const [pendingElementType, setPendingElementType] = React.useState<AddableElementType | null>(null)

  const resetHistory = history.reset
  React.useEffect(() => {
    if (isOpen) {
      resetHistory(initialLayout)
      setSelectedElementId(null)
      setPendingElementType(null)
    }
  }, [isOpen, initialLayout, resetHistory])

  // Cancel an in-progress placement without completing it.
  React.useEffect(() => {
    if (!pendingElementType) return
    const onKeyDown = (evt: KeyboardEvent): void => { if (evt.key === 'Escape') setPendingElementType(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [pendingElementType])

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo — skipped while focus is inside a text
  // field so it doesn't hijack the browser's own native undo for whatever's being typed there.
  const undo = history.undo
  const redo = history.redo
  React.useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (evt: KeyboardEvent): void => {
      const tagName = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tagName === 'input' || tagName === 'textarea') return
      const isUndo = (evt.ctrlKey || evt.metaKey) && !evt.shiftKey && evt.key.toLowerCase() === 'z'
      const isRedo = (evt.ctrlKey || evt.metaKey) && (evt.key.toLowerCase() === 'y' || (evt.shiftKey && evt.key.toLowerCase() === 'z'))
      if (isUndo) { evt.preventDefault(); undo() } else if (isRedo) { evt.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [isOpen, undo, redo])

  const handleSave = (): void => {
    history.commitNow()
    onSave(layout)
    onClose()
  }

  const updateElement = (elementId: string, patch: Partial<LayoutElement>): void => {
    history.update((prev) => mapElement(prev, elementId, (element) => ({ ...element, ...patch }) as LayoutElement))
  }

  const handleElementChange = (elementId: string, bounds: ElementBounds): void => {
    updateElement(elementId, bounds)
  }

  const handlePropertiesChange = (patch: Partial<LayoutElement>): void => {
    if (!selectedElementId) return
    updateElement(selectedElementId, patch)
  }

  const handleToggleVisible = (elementId: string): void => {
    history.update((prev) => mapElement(prev, elementId, (element) => ({ ...element, visible: !(element.visible ?? true) })))
  }

  const handleToggleLocked = (elementId: string): void => {
    history.update((prev) => mapElement(prev, elementId, (element) => ({ ...element, locked: !element.locked })))
  }

  const handleArrangeElement = (elementId: string, direction: ArrangeDirection): void => {
    if (!isOwnElement(elementId)) return
    history.update((prev) => ({ ...prev, elements: reorderElements(prev.elements, elementId, direction) }))
  }

  const handleArrange = (direction: ArrangeDirection): void => {
    if (!selectedElementId) return
    handleArrangeElement(selectedElementId, direction)
  }

  // Clicking a tool arms placement mode rather than immediately adding an element — the designer
  // then clicks or drags directly on the canvas to say where (and how big) it should be. Clicking the
  // same tool again cancels it.
  const handleToolSelect = (type: AddableElementType): void => {
    setPendingElementType((current) => current === type ? null : type)
  }

  const handlePlaceElement = (bounds: ElementBounds): void => {
    if (!pendingElementType) return
    const newElement = createDefaultElement(pendingElementType, layout.elements, bounds)
    history.update((prev) => ({ ...prev, elements: [...prev.elements, newElement] }))
    setSelectedElementId(newElement.id)
    setPendingElementType(null)
  }

  // The map frame is the one element `exportRenderer` requires (it composites the map screenshot
  // into it by type lookup) and can't currently be re-added, so it's protected from deletion. In
  // viewer mode, the designer's original elements are protected too — only ones the viewer added
  // this session (per `isOwnElement`) can be deleted.
  const handleDeleteElement = (elementId: string): void => {
    if (!isOwnElement(elementId)) return
    history.update((prev) => {
      const target = prev.elements.find((element) => element.id === elementId)
      if (!target || target.type === 'mapFrame') return prev
      return { ...prev, elements: prev.elements.filter((element) => element.id !== elementId) }
    })
    setSelectedElementId((current) => current === elementId ? null : current)
  }

  const selectedElement = layout.elements.find((element) => element.id === selectedElementId)

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      backdrop="static"
      className="print-export-layout-editor-dialog"
      contentClassName="print-export-layout-editor-content"
    >
      <style>{MODAL_STYLE}</style>
      <ModalBody className="p-0 d-flex flex-column" style={{ height: '100%' }}>
        {useMapWidgetId && (
          <JimuMapViewComponent useMapWidgetId={useMapWidgetId} onActiveViewChange={setJimuMapView} />
        )}

        <div
          className="d-flex align-items-center px-3 py-2"
          style={{ borderBottom: '1px solid var(--sys-color-divider-primary)', gap: 12, flexShrink: 0 }}
        >
          <Button icon type="tertiary" aria-label={translate('close')} onClick={onClose}>
            <CloseOutlined size={16} />
          </Button>
          <Button
            icon
            type="tertiary"
            disabled={!history.canUndo}
            title={translate('undoTooltip')}
            aria-label={translate('undo')}
            onClick={history.undo}
          >
            <ArrowUndoOutlined size={16} />
          </Button>
          <Button
            icon
            type="tertiary"
            disabled={!history.canRedo}
            title={translate('redoTooltip')}
            aria-label={translate('redo')}
            onClick={history.redo}
          >
            <ArrowRedoOutlined size={16} />
          </Button>
          {/* Renaming stays available at runtime (unlike page size/orientation, still design-only below)
              — without it, a viewer who edits a template, exports it to a file, and re-imports it into a
              fresh session ends up with two identically-named entries (the original and their modified
              copy) with no way to tell them apart in TemplatePicker's list. */}
          <TextInput
            style={{ width: 220 }}
            value={layout.name}
            onChange={(evt) => {
              const name = evt.target.value
              history.update((prev) => ({ ...prev, name }))
            }}
          />
          {(!viewerMode || ownsTemplate) && (
            <>
              <Select
                style={{ width: 200 }}
                value={layout.pageSize}
                onChange={(_evt, value) => {
                  history.update((prev) => ({ ...prev, pageSize: value as Layout['pageSize'] }))
                }}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <Option key={option.value} value={option.value}>{translate(option.labelKey)}</Option>
                ))}
              </Select>
              <Button
                type={layout.orientation === 'portrait' ? 'primary' : 'default'}
                onClick={() => { history.update((prev) => ({ ...prev, orientation: 'portrait' })) }}
              >
                {translate('portrait')}
              </Button>
              <Button
                type={layout.orientation === 'landscape' ? 'primary' : 'default'}
                onClick={() => { history.update((prev) => ({ ...prev, orientation: 'landscape' })) }}
              >
                {translate('landscape')}
              </Button>
            </>
          )}

          <div style={{ flex: 1 }} />

          <Button type="primary" onClick={handleSave}>{viewerMode ? translate('apply') : translate('saveLayout')}</Button>
        </div>

        <div className="d-flex" style={{ flex: 1, minHeight: 0 }}>
          {showToolbarAndLayers && <Toolbar pendingElementType={pendingElementType} onSelectTool={handleToolSelect} />}
          {showToolbarAndLayers && (
            <LayersPanel
              elements={layout.elements}
              selectedElementId={selectedElementId}
              onSelect={setSelectedElementId}
              onToggleVisible={handleToggleVisible}
              onToggleLocked={handleToggleLocked}
              onDelete={handleDeleteElement}
              onArrange={handleArrangeElement}
              viewerMode={viewerMode}
              isOwnElement={isOwnElement}
            />
          )}
          <Canvas
            layout={layout}
            view={jimuMapView?.view}
            printScale={printScale}
            isOwnElement={isOwnElement}
            selectedElementId={selectedElementId}
            onSelect={setSelectedElementId}
            onElementChange={handleElementChange}
            pendingElementType={pendingElementType}
            onPlaceElement={handlePlaceElement}
            viewerMode={viewerMode}
          />
          <div style={{ width: 260, borderLeft: '1px solid var(--sys-color-divider-primary)', flexShrink: 0, overflowY: 'auto' }}>
            <PropertiesPanel
              element={selectedElement}
              onChange={handlePropertiesChange}
              onArrange={handleArrange}
              onDelete={handleDeleteElement}
              viewerMode={viewerMode}
              jimuMapView={jimuMapView}
              isOwnElement={isOwnElement}
            />
          </div>
        </div>
      </ModalBody>
    </Modal>
  )
}

function mapElement (layout: Layout, elementId: string, updater: (element: LayoutElement) => LayoutElement): Layout {
  return { ...layout, elements: layout.elements.map((element) => element.id === elementId ? updater(element) : element) }
}

// zIndex/array order must stay in sync (per config.ts) — reordering the array and reassigning
// sequential zIndex values together keeps that invariant.
function reorderElements (elements: LayoutElement[], elementId: string, direction: ArrangeDirection): LayoutElement[] {
  const ordered = [...elements].sort((a, b) => a.zIndex - b.zIndex)
  const fromIndex = ordered.findIndex((element) => element.id === elementId)
  if (fromIndex === -1) return elements

  const [item] = ordered.splice(fromIndex, 1)
  const toIndex = {
    front: ordered.length,
    back: 0,
    forward: Math.min(ordered.length, fromIndex + 1),
    backward: Math.max(0, fromIndex - 1)
  }[direction]
  ordered.splice(toIndex, 0, item)

  return ordered.map((element, index) => ({ ...element, zIndex: index }))
}

export default LayoutEditor
