import { React, Immutable, hooks, ReactRedux, WidgetState, type AllWidgetProps, type IMState } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'
import { Button, Checkbox, Label, TextArea, Select, Option, Radio, NumericInput } from 'jimu-ui'
import * as reactiveUtils from 'esri/core/reactiveUtils'
import { ArrowLeftOutlined } from 'jimu-icons/outlined/directional/arrow-left'
import { EditOutlined } from 'jimu-icons/outlined/editor/edit'
import { UpOutlined } from 'jimu-icons/outlined/directional/up'
import { DownOutlined } from 'jimu-icons/outlined/directional/down'
import { ResetOutlined } from 'jimu-icons/outlined/editor/reset'
import { ExportOutlined } from 'jimu-icons/outlined/editor/export'
import { DuplicateOutlined } from 'jimu-icons/outlined/editor/duplicate'
import type { IMConfig, Layout, TextElement } from '../config'
import { openPrintPreview } from './printPreview'
import { exportLayoutToPdf, DEFAULT_PDF_MAP_DPI, type PdfMapDpi } from './pdf/exportPdf'
import { exportLayoutToImage, toFileName, type ExportFormat } from './exportFile'
import type { CaptureWarning } from './mapCapture'
import { formatScale, isValidScale } from './printScale'
import { loadGeometryOperators, trueScaleAtScreenPoint } from './printGeometry'
import { computePrintAreaRect } from './printArea'
import { exportTemplateToFile } from './templateStore.local'
import { loadImportedTemplates, saveImportedTemplates, loadOwnedTemplateIds, saveOwnedTemplateIds, loadSavedFingerprints, saveSavedFingerprints } from './templateStore.localStorage'
import { layoutFingerprint, templateFileStatus, type TemplateFileStatus } from './templateFingerprint'
import { InfoOutlined } from 'jimu-icons/outlined/suggested/info'
import { createBlankLayout, duplicateLayout, uniqueTemplateName } from './templateFactory'
import TemplatePicker from './TemplatePicker'
import PrintAreaOverlay from './PrintAreaOverlay'
import defaultMessages from '../translations/default'

// Lazy-loaded: the Layout Editor (interact.js, every icon, the color picker, all the properties
// panels) is a lot of code that most widget instances — anyone with allowViewerLayoutEdit off, likely
// the common case — should never have to download. Splitting it into its own chunk means only
// instances that actually enable the toggle pay for it, rather than bloating every visitor's page
// load with editor code they can't reach.
const LayoutEditor = React.lazy(async () => await import('./layoutEditor/LayoutEditor'))

