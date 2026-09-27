import { geoViewportDictionary, geoViewportsEntry, pdfString, type GeoViewport } from '../src/runtime/pdf/geoPdfDictionary'

const viewport: GeoViewport = {
  name: 'Map frame',
  bbox: { llx: 19.2, lly: 172.8, urx: 592.8, ury: 734.4 },
  corners: {
    bottomLeft: { lat: -41.3, lon: 174.75 },
    topLeft: { lat: -41.27, lon: 174.75 },
    topRight: { lat: -41.27, lon: 174.8 },
    bottomRight: { lat: -41.3, lon: 174.8 }
  },
  gcs: { type: 'PROJCS', epsg: 3857 }
}

describe('geoViewportDictionary', () => {
  const dict = geoViewportDictionary(viewport)

  it('is a /GEO measured viewport over the map frame', () => {
    expect(dict).toMatch(/^<< \/Type \/Viewport /)
    expect(dict).toContain('/BBox [19.2 172.8 592.8 734.4]')
    expect(dict).toContain('/Measure << /Type /Measure /Subtype /GEO')
    expect(dict).toContain('/Name (Map frame)')
  })

  it('pairs unit-square points with lat/lon corners in the same order (BL, TL, TR, BR)', () => {
    expect(dict).toContain('/LPTS [0 0 0 1 1 1 1 0]')
    expect(dict).toContain('/Bounds [0 0 0 1 1 1 1 0]')
    expect(dict).toContain('/GPTS [-41.3 174.75 -41.27 174.75 -41.27 174.8 -41.3 174.8]')
  })

  it('declares the coordinate system', () => {
    expect(dict).toContain('/GCS << /Type /PROJCS /EPSG 3857 >>')
    const withWkt = geoViewportDictionary({ ...viewport, gcs: { type: 'GEOGCS', wkt: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]' } })
    expect(withWkt).toContain('/GCS << /Type /GEOGCS /WKT (GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]) >>')
  })

  it('balances its dictionary delimiters', () => {
    expect((dict.match(/<</g) ?? []).length).toBe((dict.match(/>>/g) ?? []).length)
  })

  it('never writes numbers in exponent notation', () => {
    const tiny = geoViewportDictionary({ ...viewport, bbox: { llx: 1e-9, lly: 0, urx: 1, ury: 1 } })
    expect(tiny).not.toMatch(/\de[+-]?\d/)
  })
})

describe('geoViewportsEntry', () => {
  it('wraps viewports in the page-level /VP array', () => {
    expect(geoViewportsEntry([viewport])).toBe(`/VP [${geoViewportDictionary(viewport)}]`)
  })
})

describe('pdfString', () => {
  it('escapes parentheses and backslashes and drops non-ASCII', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)')
    expect(pdfString('Whangārei')).toBe('(Whangrei)')
  })
})
