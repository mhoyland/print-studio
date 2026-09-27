import type { Layout } from '../config'
import { paintToCanvas, prepareLayout, type RenderOptions } from './exportRenderer'
import type { CaptureWarning } from './mapCapture'

// The generated preview document runs in its own browser tab, entirely outside the React/ExB tree
// (see openPrintPreview below), so it can't call hooks.useTranslation itself — the caller (widget.tsx)
// translates these labels and passes the finished strings in instead.
export interface PrintPreviewLabels {
  preparingPreviewTitle: string
  preparingPreviewBody: string
  printPreviewFailedTitle: string
  printPreviewFailedBody: string
  close: string
}

// Preview only: shows the composed page in a new tab so the viewer can check it, with a Close button.
// Files are made by the widget's own Export button (in the chosen Format), not from here — one place
// to export keeps the widget simple. The page image is the same ~300dpi composite the PNG export makes.
//
// The tab keeps @page print styles sized to the physical page, so if a viewer does print it with the
// browser's own Print command it still comes out at the right size.
const CSS_PAGE_SIZE: { [size in Layout['pageSize']]: string } = {
  letter: 'letter',
  // "Tabloid" and "ledger" are the same physical 11×17in page, named for portrait vs landscape use —
  // but only "ledger" is an actual CSS @page size keyword ("tabloid" isn't recognized at all). The
  // explicit `${orientation}` keyword appended below still controls the final portrait/landscape
  // result regardless, so this doesn't depend on ledger's own "landscape by default" convention.
  tabloid: 'ledger',
  a4: 'A4',
  a3: 'A3'
}

// The window is opened synchronously, before any `await`, and filled in afterward via document.write.
// Opening *after* an awaited async step is a well-known way to trip popup blockers in stricter
// browsers (notably Safari, which only allows window.open within the synchronous portion of a
// user-gesture handler) — opening a blank window immediately and writing into it once rendering
// finishes sidesteps that risk.
// Resolves with any capture warnings (reduced resolution, adjusted scale) for the widget to show.
export async function openPrintPreview (options: RenderOptions & { labels: PrintPreviewLabels }): Promise<CaptureWarning[]> {
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) {
    throw new Error('Could not open the preview — your browser may have blocked the pop-up.')
  }
  writeDocument(previewWindow, buildLoadingHtml(options.labels))

  try {
    const prepared = await prepareLayout(options)
    const dataUrl = paintToCanvas(prepared).toDataURL('image/png')
    writeDocument(previewWindow, buildPreviewHtml(options.layout, dataUrl, options.labels))
    return prepared.captureWarnings
  } catch (error) {
    writeDocument(previewWindow, buildErrorHtml(options.labels))
    throw error
  }
}

function writeDocument (target: Window, html: string): void {
  target.document.open()
  target.document.write(html)
  target.document.close()
}

function buildLoadingHtml (labels: PrintPreviewLabels): string {
  return baseHtml(labels.preparingPreviewTitle, `<p>${escapeHtml(labels.preparingPreviewBody)}</p>`)
}

function buildErrorHtml (labels: PrintPreviewLabels): string {
  return baseHtml(labels.printPreviewFailedTitle, `<p>${escapeHtml(labels.printPreviewFailedBody)}</p>`)
}

function baseHtml (title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body { font-family: sans-serif; padding: 24px; color: #333; }</style>
</head><body>${bodyHtml}</body></html>`
}

function buildPreviewHtml (layout: Layout, imageDataUrl: string, labels: PrintPreviewLabels): string {
  const pageSize = CSS_PAGE_SIZE[layout.pageSize] ?? CSS_PAGE_SIZE.letter
  const orientation = layout.orientation === 'landscape' ? 'landscape' : 'portrait'
  const title = escapeHtml(layout.name || 'Preview')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: ${pageSize} ${orientation}; margin: 0; }
  html, body { margin: 0; padding: 0; background: #cccccc; height: 100%; }
  body { display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; }
  .toolbar {
    position: sticky; top: 0; z-index: 1; flex-shrink: 0;
    display: flex; justify-content: flex-end; align-items: center;
    padding: 10px 16px; background: #2b2b2b;
    font-family: sans-serif; font-size: 14px;
  }
  .toolbar button {
    padding: 6px 14px; border-radius: 4px; border: none; cursor: pointer;
    font-size: 13px; color: #fff; background: #555;
  }
  /* The whole page fits on screen at once, scaled down as needed. */
  .page-wrap {
    flex: 1; min-height: 0; overflow: auto; box-sizing: border-box;
    display: flex; justify-content: center; align-items: center; padding: 24px;
  }
  img {
    max-width: 100%; max-height: 100%; object-fit: contain;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.2); background: #fff; display: block;
  }
  @media print {
    .toolbar { display: none; }
    html, body { background: #fff; height: auto; }
    body { display: block; }
    .page-wrap { flex: none; overflow: visible; display: block; padding: 0; }
    img { max-width: none; max-height: none; width: 100%; box-shadow: none; object-fit: fill; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="closeButton" type="button">${escapeHtml(labels.close)}</button>
  </div>
  <div class="page-wrap">
    <img src="${imageDataUrl}" alt="${title}">
  </div>
  <script>
    document.getElementById('closeButton').addEventListener('click', function () { window.close() })
  </script>
</body>
</html>`
}

function escapeHtml (value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
