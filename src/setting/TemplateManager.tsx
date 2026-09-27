import { React, hooks } from 'jimu-core'
import { Button } from 'jimu-ui'
import { PlusOutlined } from 'jimu-icons/outlined/editor/plus'
import { EditOutlined } from 'jimu-icons/outlined/editor/edit'
import { DuplicateOutlined } from 'jimu-icons/outlined/editor/duplicate'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import { ExportOutlined } from 'jimu-icons/outlined/editor/export'
import { ImportOutlined } from 'jimu-icons/outlined/editor/import'
import { ShareOutlined } from 'jimu-icons/outlined/application/share'
import { DownloadOutlined } from 'jimu-icons/outlined/editor/download'
import { CheckOutlined } from 'jimu-icons/outlined/application/check'
import type { Layout } from '../config'
import LayoutEditor from '../runtime/layoutEditor/LayoutEditor'
import { createBlankLayout } from '../runtime/templateFactory'
import { exportTemplateToFile, importTemplateFromFile } from '../runtime/templateStore.local'
import { savePortalTemplate } from '../runtime/templateStore.portal'
import PortalTemplatePicker from './PortalTemplatePicker'
import defaultMessages from './setting.messages'

export interface TemplateManagerProps {
  templates: Layout[]
  onChange: (templates: Layout[]) => void
  useMapWidgetId?: string
}

const PAGE_SIZE_LABELS: { [size in Layout['pageSize']]: string } = {
  letter: 'Letter',
  tabloid: 'Tabloid',
  a4: 'A4',
  a3: 'A3'
}

