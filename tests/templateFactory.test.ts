import { createBlankLayout, duplicateLayout, uniqueTemplateName } from '../src/runtime/templateFactory'

describe('createBlankLayout', () => {
  it('makes a Letter portrait page with one map frame, locked or not as asked', () => {
    const own = createBlankLayout('My template', { mapFrameLocked: false })
    expect(own.pageSize).toBe('letter')
    expect(own.orientation).toBe('portrait')
    expect(own.elements).toHaveLength(1)
    expect(own.elements[0]).toMatchObject({ type: 'mapFrame', locked: false, visible: true })
    expect(createBlankLayout('Designer', { mapFrameLocked: true }).elements[0].locked).toBe(true)
  })
})

describe('duplicateLayout', () => {
  it('returns an independent copy with a new id and name, without the Portal link', () => {
    const source = { ...createBlankLayout('Original', { mapFrameLocked: true }), portalItemId: 'abc' }
    const copy = duplicateLayout(source, 'Original copy')
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Original copy')
    expect(copy.portalItemId).toBeUndefined()
    copy.elements[0].x = 999
    expect(source.elements[0].x).not.toBe(999)
  })
})

describe('uniqueTemplateName', () => {
  const existing = [createBlankLayout('My template', { mapFrameLocked: false }), createBlankLayout('My template 2', { mapFrameLocked: false })]
  it('uses the base name when free, otherwise the next number', () => {
    expect(uniqueTemplateName('Other', existing)).toBe('Other')
    expect(uniqueTemplateName('My template', existing)).toBe('My template 3')
  })
})
