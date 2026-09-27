import type { LayoutElement } from '../../config'
import type { AddableElementType } from './Toolbar'
import type { ElementBounds } from './ElementWrapper'

export const DEFAULT_SIZE: { [type in AddableElementType]: { w: number; h: number } } = {
  text: { w: 300, h: 40 },
  rect: { w: 150, h: 100 },
  northArrow: { w: 60, h: 60 },
  image: { w: 150, h: 80 },
  scaleBar: { w: 250, h: 30 },
  legend: { w: 300, h: 120 },
  attributeTable: { w: 320, h: 160 },
  popup: { w: 260, h: 180 }
}

// New elements are appended (so zIndex = elements.length puts them on top, matching the array-order
// invariant). `bounds`, when given (from click/drag placement on the canvas), overrides the default
// cascade position and per-type default size — used when the designer draws the element directly
// rather than picking a tool and getting an auto-placed default.
export function createDefaultElement (type: AddableElementType, existingElements: LayoutElement[], bounds?: ElementBounds): LayoutElement {
  const sameTypeCount = existingElements.filter((element) => element.type === type).length
  const cascade = existingElements.length % 6
  const size = DEFAULT_SIZE[type]
  const base = {
    id: crypto.randomUUID(),
    x: bounds?.x ?? (60 + cascade * 24),
    y: bounds?.y ?? (60 + cascade * 24),
    w: bounds?.w ?? size.w,
    h: bounds?.h ?? size.h,
    zIndex: existingElements.length,
    visible: true,
    locked: false
  }

  switch (type) {
    case 'text':
      return {
        ...base,
        name: `Text ${sameTypeCount + 1}`,
        type: 'text',
        text: 'New text',
        fontFamily: 'Arial',
        fontSize: 16,
        fontWeight: 400,
        color: '#000000',
        align: 'left'
      }
    case 'rect':
      return {
        ...base,
        name: `Rectangle ${sameTypeCount + 1}`,
        type: 'rect',
        strokeColor: '#000000',
        strokeWidth: 1,
        cornerRadius: 0
      }
    case 'northArrow':
      return {
        ...base,
        name: `North arrow ${sameTypeCount + 1}`,
        type: 'northArrow',
        style: 'classic',
        color: '#000000',
        rotation: 0,
        syncToMapRotation: true
      }
    case 'image':
      return {
        ...base,
        name: `Image ${sameTypeCount + 1}`,
        type: 'image',
        source: 'upload',
        lockAspect: true
      }
    case 'scaleBar':
      return {
        ...base,
        name: `Scale bar ${sameTypeCount + 1}`,
        type: 'scaleBar',
        unit: 'km',
        style: 'line'
      }
    case 'legend':
      return {
        ...base,
        name: `Legend ${sameTypeCount + 1}`,
        type: 'legend',
        autoFitHeight: false,
        columns: 1
      }
    case 'attributeTable':
      return {
        ...base,
        name: `Attribute table ${sameTypeCount + 1}`,
        type: 'attributeTable',
        fields: [],
        // A table reads as unfinished without a bounding box — most other element types default to
        // no border, but this one gets a subtle one out of the box, matching the boxed-table look
        // being matched here (still fully overridable via the shared Container section).
        strokeColor: '#cccccc',
        strokeWidth: 1
      }
    case 'popup':
      return {
        ...base,
        name: `Feature popup ${sameTypeCount + 1}`,
        type: 'popup',
        fields: [],
        strokeColor: '#cccccc',
        strokeWidth: 1
      }
  }
}
