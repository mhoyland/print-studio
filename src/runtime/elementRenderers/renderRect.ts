import type { RectElement } from '../../config'
import { paintContainer } from './paintContainer'
import type { Painter } from './painter'

// A rect is nothing more than the shared border/fill/cornerRadius styling on a plain box —
// used for neatlines (no fill, sent to back) and callout boxes alike.
export function renderRect (ctx: Painter, element: RectElement): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return
  paintContainer(ctx, element)
}
