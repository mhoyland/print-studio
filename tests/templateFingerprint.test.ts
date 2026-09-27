import { layoutFingerprint, templateFileStatus } from '../src/runtime/templateFingerprint'
import { createBlankLayout, duplicateLayout } from '../src/runtime/templateFactory'

describe('layoutFingerprint', () => {
  const layout = createBlankLayout('My template', { mapFrameLocked: false })

  it('ignores the template id and Portal link, so an imported copy of a file matches it', () => {
    const imported = { ...JSON.parse(JSON.stringify(layout)), id: 'new-id', portalItemId: 'abc' }
    expect(layoutFingerprint(imported)).toBe(layoutFingerprint(layout))
  })

  it('ignores key order, so equal content always matches', () => {
    const reordered = { elements: layout.elements, orientation: layout.orientation, pageSize: layout.pageSize, name: layout.name, id: layout.id }
    expect(layoutFingerprint(reordered)).toBe(layoutFingerprint(layout))
  })

  it('changes when the content changes', () => {
    const moved = duplicateLayout(layout, layout.name)
    moved.elements[0].x += 1
    expect(layoutFingerprint(moved)).not.toBe(layoutFingerprint(layout))
    expect(layoutFingerprint({ ...layout, name: 'Renamed' })).not.toBe(layoutFingerprint(layout))
  })
})

describe('templateFileStatus', () => {
  const layout = createBlankLayout('My template', { mapFrameLocked: false })
  it('reports not saved, saved, and changed since saved', () => {
    expect(templateFileStatus(layout, undefined)).toBe('notSaved')
    const saved = layoutFingerprint(layout)
    expect(templateFileStatus(layout, saved)).toBe('saved')
    expect(templateFileStatus({ ...layout, orientation: 'landscape' }, saved)).toBe('changed')
  })
})