const Widget = (props: AllWidgetProps<IMConfig>) => {
  const translate = hooks.useTranslation(defaultMessages)
  const [jimuMapView, setJimuMapView] = React.useState<JimuMapView>(null)
  const [textValues, setTextValues] = React.useState<{ [elementId: string]: string }>({})
  const [showPrintArea, setShowPrintArea] = React.useState(false)
  const [printPreviewError, setPrintPreviewError] = React.useState<string>(null)
  // The Format choice (like the built-in Print widget's): what Export downloads, and what the Preview
  // tab's Download button saves. PDF by default — sharper than PNG, and georeferenced.
  const [format, setFormat] = React.useState<ExportFormat>('pdf')
  const [isExporting, setIsExporting] = React.useState(false)
  const [exportError, setExportError] = React.useState<string>(null)
  // Phase 14, chosen by the viewer in the Advanced section (like the built-in Print widget): how the
  // map's extent/scale is decided, the typed scale for 'setScale', and the PDF map resolution. Plus
  // whether the print area at that scale is bigger than the map on screen, and any warnings from the
  // last capture (lower resolution than requested, scale the map couldn't draw at).
  const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(false)
  const [extentMode, setExtentMode] = React.useState<'currentExtent' | 'currentScale' | 'setScale'>('currentExtent')
  const [typedScale, setTypedScale] = React.useState<number | null>(null)
  const [pdfMapDpi, setPdfMapDpi] = React.useState<PdfMapDpi>(DEFAULT_PDF_MAP_DPI)
  const [geoPdf, setGeoPdf] = React.useState(true)
  const [currentTrueScale, setCurrentTrueScale] = React.useState<number | null>(null)
  const [printAreaOverflows, setPrintAreaOverflows] = React.useState(false)
  const [captureWarnings, setCaptureWarnings] = React.useState<CaptureWarning[]>([])
  const [isRuntimeEditorOpen, setIsRuntimeEditorOpen] = React.useState(false)
  // Which template the viewer picked — session-local like every other runtime-editor concept from
  // Phase 6: there's no runtime equivalent of onSettingChange, so none of this can (or should) write
  // back to props.config. (Imported templates themselves are the one exception to "session-local" —
  // see importedTemplates below.)
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  // Unlike every other piece of runtime state here, imported templates persist across a page refresh
  // via localStorage (see templateStore.localStorage.ts) — end users of this widget typically only have
  // Portal viewer access, so there's no durable Portal-based save/load available to them the way there
  // is for the designer at design time, and losing a locally-imported (possibly hand-edited) template to
  // an accidental refresh would otherwise mean redoing it or re-finding the original file.
  const [importedTemplates, setImportedTemplates] = React.useState<Layout[]>(() => loadImportedTemplates(props.id))
  // A viewer's layout adjustments to one of the *designer's* templates (Phase 6) stay session-local,
  // keyed by template id so switching to "Change template" and back to the same one doesn't lose them —
  // they live only in this state for the life of this widget instance and are never written back to
  // props.config. Edits to an *imported* template go straight into `importedTemplates` instead (see
  // isImportedTemplate/onSave below), so they ride along with the same localStorage persistence.
  const [sessionLayoutsByTemplateId, setSessionLayoutsByTemplateId] = React.useState<{ [templateId: string]: Layout }>({})

  React.useEffect(() => {
    saveImportedTemplates(props.id, importedTemplates)
  }, [props.id, importedTemplates])

  // Templates the viewer made themselves (New/Duplicate, when WidgetConfig.allowViewerCreateTemplates is
  // on). They live in `importedTemplates` like imported ones; this marks which are the viewer's own to
  // edit freely (LayoutEditor's ownTemplate), and persists alongside them.
  const [ownedTemplateIds, setOwnedTemplateIds] = React.useState<string[]>(() => loadOwnedTemplateIds(props.id))
  React.useEffect(() => {
    saveOwnedTemplateIds(props.id, ownedTemplateIds)
  }, [props.id, ownedTemplateIds])
  const allowCreateTemplates = props.config.allowViewerCreateTemplates ?? false

  // Fingerprint of each browser-stored template as last saved to (or imported from) a file, so the
  // widget can remind viewers about changes that exist only in this browser (templateFingerprint.ts).
  const [savedFingerprints, setSavedFingerprints] = React.useState<{ [templateId: string]: string }>(() => loadSavedFingerprints(props.id))
  React.useEffect(() => {
    saveSavedFingerprints(props.id, savedFingerprints)
  }, [props.id, savedFingerprints])

  const useMapWidgetId = props.useMapWidgetIds?.[0]

  // Closing the widget in a widget controller (or hiding it in a section/view) doesn't unmount it — it
  // only changes its runtime state — so the print area has to be hidden explicitly, as the built-in
  // Print widget does, or it would stay on the map after the panel closes.
  const runtimeState = ReactRedux.useSelector((state: IMState) => state.widgetsRuntimeInfo?.[props.id]?.state)
  const isWidgetVisible = runtimeState !== WidgetState.Closed && runtimeState !== WidgetState.Hidden

  const configTemplates = React.useMemo<Layout[]>(() => {
    return (props.config.templates ?? Immutable([])).asMutable({ deep: true }) as Layout[]
  }, [props.config.templates])

  const availableTemplates = React.useMemo<Layout[]>(() => {
    return [...configTemplates, ...importedTemplates]
  }, [configTemplates, importedTemplates])

  const activeTemplate = availableTemplates.find((template) => template.id === selectedTemplateId) ?? null

  // The picked template's element ids, as originally picked — stable across repeated open/Apply/
  // reopen cycles of the runtime editor within one visit (memoized on `activeTemplate`, not on every
  // session edit), unlike `sessionLayout` which grows as the viewer adds elements. Phase 9's runtime
  // element adding uses this to tell "the designer's original elements" (nudge/restyle-only) apart
  // from "elements the viewer added this session" (freely deletable/reorderable) — anything with an
  // id outside this set was added afterward, since new elements always get a fresh crypto.randomUUID().
  const originalElementIds = React.useMemo<Set<string>>(() => {
    return new Set((activeTemplate?.elements ?? []).map((element) => element.id))
  }, [activeTemplate])

  const layout = (selectedTemplateId ? sessionLayoutsByTemplateId[selectedTemplateId] : undefined) ?? activeTemplate

  const editableTextElements = React.useMemo<TextElement[]>(() => {
    return (layout?.elements ?? []).filter(
      (element): element is TextElement => element.type === 'text' && Boolean(element.editableAtRuntime)
    )
  }, [layout])

  // Feeds PrintAreaOverlay's live preview box — the actual crop used at export time is recomputed
  // fresh from the view's current size in mapCapture.ts, not from this value, but the frame's own
  // w/h (its aspect ratio, and with a print scale its physical size) is the same in both places.
  const mapFrameSize = React.useMemo<{ w: number; h: number } | null>(() => {
    const mapFrame = layout?.elements.find((element) => element.type === 'mapFrame')
    return mapFrame ? { w: mapFrame.w, h: mapFrame.h } : null
  }, [layout])

  const isMapView = jimuMapView?.view?.type === '2d'

  // The map's true scale at the print area's centre, kept current as the map moves — what "Current map
  // scale" prints at, and what the reset button next to "Set map scale" fills in.
  React.useEffect(() => {
    const view = jimuMapView?.view
    if (!view || view.type !== '2d' || !mapFrameSize) {
      setCurrentTrueScale(null)
      return
    }
    let cancelled = false
    const update = (): void => {
      if (cancelled) return
      const width = view.container?.clientWidth ?? view.width
      const height = view.container?.clientHeight ?? view.height
      const rect = computePrintAreaRect(width, height, mapFrameSize.w / mapFrameSize.h) ?? { x: 0, y: 0, width, height }
      setCurrentTrueScale(trueScaleAtScreenPoint(view, rect.x + rect.width / 2, rect.y + rect.height / 2))
    }
    loadGeometryOperators().catch(() => undefined).finally(update)
    const handle = reactiveUtils.watch(() => view.stationary, (stationary) => { if (stationary) update() })
    return () => {
      cancelled = true
      handle.remove()
    }
  }, [jimuMapView, mapFrameSize])

  // Undefined prints the on-screen print area as it is ("Current map extent"). A 3D view has no single
  // scale, so it always prints the current extent.
  const printScale: number | undefined = !isMapView
    ? undefined
    : extentMode === 'currentScale'
      ? (currentTrueScale !== null ? Math.round(currentTrueScale) : undefined)
      : extentMode === 'setScale' && isValidScale(typedScale)
        ? typedScale
        : undefined
  // "Set map scale" with nothing (valid) typed yet blocks printing rather than silently printing the
  // current extent instead of the scale the viewer is about to enter.
  const isScaleMissing = isMapView && extentMode === 'setScale' && !isValidScale(typedScale)

  const describeWarning = (warning: CaptureWarning): string => {
    switch (warning.kind) {
      case 'reducedDpi':
        return translate('warningReducedDpi', { effectiveDpi: warning.effectiveDpi, targetDpi: warning.targetDpi })
      case 'scaleAdjusted':
        return translate('warningScaleAdjusted', { requested: formatScale(warning.requestedScale), actual: formatScale(warning.actualScale) })
      case 'scaleNotSupportedIn3d':
        return translate('warningScaleNotSupportedIn3d')
      case 'notGeoreferenced':
        return translate('warningNotGeoreferenced')
    }
  }

  const onTextChange = (elementId: string, value: string): void => {
    setTextValues((prev) => ({ ...prev, [elementId]: value }))
  }

  // Called directly (not awaited-into) from the button's onClick — openPrintPreview itself calls
  // window.open() as its very first, synchronous statement, before any await, so it stays inside the
  // click handler's user-gesture context and isn't at risk of being blocked as a pop-up. Wrapping this
  // in another async step before calling it would reintroduce that risk.
  const onPrintPreviewClick = (): void => {
    if (!jimuMapView?.view || !layout) return
    setPrintPreviewError(null)
    setCaptureWarnings([])
    openPrintPreview({
      view: jimuMapView.view,
      jimuMapView,
      layout,
      textOverrides: textValues,
      printScale,
      labels: {
        preparingPreviewTitle: translate('preparingPreviewTitle'),
        preparingPreviewBody: translate('preparingPreviewBody'),
        printPreviewFailedTitle: translate('printPreviewFailedTitle'),
        printPreviewFailedBody: translate('printPreviewFailedBody'),
        close: translate('close')
      }
    }).then(setCaptureWarnings).catch(() => { setPrintPreviewError(translate('printPreviewFailed')) })
  }

  // Export downloads straight away in the chosen format. Unlike Preview there's no pop-up to open, so
  // this can safely await: the file is saved through an ordinary download, which browsers don't tie
  // to the click's user gesture.
  const onExportClick = async (): Promise<void> => {
    if (!jimuMapView?.view || !layout || isExporting) return
    setExportError(null)
    setPrintPreviewError(null)
    setCaptureWarnings([])
    setIsExporting(true)
    const renderOptions = { view: jimuMapView.view, jimuMapView, layout, textOverrides: textValues, printScale, fileName: toFileName(layout.name, format) }
    try {
      const warnings = format === 'pdf'
        ? await exportLayoutToPdf({ ...renderOptions, mapDpi: pdfMapDpi, geoPdf })
        : await exportLayoutToImage({ ...renderOptions, format })
      setCaptureWarnings(warnings)
    } catch (error) {
      console.error('Export failed', error)
      setExportError(translate('exportFailed'))
    } finally {
      setIsExporting(false)
    }
  }

  const isImportedTemplate = (templateId: string): boolean => {
    return importedTemplates.some((template) => template.id === templateId)
  }

  const onTemplateImported = (imported: Layout): void => {
    setImportedTemplates((prev) => [...prev, imported])
    // Just read from a file, so that file already has everything in it.
    setSavedFingerprints((prev) => ({ ...prev, [imported.id]: layoutFingerprint(imported) }))
    setSelectedTemplateId(imported.id)
  }

  const onDeleteImportedTemplate = (templateId: string): void => {
    setImportedTemplates((prev) => prev.filter((template) => template.id !== templateId))
    setOwnedTemplateIds((prev) => prev.filter((id) => id !== templateId))
    setSavedFingerprints(({ [templateId]: _removed, ...rest }) => rest)
  }

  // Only templates kept in this browser (imported or the viewer's own) can lose work; the designer's
  // templates are safe in the app's config, and viewers' adjustments to them last for the session only.
  const fileStatusOf = (template: Layout): TemplateFileStatus | null => {
    return isImportedTemplate(template.id) ? templateFileStatus(template, savedFingerprints[template.id]) : null
  }

  const onSaveTemplateToFile = (template: Layout): void => {
    exportTemplateToFile(template)
    if (isImportedTemplate(template.id)) {
      setSavedFingerprints((prev) => ({ ...prev, [template.id]: layoutFingerprint(template) }))
    }
  }

  const isOwnTemplate = (templateId: string | null): boolean => templateId !== null && ownedTemplateIds.includes(templateId)

  // A new or duplicated template is picked and opened straight in the editor, since the next thing the
  // viewer wants to do is lay it out.
  const addOwnTemplate = (template: Layout): void => {
    setImportedTemplates((prev) => [...prev, template])
    setOwnedTemplateIds((prev) => [...prev, template.id])
    setSelectedTemplateId(template.id)
    setTextValues({})
    setIsRuntimeEditorOpen(true)
  }

  const onCreateTemplate = (): void => {
    addOwnTemplate(createBlankLayout(uniqueTemplateName(translate('myTemplateName'), availableTemplates), { mapFrameLocked: false }))
  }

  const onDuplicateTemplate = (source: Layout): void => {
    addOwnTemplate(duplicateLayout(source, uniqueTemplateName(translate('templateCopyName', { name: source.name }), availableTemplates)))
  }

  const onChangeTemplateClick = (): void => {
    setSelectedTemplateId(null)
    setTextValues({})
  }

  return (
    <div className="print-studio jimu-widget p-3 d-flex flex-column" style={{ height: '100%' }}>
      {useMapWidgetId
        ? <JimuMapViewComponent useMapWidgetId={useMapWidgetId} onActiveViewChange={setJimuMapView} />
        : <div className="text-disabled">{translate('noMapWidget')}</div>}
      <PrintAreaOverlay
        jimuMapView={jimuMapView}
        mapFrameSize={layout ? mapFrameSize : null}
        printScale={printScale}
        visible={showPrintArea && isWidgetVisible}
        onOverflowChange={setPrintAreaOverflows}
      />

      {!layout
        ? (
          <TemplatePicker
            templates={availableTemplates}
            isImported={isImportedTemplate}
            onPick={(template) => { setSelectedTemplateId(template.id) }}
            onImported={onTemplateImported}
            onDeleteImported={onDeleteImportedTemplate}
            fileStatusOf={fileStatusOf}
            canCreate={allowCreateTemplates}
            onCreate={onCreateTemplate}
            onDuplicate={onDuplicateTemplate}
          />
          )
        : (
          <>
            {/* Grows to fill the panel so the print-area checkbox and Print button below always sit
                flush at the bottom, matching the built-in Print widget's own layout. */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {availableTemplates.length > 1 && (
                <Button
                  icon
                  type="tertiary"
                  className="mb-2 d-flex align-items-center"
                  onClick={onChangeTemplateClick}
                >
                  <ArrowLeftOutlined size={14} className="mr-1" />
                  {translate('changeTemplate')}
                </Button>
              )}

              <div className="mb-2" style={{ fontWeight: 600 }}>{layout.name}</div>

              {/* Reminder for templates that exist only in this browser, shown only while there's
                  something not yet in a saved file. */}
              {fileStatusOf(layout) !== null && fileStatusOf(layout) !== 'saved' && (
                <div role="status" className="d-flex small text-disabled mb-2" style={{ gap: 6 }}>
                  <InfoOutlined size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    {fileStatusOf(layout) === 'notSaved'
                      ? <><strong>{translate('savedInBrowserOnly')}</strong> {translate('savedInBrowserOnlyHint')}</>
                      : translate('unsavedTemplateChanges')}
                  </span>
                </div>
              )}

              {editableTextElements.map((element) => (
                <div className="mb-2" key={element.id}>
                  <Label for={`print-export-text-${element.id}`}>{element.name}</Label>
                  <TextArea
                    id={`print-export-text-${element.id}`}
                    height={34}
                    value={textValues[element.id] ?? element.text}
                    onChange={(evt) => { onTextChange(element.id, evt.target.value) }}
                  />
                </div>
              ))}

              <div className="d-flex flex-wrap align-items-center" style={{ gap: 8 }}>
                {(props.config.allowViewerLayoutEdit || isOwnTemplate(selectedTemplateId)) && (
                  <Button
                    icon
                    type="tertiary"
                    title={translate('editLayout')}
                    aria-label={translate('editLayout')}
                    onClick={() => { setIsRuntimeEditorOpen(true) }}
                  >
                    <EditOutlined size={16} />
                  </Button>
                )}
                <Button
                  icon
                  type="tertiary"
                  title={translate('saveTemplateToFile')}
                  aria-label={translate('saveTemplateToFile')}
                  onClick={() => { onSaveTemplateToFile(layout) }}
                >
                  <ExportOutlined size={16} />
                </Button>
                {allowCreateTemplates && (
                  // Duplicates the layout as currently adjusted, so a viewer can keep their changes as their own template.
                  <Button
                    icon
                    type="tertiary"
                    title={translate('duplicateTemplate')}
                    aria-label={translate('duplicateTemplate')}
                    onClick={() => { onDuplicateTemplate(layout) }}
                  >
                    <DuplicateOutlined size={16} />
                  </Button>
                )}
              </div>

              {printPreviewError && <div className="mt-2" style={{ color: 'var(--sys-color-error)' }}>{printPreviewError}</div>}

              <Label for={`print-export-format-${props.id}`} className="mt-3 mb-1">{translate('format')}</Label>
              <Select
                id={`print-export-format-${props.id}`}
                size="sm"
                value={format}
                onChange={(evt) => { setFormat(evt.target.value as ExportFormat) }}
              >
                {/* Plain lowercase extensions, listed as the built-in Print widget lists them. */}
                <Option value="jpg">jpg</Option>
                <Option value="pdf">pdf</Option>
                <Option value="png">png</Option>
              </Select>

              {/* Advanced — laid out like the built-in Print widget's own runtime Advanced section. */}
              <div className="mt-3">
                <Button
                  type="tertiary"
                  className="w-100 d-flex align-items-center justify-content-between px-0"
                  aria-expanded={isAdvancedOpen}
                  aria-controls={`print-export-advanced-${props.id}`}
                  onClick={() => { setIsAdvancedOpen((open) => !open) }}
                >
                  <span>{translate('advanced')}</span>
                  {isAdvancedOpen ? <UpOutlined size={14} /> : <DownOutlined size={14} />}
                </Button>
                {isAdvancedOpen && (
                  <div id={`print-export-advanced-${props.id}`} className="mt-2">
                    <div role="radiogroup" aria-labelledby={`print-export-extents-${props.id}`}>
                      <div id={`print-export-extents-${props.id}`} className="mb-1">{translate('mapPrintingExtents')}</div>
                      {(['currentExtent', 'currentScale', 'setScale'] as const).map((mode) => (
                        <div key={mode} className="d-flex align-items-center mb-1" style={{ gap: 8 }}>
                          <Radio
                            id={`print-export-extent-${mode}-${props.id}`}
                            name={`print-export-extent-${props.id}`}
                            checked={extentMode === mode}
                            disabled={mode !== 'currentExtent' && !isMapView && !!jimuMapView}
                            onChange={() => {
                              setExtentMode(mode)
                              // Start "Set map scale" from the map's current scale, as the built-in widget does.
                              if (mode === 'setScale' && typedScale === null && currentTrueScale !== null) setTypedScale(Math.round(currentTrueScale))
                            }}
                          />
                          <Label for={`print-export-extent-${mode}-${props.id}`} className="mb-0">
                            {translate(mode === 'currentExtent' ? 'currentMapExtent' : mode === 'currentScale' ? 'currentMapScale' : 'setMapScale')}
                          </Label>
                        </div>
                      ))}
                    </div>
                    {extentMode === 'currentScale' && currentTrueScale !== null && (
                      <div className="small text-disabled ml-4">{formatScale(currentTrueScale)}</div>
                    )}
                    {extentMode === 'setScale' && (
                      <div className="d-flex align-items-center mt-1" style={{ gap: 6 }}>
                        <span aria-hidden="true">1 :</span>
                        <NumericInput
                          size="sm"
                          className="flex-grow-1"
                          aria-label={translate('setMapScale')}
                          min={1}
                          precision={0}
                          showHandlers={false}
                          value={typedScale ?? undefined}
                          onAcceptValue={(value) => {
                            const scale = Number(value)
                            setTypedScale(isValidScale(scale) ? Math.round(scale) : null)
                          }}
                        />
                        <Button
                          icon
                          size="sm"
                          type="tertiary"
                          title={translate('useCurrentScale')}
                          aria-label={translate('useCurrentScale')}
                          disabled={currentTrueScale === null}
                          onClick={() => { if (currentTrueScale !== null) setTypedScale(Math.round(currentTrueScale)) }}
                        >
                          <ResetOutlined size={14} />
                        </Button>
                      </div>
                    )}
                    {jimuMapView && !isMapView && (
                      <div className="small text-disabled mt-1">{translate('warningScaleNotSupportedIn3d')}</div>
                    )}
                    <div className="small text-disabled mt-1">{translate('trueScaleHint')}</div>

                    {/* PDF-only options: a jpg/png is always a ~300dpi image of the whole page, and can't be georeferenced. */}
                    {format === 'pdf' && (<>
                    <Label for={`print-export-pdf-dpi-${props.id}`} className="mt-3 mb-1">{translate('pdfMapResolution')}</Label>
                    <Select
                      id={`print-export-pdf-dpi-${props.id}`}
                      size="sm"
                      value={pdfMapDpi}
                      onChange={(evt) => { setPdfMapDpi(Number(evt.target.value) as PdfMapDpi) }}
                    >
                      <Option value={150}>{translate('pdfMapDpiDraft')}</Option>
                      <Option value={200}>{translate('pdfMapDpiStandard')}</Option>
                      <Option value={300}>{translate('pdfMapDpiHigh')}</Option>
                    </Select>

                    <div className="d-flex align-items-center mt-3" style={{ gap: 8 }}>
                      <Checkbox
                        id={`print-export-geopdf-${props.id}`}
                        checked={geoPdf}
                        onChange={(_evt, checked) => { setGeoPdf(checked) }}
                      />
                      <Label for={`print-export-geopdf-${props.id}`} className="mb-0">{translate('geoPdf')}</Label>
                    </div>
                    <div className="small text-disabled mt-1">{translate('geoPdfHint')}</div>
                    </>)}
                  </div>
                )}
              </div>
            </div>

            {isScaleMissing && (
              <div role="status" className="small mt-2" style={{ flexShrink: 0 }}>{translate('enterMapScale')}</div>
            )}
            {printScale !== undefined && showPrintArea && printAreaOverflows && (
              <div role="status" className="small mt-1" style={{ flexShrink: 0 }}>{translate('printAreaLargerThanMap')}</div>
            )}

            <div className="d-flex align-items-center mt-3" style={{ gap: 6, flexShrink: 0 }}>
              <Checkbox
                checked={showPrintArea}
                disabled={!jimuMapView || mapFrameSize === null}
                onChange={(_evt, checked) => { setShowPrintArea(checked) }}
              />
              <Label style={{ marginBottom: 0 }}>{translate('showPrintArea')}</Label>
            </div>
            <div className="d-flex mt-2" style={{ gap: 8, flexShrink: 0 }}>
              <Button
                type="secondary"
                style={{ flex: 1 }}
                title={translate('previewHint')}
                disabled={!jimuMapView || isScaleMissing}
                onClick={onPrintPreviewClick}
              >
                {translate('preview')}
              </Button>
              <Button
                type="primary"
                style={{ flex: 1 }}
                disabled={!jimuMapView || isExporting || isScaleMissing}
                aria-busy={isExporting}
                onClick={() => { void onExportClick() }}
              >
                {isExporting ? translate('exporting') : translate('export')}
              </Button>
            </div>
            {exportError && <div role="alert" className="mt-2" style={{ color: 'var(--sys-color-error)', flexShrink: 0 }}>{exportError}</div>}
            {captureWarnings.length > 0 && (
              <div role="status" className="small mt-2" style={{ color: 'var(--sys-color-warning-dark, #8a6100)', flexShrink: 0 }}>
                {captureWarnings.map((warning, index) => <div key={index}>{describeWarning(warning)}</div>)}
              </div>
            )}

            {(props.config.allowViewerLayoutEdit || allowCreateTemplates) && (
              <React.Suspense fallback={null}>
                <LayoutEditor
                  isOpen={isRuntimeEditorOpen}
                  layout={layout}
                  useMapWidgetId={useMapWidgetId}
                  printScale={printScale}
                  viewerMode
                  allowAddElements={props.config.allowViewerAddElements ?? false}
                  originalElementIds={originalElementIds}
                  ownTemplate={isOwnTemplate(selectedTemplateId)}
                  onClose={() => { setIsRuntimeEditorOpen(false) }}
                  onSave={(updated) => {
                    if (isImportedTemplate(selectedTemplateId)) {
                      setImportedTemplates((prev) => prev.map((template) => template.id === selectedTemplateId ? updated : template))
                    } else {
                      setSessionLayoutsByTemplateId((prev) => ({ ...prev, [selectedTemplateId]: updated }))
                    }
                  }}
                />
              </React.Suspense>
            )}
          </>
          )}
    </div>
  )
}

export default Widget
