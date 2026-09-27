import { prepareLayout, paintLayout, type PreparedLayout, type RenderOptions } from '../exportRenderer'
import { downloadBlob } from '../exportFile'
import { PAGE_PX_PER_INCH } from '../printGeometry'
import { PdfPainter } from './pdfPainter'
import { attachGeoViewports, buildGeoViewport } from './geoPdf'
import type { MapFrameElement } from '../../config'
import type { CaptureWarning } from '../mapCapture'

// Vector PDF export (spec Phase 13). The page is painted by the same element renderers as the PNG
// export, through PdfPainter, so text, lines, the north arrow, scale bar, legend, attribute table and
// popup card come out as real PDF vector content (selectable, searchable text; sharp at any zoom).
// Only the map frame and image elements are raster: the map as JPEG at the widget's pdfMapDpi setting
// (options.mapDpi; 200dpi by default), images as lossless PNG so logos keep their transparency.
//
// Drawing target decision: the spec's first option was jsPDF's own canvas-like `context2d` plugin.
// It was ruled out because it measures text with PDF font metrics, which can move line breaks away
// from what the preview and PNG show. PdfPainter (option 2) answers measureText with the browser's
// own font instead, so wrapping is identical everywhere; see pdfPainter.ts.

// Resolution of the map image in a PDF, chosen by the viewer in the widget's Advanced section.
export type PdfMapDpi = 150 | 200 | 300
export const DEFAULT_PDF_MAP_DPI: PdfMapDpi = 200

// Layout coordinates are 150dpi page pixels (pageSize.ts); PDF user space is 72 points per inch.
export const PT_PER_PAGE_PX = 72 / 150

export interface PdfOptions {
  mapDpi?: PdfMapDpi
  // Phase 15: georeference the map frame (GeoPDF). Defaults to true.
  geoPdf?: boolean
}

export interface PdfExportOptions extends Omit<RenderOptions, 'mapDpi'>, PdfOptions {
  fileName: string
}

// PDF export (the Export button with Format = PDF): captures the map at the PDF map resolution,
// builds the PDF and downloads it. Resolves with any warnings for the widget to show.
export async function exportLayoutToPdf (options: PdfExportOptions): Promise<CaptureWarning[]> {
  const mapDpi = options.mapDpi ?? DEFAULT_PDF_MAP_DPI
  const prepared = await prepareLayout({ ...options, mapDpi })
  const { blob, warnings } = await buildPdf(prepared, { ...options, mapDpi })
  downloadBlob(blob, options.fileName)
  return warnings
}

// Builds the PDF from a prepared layout. A map captured at a higher resolution than `mapDpi` is
// downsampled first, so the PDF map resolution setting is always honoured.
export async function buildPdf (prepared: PreparedLayout, options: PdfOptions): Promise<{ blob: Blob; warnings: CaptureWarning[] }> {
  // Loaded on demand so the library (~350 KB) never downloads for viewers who only preview or export PNG.
  const { jsPDF: JsPdf } = await import('jspdf')

  const widthPt = prepared.pageSize.w * PT_PER_PAGE_PX
  const heightPt = prepared.pageSize.h * PT_PER_PAGE_PX
  const doc = new JsPdf({
    unit: 'pt',
    format: [widthPt, heightPt],
    orientation: widthPt > heightPt ? 'landscape' : 'portrait',
    compress: true,
    // Otherwise jsPDF lists all 14 standard fonts in every file, used or not.
    putOnlyUsedFonts: true
  })
  doc.setProperties({ title: prepared.layout.name, creator: 'Print Studio for ArcGIS Experience Builder' })

  const mapFrame = prepared.layout.elements.find((element): element is MapFrameElement => element.type === 'mapFrame')
  const mapImage = mapFrame && prepared.mapImage
    ? downsampleTo(prepared.mapImage, Math.round(mapFrame.w * (options.mapDpi ?? DEFAULT_PDF_MAP_DPI) / PAGE_PX_PER_INCH), Math.round(mapFrame.h * (options.mapDpi ?? DEFAULT_PDF_MAP_DPI) / PAGE_PX_PER_INCH))
    : prepared.mapImage
  const painter = new PdfPainter(doc, {
    baseScale: PT_PER_PAGE_PX,
    jpegImages: mapImage ? new Set([mapImage]) : undefined
  })
  paintLayout(painter, { ...prepared, mapImage })

  const warnings = [...prepared.captureWarnings]
  if ((options.geoPdf ?? true) && mapFrame) {
    const viewport = buildGeoViewport(prepared.printGeometry, mapFrame, PT_PER_PAGE_PX, heightPt)
    if (viewport) attachGeoViewports(doc, [viewport])
    else warnings.push({ kind: 'notGeoreferenced' })
  }

  return { blob: doc.output('blob'), warnings }
}

// A copy of `image` at width x height when it is meaningfully larger (over 2%); otherwise the original.
function downsampleTo (image: CanvasImageSource, width: number, height: number): CanvasImageSource {
  const source = image as { width: number; height: number; naturalWidth?: number; naturalHeight?: number }
  const sourceWidth = source.naturalWidth || source.width
  const sourceHeight = source.naturalHeight || source.height
  if (!sourceWidth || !sourceHeight || sourceWidth <= width * 1.02) return image
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}
