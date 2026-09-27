import { React, hooks } from 'jimu-core'
import { Button } from 'jimu-ui'
import { ImportOutlined } from 'jimu-icons/outlined/editor/import'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import { PlusOutlined } from 'jimu-icons/outlined/editor/plus'
import { DuplicateOutlined } from 'jimu-icons/outlined/editor/duplicate'
import type { Layout } from '../config'
import type { TemplateFileStatus } from './templateFingerprint'
import { importTemplateFromFile } from './templateStore.local'
import defaultMessages from '../translations/default'

export interface TemplatePickerProps {
  templates: Layout[]
  // Only imported templates (as opposed to the designer's own config ones) get the delete option below
  // — they're the only ones this widget can meaningfully let a viewer remove, since the others live in
  // the app's own saved config.
  isImported: (templateId: string) => boolean
  onPick: (layout: Layout) => void
  onImported: (layout: Layout) => void
  onDeleteImported: (templateId: string) => void
  // WidgetConfig.allowViewerCreateTemplates: shows New and a per-template Duplicate. Both open the
  // new template straight in the editor (handled by widget.tsx).
  // Whether a browser-stored template has changes that aren't in a saved file (null for the designer's
  // templates, which are safe in the app's config) — shown as a small tag on its row.
  fileStatusOf?: (layout: Layout) => TemplateFileStatus | null
  canCreate?: boolean
  onCreate?: () => void
  onDuplicate?: (layout: Layout) => void
}

const PAGE_SIZE_LABELS: { [size in Layout['pageSize']]: string } = {
  letter: 'Letter',
  tabloid: 'Tabloid',
  a4: 'A4',
  a3: 'A3'
}

// Shown by widget.tsx whenever no template is currently picked — either nothing has been chosen yet
// this session, or there simply aren't any (no templates configured and nothing imported). Runtime
// import is local-file only, never Portal — see print-studio-spec.md Phase 7/8 for why that
// split exists.
const TemplatePicker = (props: TemplatePickerProps): React.ReactElement => {
  const { templates, isImported, onPick, onImported, onDeleteImported, fileStatusOf, canCreate = false, onCreate, onDuplicate } = props
  const translate = hooks.useTranslation(defaultMessages)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [importError, setImportError] = React.useState<string | null>(null)
  // Deleting an imported template has no undo — native confirm()/alert() dialogs are disallowed in this
  // codebase, so the bin icon arms on the first click and only actually deletes on a second click on
  // that same row, same pattern as TemplateManager.tsx's design-time delete.
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)
  const armedDeleteRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (confirmDeleteId === null) return
    const onPointerDown = (evt: MouseEvent): void => {
      if (armedDeleteRef.current?.contains(evt.target as Node)) return
      setConfirmDeleteId(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [confirmDeleteId])

  const handleImportFile = async (evt: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = evt.target.files?.[0]
    evt.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const layout = await importTemplateFromFile(file)
      onImported(layout)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDeleteClick = (evt: React.MouseEvent, templateId: string): void => {
    evt.stopPropagation()
    if (confirmDeleteId !== templateId) {
      setConfirmDeleteId(templateId)
      return
    }
    setConfirmDeleteId(null)
    onDeleteImported(templateId)
  }

  return (
    <div>
      {templates.length === 0
        ? <div className="text-disabled mb-3">{translate('noTemplates')}</div>
        : (
          <div className="mb-3">
            {templates.map((template) => {
              const isArmed = confirmDeleteId === template.id
              return (
                <div key={template.id} className="d-flex align-items-center mb-2" style={{ gap: 4 }}>
                  <Button
                    block
                    type="default"
                    className="d-flex align-items-center justify-content-between"
                    onClick={() => { onPick(template) }}
                  >
                    <span className="d-flex flex-column align-items-start" style={{ minWidth: 0, textAlign: 'left' }}>
                      <span>{template.name}</span>
                      {(() => {
                        const status = fileStatusOf?.(template)
                        if (!status) return null
                        return (
                          <span style={{ fontSize: 12, lineHeight: 1.3, whiteSpace: 'nowrap', textAlign: 'left', color: status === 'saved' ? 'var(--sys-color-surface-paper-hint, #8a8a8a)' : 'var(--sys-color-warning-dark, #8a6100)' }}>
                            {translate(status === 'notSaved' ? 'fileStatusNotSaved' : status === 'changed' ? 'fileStatusChanged' : 'fileStatusSaved')}
                          </span>
                        )
                      })()}
                    </span>
                    <span className="text-disabled" style={{ fontSize: 12, flexShrink: 0 }}>
                      {PAGE_SIZE_LABELS[template.pageSize]} · {template.orientation}
                    </span>
                  </Button>
                  {canCreate && (
                    <Button
                      icon
                      size="sm"
                      type="tertiary"
                      style={{ flexShrink: 0 }}
                      title={translate('duplicateTemplate')}
                      aria-label={`${translate('duplicateTemplate')}: ${template.name}`}
                      onClick={() => { onDuplicate?.(template) }}
                    >
                      <DuplicateOutlined size={14} />
                    </Button>
                  )}
                  {isImported(template.id) && (
                    <span ref={isArmed ? armedDeleteRef : undefined} style={{ flexShrink: 0 }}>
                      <Button
                        icon={!isArmed}
                        size="sm"
                        type={isArmed ? 'primary' : 'tertiary'}
                        style={isArmed ? { backgroundColor: 'var(--sys-color-error)', borderColor: 'var(--sys-color-error)' } : undefined}
                        title={isArmed ? translate('confirmDeleteTemplate') : translate('deleteImportedTemplate')}
                        aria-label={isArmed ? translate('confirmDeleteTemplate') : translate('deleteImportedTemplate')}
                        onClick={(evt) => { handleDeleteClick(evt, template.id) }}
                      >
                        <TrashOutlined size={14} className={isArmed ? 'mr-1' : undefined} />
                        {isArmed && translate('confirmDeleteTemplate')}
                      </Button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(evt) => { void handleImportFile(evt) }}
      />
      <div className="d-flex flex-wrap" style={{ gap: 4 }}>
        {canCreate && (
          <Button icon type="tertiary" title={translate('newTemplateHint')} onClick={() => { onCreate?.() }}>
            <PlusOutlined size={14} className="mr-1" />
            {translate('newTemplate')}
          </Button>
        )}
        <Button icon type="tertiary" onClick={() => { fileInputRef.current?.click() }}>
          <ImportOutlined size={14} className="mr-1" />
          {translate('importTemplate')}
        </Button>
      </div>
      {importError && <div className="mt-2" style={{ color: 'var(--sys-color-error)' }}>{importError}</div>}
    </div>
  )
}

export default TemplatePicker
