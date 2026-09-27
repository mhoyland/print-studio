import type { NorthArrowElement } from '../../config'
import type { Painter } from './painter'

export function renderNorthArrow (ctx: Painter, element: NorthArrowElement, view?: __esri.MapView | __esri.SceneView): void {
  const isVisible = element.visible ?? true
  if (!isVisible) return

  const rotation = element.syncToMapRotation ? getViewRotationDegrees(view) : element.rotation
  const cx = element.x + element.w / 2
  const cy = element.y + element.h / 2
  const size = Math.min(element.w, element.h)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.fillStyle = element.color
  ctx.strokeStyle = element.color

  switch (element.style) {
    case 'minimal':
      drawMinimal(ctx, size)
      break
    case 'compass':
      drawCompass(ctx, size)
      break
    case 'compassRose':
      drawCompassRose(ctx, size)
      break
    case 'classic':
      drawClassic(ctx, size)
  }

  ctx.restore()
}

function getViewRotationDegrees (view?: __esri.MapView | __esri.SceneView): number {
  if (!view) return 0
  if ('rotation' in view) return (view as __esri.MapView).rotation ?? 0
  const sceneView = view as __esri.SceneView
  return sceneView.camera ? (360 - sceneView.camera.heading) % 360 : 0
}

function drawClassic (ctx: Painter, size: number): void {
  ctx.beginPath()
  ctx.moveTo(0, -size / 2)
  ctx.lineTo(size / 4, size / 2)
  ctx.lineTo(0, size / 4)
  ctx.lineTo(-size / 4, size / 2)
  ctx.closePath()
  ctx.fill()
}

function drawMinimal (ctx: Painter, size: number): void {
  ctx.lineWidth = Math.max(1, size / 20)
  ctx.beginPath()
  ctx.moveTo(0, size / 2)
  ctx.lineTo(0, -size / 2)
  ctx.moveTo(-size / 6, -size / 3)
  ctx.lineTo(0, -size / 2)
  ctx.lineTo(size / 6, -size / 3)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.font = `${Math.round(size / 4)}px sans-serif`
  ctx.fillText('N', 0, -size / 2 - 2)
}

function drawCompass (ctx: Painter, size: number): void {
  const r = size / 2
  ctx.lineWidth = Math.max(1, size / 20)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, -r * 0.75)
  ctx.lineTo(r * 0.18, 0)
  ctx.lineTo(0, r * 0.55)
  ctx.lineTo(-r * 0.18, 0)
  ctx.closePath()
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.font = `${Math.round(size / 6)}px sans-serif`
  ctx.fillText('N', 0, -r - 2)
}

function drawCompassRose (ctx: Painter, size: number): void {
  const r = size / 2
  ctx.lineWidth = Math.max(1, size / 24)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()

  const points = [
    { angle: 0, long: true },
    { angle: 90, long: false },
    { angle: 180, long: false },
    { angle: 270, long: false }
  ]
  for (const point of points) {
    const outer = point.long ? r * 0.95 : r * 0.7
    const inner = r * 0.15
    const rad = (point.angle * Math.PI) / 180
    ctx.beginPath()
    ctx.moveTo(Math.sin(rad) * outer, -Math.cos(rad) * outer)
    ctx.lineTo(Math.sin(rad + 0.12) * inner, -Math.cos(rad + 0.12) * inner)
    ctx.lineTo(Math.sin(rad - 0.12) * inner, -Math.cos(rad - 0.12) * inner)
    ctx.closePath()
    ctx.fill()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.font = `${Math.round(size / 6)}px sans-serif`
  ctx.fillText('N', 0, -r - 2)
}