// The one entry point for template-level actions (add/duplicate/delete/edit/export/import) — the
// Layout Editor's own header used to have disabled "Load template…"/"Save as template" stubs, removed
// once this existed, per the single-entry-point preference already set in Phase 5's page-size/
// orientation descope note.
const TemplateManager = (props: TemplateManagerProps): React.ReactElement => {
  const { templates, onChange, useMapWidgetId } = props
  const translate = hooks.useTranslation(defaultMessages)
  // Holds the actual Layout being edited, not an index into `templates` — `onChange` round-trips
  // through Experience Builder's settings store before the new `templates` prop actually arrives, so
  // an index picked from the pre-onChange array (e.g. `templates.length` right after appending a new
  // one) can point past the end of the array for a render or two, crashing the editor on `undefined`.
  // Holding the Layout itself sidesteps that race entirely; saving matches it back by `id`.
  const [editingTemplate, setEditingTemplate] = React.useState<Layout | null>(null)
  const [importError, setImportError] = React.useState<string | null>(null)
  // Deleting a template has no undo, unlike deleting an element inside the editor (which the Layout
  // Editor's own history covers) — native confirm()/alert() dialogs are disallowed in this codebase
  // (see the no-alert lint rule), so a template's delete button instead arms on the first click and
  // only actually deletes on a second click on that same row, resetting if anything else is clicked.
  const [confirmDeleteIndex, setConfirmDeleteIndex] = React.useState<number | null>(null)
  const armedDeleteRef = React.useRef<HTMLSpanElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [savingPortalIndex, setSavingPortalIndex] = React.useState<number | null>(null)
  const [portalError, setPortalError] = React.useState<string | null>(null)
  const [isPortalPickerOpen, setIsPortalPickerOpen] = React.useState(false)
  // Briefly swaps the Save-to-Portal button for a checkmark on success — the save itself gave no
  // visible feedback otherwise, leaving no way to tell it actually happened short of checking
  // ArcGIS Online directly.
  const [savedPortalIndex, setSavedPortalIndex] = React.useState<number | null>(null)
  const savedPortalTimeoutRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => { if (savedPortalTimeoutRef.current) window.clearTimeout(savedPortalTimeoutRef.current) }
  }, [])

  // Clicking anywhere other than the armed delete button itself un-arms it — otherwise it stayed
  // "Confirm delete?" indefinitely once armed, since nothing but a second click on that same button
  // ever reset it.
  React.useEffect(() => {
    if (confirmDeleteIndex === null) return
    const onPointerDown = (evt: MouseEvent): void => {
      if (armedDeleteRef.current?.contains(evt.target as Node)) return
      setConfirmDeleteIndex(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [confirmDeleteIndex])

  const handleAdd = (): void => {
    const newLayout = createBlankLayout(`Template ${templates.length + 1}`, { mapFrameLocked: true })
    onChange([...templates, newLayout])
    setEditingTemplate(newLayout)
  }

  const handleDuplicate = (index: number): void => {
    const source = templates[index]
    const copy: Layout = { ...source, id: crypto.randomUUID(), name: `${source.name} copy` }
    onChange([...templates.slice(0, index + 1), copy, ...templates.slice(index + 1)])
  }

  const handleDeleteClick = (index: number): void => {
    if (confirmDeleteIndex !== index) {
      setConfirmDeleteIndex(index)
      return
    }
    setConfirmDeleteIndex(null)
    onChange(templates.filter((_template, i) => i !== index))
  }

  const handleImportFile = async (evt: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = evt.target.files?.[0]
    evt.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const layout = await importTemplateFromFile(file)
      onChange([...templates, layout])
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleEditorSave = (updated: Layout): void => {
    if (!editingTemplate) return
    onChange(templates.map((template) => (template.id === editingTemplate.id ? updated : template)))
    setEditingTemplate(null)
  }

  // Creates a Portal item the first time, then updates that same item on every later save for this
  // template (tracked via Layout.portalItemId — see templateStore.portal.ts) — the id it comes back
  // with is written into the template here so the *next* save updates instead of duplicating.
  const handleSaveToPortal = async (index: number): Promise<void> => {
    setSavingPortalIndex(index)
    setPortalError(null)
    try {
      const portalItemId = await savePortalTemplate(templates[index])
      onChange(templates.map((template, i) => (i === index ? { ...template, portalItemId } : template)))
      setSavedPortalIndex(index)
      if (savedPortalTimeoutRef.current) window.clearTimeout(savedPortalTimeoutRef.current)
      savedPortalTimeoutRef.current = window.setTimeout(() => { setSavedPortalIndex(null) }, 2500)
    } catch (error) {
      setPortalError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingPortalIndex(null)
    }
  }

  const handlePortalLoad = (layout: Layout): void => {
    onChange([...templates, layout])
  }

  return (
    <div>
      {templates.length === 0 && <div className="text-disabled small mb-2">{translate('noTemplatesYet')}</div>}

      {templates.map((template, index) => (
        <div key={template.id} className="d-flex align-items-center mb-2" style={{ gap: 4 }}>
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="text-truncate">{template.name}</div>
            <div className="text-disabled" style={{ fontSize: 11 }}>
              {PAGE_SIZE_LABELS[template.pageSize]} · {template.orientation}
            </div>
          </div>
          <Button icon size="sm" type="tertiary" title={translate('edit')} aria-label={translate('edit')} onClick={() => { setConfirmDeleteIndex(null); setEditingTemplate(template) }}>
            <EditOutlined size={14} />
          </Button>
          <Button icon size="sm" type="tertiary" title={translate('duplicate')} aria-label={translate('duplicate')} onClick={() => { setConfirmDeleteIndex(null); handleDuplicate(index) }}>
            <DuplicateOutlined size={14} />
          </Button>
          <Button icon size="sm" type="tertiary" title={translate('exportToFile')} aria-label={translate('exportToFile')} onClick={() => { setConfirmDeleteIndex(null); exportTemplateToFile(template) }}>
            <ExportOutlined size={14} />
          </Button>
          <Button
            icon
            size="sm"
            type="tertiary"
            disabled={savingPortalIndex === index}
            title={savedPortalIndex === index ? translate('savedToPortal') : (template.portalItemId ? translate('updateOnPortal') : translate('saveToPortal'))}
            aria-label={savedPortalIndex === index ? translate('savedToPortal') : (template.portalItemId ? translate('updateOnPortal') : translate('saveToPortal'))}
            onClick={() => { setConfirmDeleteIndex(null); void handleSaveToPortal(index) }}
          >
            {savedPortalIndex === index ? <CheckOutlined size={14} style={{ color: 'var(--sys-color-success)' }} /> : <ShareOutlined size={14} />}
          </Button>
          <span ref={confirmDeleteIndex === index ? armedDeleteRef : undefined}>
            <Button
              icon={confirmDeleteIndex !== index}
              size="sm"
              type={confirmDeleteIndex === index ? 'primary' : 'tertiary'}
              style={confirmDeleteIndex === index ? { backgroundColor: 'var(--sys-color-error)', borderColor: 'var(--sys-color-error)' } : undefined}
              title={confirmDeleteIndex === index ? translate('confirmDelete') : translate('delete')}
              aria-label={confirmDeleteIndex === index ? translate('confirmDelete') : translate('delete')}
              onClick={() => { handleDeleteClick(index) }}
            >
              <TrashOutlined size={14} className={confirmDeleteIndex === index ? 'mr-1' : undefined} />
              {confirmDeleteIndex === index && translate('confirmDelete')}
            </Button>
          </span>
        </div>
      ))}

      {templates.length > 0 && (
        <div style={{ borderTop: '1px solid var(--sys-color-divider-primary)', margin: '16px 0' }} />
      )}

      <div className="d-flex" style={{ gap: 8 }}>
        <Button
          icon
          type="default"
          title={translate('newTemplateTooltip')}
          aria-label={translate('newTemplateTooltip')}
          onClick={() => { setConfirmDeleteIndex(null); handleAdd() }}
        >
          <PlusOutlined size={14} className="mr-1" />
          {translate('newTemplateLabel')}
        </Button>
        <Button
          icon
          type="default"
          title={translate('importTooltip')}
          aria-label={translate('importTooltip')}
          onClick={() => { setConfirmDeleteIndex(null); fileInputRef.current?.click() }}
        >
          <ImportOutlined size={14} className="mr-1" />
          {translate('importLabel')}
        </Button>
        <Button
          icon
          type="default"
          title={translate('loadFromPortalTooltip')}
          aria-label={translate('loadFromPortalTooltip')}
          onClick={() => { setConfirmDeleteIndex(null); setIsPortalPickerOpen(true) }}
        >
          <DownloadOutlined size={14} className="mr-1" />
          {translate('loadFromPortalLabel')}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(evt) => { void handleImportFile(evt) }}
      />
      {importError && <div className="mt-2" style={{ color: 'var(--sys-color-error)' }}>{importError}</div>}
      {portalError && <div className="mt-2" style={{ color: 'var(--sys-color-error)' }}>{portalError}</div>}

      <PortalTemplatePicker
        isOpen={isPortalPickerOpen}
        onClose={() => { setIsPortalPickerOpen(false) }}
        onLoad={handlePortalLoad}
      />

      {editingTemplate && (
        <LayoutEditor
          isOpen
          layout={editingTemplate}
          useMapWidgetId={useMapWidgetId}
          onClose={() => { setEditingTemplate(null) }}
          onSave={handleEditorSave}
        />
      )}
    </div>
  )
}

export default TemplateManager
