// Turns a legend symbol preview (the HTML element the ArcGIS Maps SDK draws for the Legend widget: an
// <svg>, <img> or <canvas>) into a canvas the legend renderer can draw like any other image, on screen,
// in the PNG/JPG export and in the PDF. This is what lets picture marker and CIM symbols (icons, symbols
// built in ArcGIS Pro) print as they look in the Legend widget instead of as a flat colour swatch.
//
// The canvas must stay readable (not "tainted") or the PNG/JPG export can't read the page back, so an SVG's
// linked images are fetched and embedded first, and anything that still taints the canvas is dropped (the
// legend then falls back to its colour swatch for that symbol).

export interface SymbolImage {
  canvas: HTMLCanvasElement
  // The preview's own size in CSS px, as the Legend widget shows it.
  width: number
  height: number
}

// Drawn this many times larger than its CSS size, so symbols stay sharp at print resolution (~300 dpi).
const RESOLUTION = 4
const MAX_SIZE = 200 // CSS px; anything larger is scaled down to fit

export async function previewToImage (preview: Element | null | undefined): Promise<SymbolImage | null> {
  if (!preview) return null
  try {
    const canvas = preview instanceof HTMLCanvasElement ? preview : preview.querySelector('canvas')
    if (canvas) {
      const ratio = window.devicePixelRatio || 1
      return copyCanvas(canvas, Number.parseFloat(canvas.style.width) || canvas.width / ratio, Number.parseFloat(canvas.style.height) || canvas.height / ratio)
    }

    const svg = preview instanceof SVGSVGElement ? preview : preview.querySelector('svg')
    if (svg) return await svgToImage(svg)

    const img = preview instanceof HTMLImageElement ? preview : preview.querySelector('img')
    if (img?.src) {
      const loaded = await loadImage(img.src)
      return copyCanvas(loaded, img.width || loaded.naturalWidth, img.height || loaded.naturalHeight)
    }
  } catch (err) {
    console.warn('print-studio: could not draw a legend symbol', err)
  }
  return null
}

async function svgToImage (svg: SVGSVGElement): Promise<SymbolImage | null> {
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || svg.viewBox?.baseVal?.width || 0
  const height = Number.parseFloat(svg.getAttribute('height') ?? '') || svg.viewBox?.baseVal?.height || 0
  if (!width || !height) return null

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  // An SVG drawn as an image can't load anything it links to, so linked pictures are embedded.
  await Promise.all(Array.from(clone.querySelectorAll('image')).map(async (image) => {
    const href = image.getAttribute('href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (!href || href.startsWith('data:')) return
    image.setAttribute('href', await toDataUrl(href))
    image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
  }))

  const markup = new XMLSerializer().serializeToString(clone)
  const loaded = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)
  return copyCanvas(loaded, width, height)
}

async function toDataUrl (url: string): Promise<string> {
  const response = await fetch(url, { mode: 'cors' })
  if (!response.ok) throw new Error(`${response.status} loading ${url}`)
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(reader.result as string) }
    reader.onerror = () => { reject(reader.error) }
    reader.readAsDataURL(blob)
  })
}

async function loadImage (src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  return image
}

function copyCanvas (source: CanvasImageSource, cssWidth: number, cssHeight: number): SymbolImage | null {
  if (!(cssWidth > 0) || !(cssHeight > 0)) return null
  const fit = Math.min(1, MAX_SIZE / Math.max(cssWidth, cssHeight))
  const width = cssWidth * fit
  const height = cssHeight * fit
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * RESOLUTION))
  canvas.height = Math.max(1, Math.round(height * RESOLUTION))
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  try {
    ctx.getImageData(0, 0, 1, 1) // throws if the canvas is tainted, which would break the PNG/JPG export
  } catch {
    return null
  }
  return { canvas, width, height }
}
