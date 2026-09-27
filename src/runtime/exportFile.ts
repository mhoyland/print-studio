import { paintToCanvas, prepareLayout, type RenderOptions } from './exportRenderer'
import type { CaptureWarning } from './mapCapture'

// Output formats offered by the widget's Format choice (like the built-in Print widget's).
export type ExportFormat = 'jpg' | 'pdf' | 'png'
export type ImageFormat = Exclude<ExportFormat, 'pdf'>

// JPEG quality for jpg exports: small files, with text and lines still clean at ~300dpi.
const JPEG_QUALITY = 0.9

// Layout names are free text; strip the characters Windows and macOS don't allow in file names.
export function toFileName (layoutName: string, format: ExportFormat): string {
  const base = (layoutName ?? '').replace(/[\\/:*?"<>|]+/g, '-').trim()
  return `${base || 'map'}.${format}`
}

// Saves a blob as a download.
export function downloadBlob (blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser time to start reading the blob before it is released.
  setTimeout(() => { URL.revokeObjectURL(url) }, 60000)
}

// The page canvas is painted on a white background (paintToCanvas), so a JPEG — which has no
// transparency — comes out exactly like the PNG.
export async function canvasToImageBlob (canvas: HTMLCanvasElement, format: ImageFormat): Promise<Blob> {
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error(`Could not encode the ${format} image.`)) }, mimeType, JPEG_QUALITY)
  })
}

// Image export (the Export button with File format = jpg or png): the whole page at ~300dpi, the
// same image the Preview tab shows.
export async function exportLayoutToImage (options: RenderOptions & { fileName: string; format: ImageFormat }): Promise<CaptureWarning[]> {
  const prepared = await prepareLayout(options)
  downloadBlob(await canvasToImageBlob(paintToCanvas(prepared), options.format), options.fileName)
  return prepared.captureWarnings
}
