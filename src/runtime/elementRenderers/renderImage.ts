import type { ImageElement } from '../../config'
import { paintContainer } from './paintContainer'
import type { Painter } from './painter'

// `image` is preloaded by exportRenderer.ts and handed in — ImageElement itself only stores the source string.
export function renderImage (ctx: Painter, element: ImageElement, image?: HTMLImageElement): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return
  paintContainer(ctx, element)
  if (!image) return

  ctx.save()
  const { x, y, w, h } = fitImage(image, element)
  ctx.drawImage(image, x, y, w, h)
  ctx.restore()
}

function fitImage (image: HTMLImageElement, element: ImageElement): { x: number; y: number; w: number; h: number } {
  if (!element.lockAspect || !image.width || !image.height) {
    return { x: element.x, y: element.y, w: element.w, h: element.h }
  }
  const scale = Math.min(element.w / image.width, element.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  return { x: element.x + (element.w - w) / 2, y: element.y + (element.h - h) / 2, w, h }
}
