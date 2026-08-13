import { describe, it, expect } from 'vitest'
import { parseRangeField } from '../server/cbdg/mpgnClient'
import { sizeBoreholeField, describeMpgn } from '../server/report/sizing'
import { assessLocationQuality, locationWeight } from '../server/report/locationQuality'
import { assessCredibility } from '../server/report/credibility'
import { pickMpgnBracket } from '../server/endpoints'
import type { BoreholeDetail, MpgnData, SyntheticLayer } from '../server/types'

describe('parseRangeField - przedzialy MPGN', () => {
  it('czyta przedzial calkowity "40-45"', () => {
    expect(parseRangeField('40-45')).toEqual({ min: 40, max: 45, label: '40–45' })
  })
  it('czyta przedzial z przecinkiem dziesietnym "1,4-1,7"', () => {
    expect(parseRangeField('1,4-1,7')).toEqual({ min: 1.4, max: 1.7, label: '1,4–1,7' })
  })
  it('czyta pojedyncza wartosc', () => {
    expect(parseRangeField('50')).toEqual({ min: 50, max: 50, label: '50' })
  })
  it('zwraca null dla braku danych i smieci', () => {
    expect(parseRangeField(null)).toBeNull()
    expect(parseRangeField(undefined)).toBeNull()
    expect(parseRangeField('brak danych')).toBeNull()
  })
})

describe('pickMpgnBracket', () => {
  it('dobiera najblizszy opublikowany przedzial glebokosci', () => {
    expect(pickMpgnBracket(100).depthM).toBe(100)
    expect(pickMpgnBracket(95).depthM).toBe(100)
    expect(pickMpgnBracket(45).depthM).toBe(40)
    expect(pickMpgnBracket(150).depthM).toBe(130)
    expect(pickMpgnBracket(60).depthM).toBe(70)
  })
})

const mpgn = (over: Partial<MpgnData> = {}): MpgnData => ({
  bracketDepthM: 100,
  targetDepthM: 100,
  lambdaWmK: { min: 1.4, max: 1.7, label: '1,4–1,7' },
  qv1800Wm: { min: 40, max: 45, label: '40–45' },
  qv2100Wm: { min: 35, max: 40, label: '35–40' },
  sourceId: 'MPGN_GEOTERMIA',
  sourceUrl: 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geotermia/mpgn/MapServer',
  ...over,
})

describe('sizeBoreholeField - wstepny dobor dlugosci odwiertow', () => {
  it('liczy moc z gruntu wg wzoru P x (1 - 1/SCOP)', () => {
    const s = sizeBoreholeField({ mpgn: mpgn(), heatPumpKw: 12, scop: 4, singleBoreholeDepthM: 100 })!
    expect(s.groundLoadKw).toBe(9) // 12 * 0,75
  })

  it('dzieli moc z gruntu przez qv i zwraca przedzial metrow', () => {
    const s = sizeBoreholeField({ mpgn: mpgn(), heatPumpKw: 12, scop: 4, singleBoreholeDepthM: 100 })!
    // 9000 W / 45 = 200 m ; 9000 W / 40 = 225 m
    expect(s.totalMetresRange).toEqual({ min: 200, max: 225 })
  })

  it('wieksze qv daje mniej metrow (min/max sie nie odwracaja)', () => {
    const s = sizeBoreholeField({ mpgn: mpgn(), heatPumpKw: 12, singleBoreholeDepthM: 100 })!
    expect(s.totalMetresRange.min).toBeLessThan(s.totalMetresRange.max)
  })

  it('liczy liczbe odwiertow zaokraglajac w gore', () => {
    const s = sizeBoreholeField({ mpgn: mpgn(), heatPumpKw: 12, scop: 4, singleBoreholeDepthM: 100 })!
    expect(s.boreholeCountRange).toEqual({ min: 2, max: 3 })
  })

  it('uzywa qv dla 2100 h, gdy podano taki czas pracy', () => {
    const s = sizeBoreholeField({
      mpgn: mpgn(),
      heatPumpKw: 12,
      scop: 4,
      annualHours: 2100,
      singleBoreholeDepthM: 100,
    })!
    expect(s.qvWm.label).toBe('35–40')
    expect(s.annualHours).toBe(2100)
    // 9000/40 = 225 ; 9000/35 = 257 -> zaokraglone do 5
    expect(s.totalMetresRange).toEqual({ min: 225, max: 255 })
  })

  it('zwraca null, gdy MPGN nie ma qv dla tego punktu', () => {
    expect(
      sizeBoreholeField({
        mpgn: mpgn({ qv1800Wm: null }),
        heatPumpKw: 12,
        singleBoreholeDepthM: 100,
      }),
    ).toBeNull()
  })

  it('zwraca null przy braku mocy pompy', () => {
    expect(sizeBoreholeField({ mpgn: mpgn(), heatPumpKw: 0, singleBoreholeDepthM: 100 })).toBeNull()
  })

  it('ostrzega, gdy glebokosc otworu nie pokrywa sie z przedzialem MPGN', () => {
    const s = sizeBoreholeField({
      mpgn: mpgn({ bracketDepthM: 100 }),
      heatPumpKw: 12,
      singleBoreholeDepthM: 120,
    })!
    expect(s.assumptions.some((a) => a.includes('najbliższy dostępny przedział'))).toBe(true)
  })

  it('zawsze wypisuje zalozenia i zastrzezenie o TRT', () => {
    const s = sizeBoreholeField({ mpgn: mpgn(), heatPumpKw: 12, singleBoreholeDepthM: 100 })!
    expect(s.assumptions.some((a) => a.includes('TRT'))).toBe(true)
    expect(s.assumptions.some((a) => a.includes('MPGN'))).toBe(true)
  })
})

describe('describeMpgn', () => {
  it('podaje lambda i qv jako fakty ze zrodla', () => {
    const out = describeMpgn(mpgn())
    expect(out[0]).toContain('1,4–1,7')
    expect(out[0]).toContain('MPGN')
    expect(out[1]).toContain('40–45')
    expect(out[1]).toContain('1800 h')
  })
  it('mowi wprost o braku danych zamiast zgadywac', () => {
    const out = describeMpgn(mpgn({ lambdaWmK: null, qv1800Wm: null, qv2100Wm: null }))
    expect(out[0]).toContain('brak danych w sprawdzonym zakresie')
    expect(out[1]).toContain('brak danych w sprawdzonym zakresie')
  })
})

describe('assessLocationQuality', () => {
  it('rozpoznaje lokalizacje przybliona wg najblizszej miejscowosci', () => {
    const q = assessLocationQuality('współrzędne najbliższej miejscowości')
    expect(q.cls).toBe('przybliżona')
    expect(q.uncertaintyM).toBe(1000)
  })
  it('rozpoznaje lokalizacje mapowa', () => {
    expect(assessLocationQuality('szkic lokalizacyjny, mapa').cls).toBe('mapowa')
    expect(assessLocationQuality('mapa topograficzna').cls).toBe('mapowa')
  })
  it('rozpoznaje pomiar geodezyjny', () => {
    expect(assessLocationQuality('pomiar GPS').cls).toBe('geodezyjna')
  })
  it('brak podstawy lub "nie ustalono" -> nieznana', () => {
    expect(assessLocationQuality(null).cls).toBe('nieznana')
    expect(assessLocationQuality('nie ustalono').cls).toBe('nieznana')
  })
  it('waga dowodowa maleje wraz z jakoscia lokalizacji', () => {
    expect(locationWeight('geodezyjna')).toBeGreaterThan(locationWeight('mapowa'))
    expect(locationWeight('mapowa')).toBeGreaterThan(locationWeight('nieznana'))
    expect(locationWeight('nieznana')).toBeGreaterThan(locationWeight('przybliżona'))
  })
})

function layer(cbdgId: number, fromM: number, toM: number, distanceM: number): SyntheticLayer {
  return {
    fromM,
    toM,
    description: 'piasek',
    chronostratigraphy: null,
    noData: false,
    evidence: {
      cbdgId,
      boreholeName: `O-${cbdgId}`,
      distanceM,
      fromM,
      toM,
      sourceId: 'CBDG_OTWORY_REST',
      sourceUrl: 'x',
    },
  }
}

function detail(cbdgId: number, distanceM: number, cls: 'geodezyjna' | 'mapowa' | 'przybliżona'): BoreholeDetail {
  return {
    cbdgId,
    name: `O-${cbdgId}`,
    lat: 0,
    lon: 0,
    distanceM,
    finalDepthM: 200,
    elevationM: 100,
    drillingYear: 1960,
    drillingPurpose: null,
    stratigraphyAtBottom: null,
    locality: null,
    commune: null,
    county: null,
    voivodeship: null,
    locationBasis: null,
    locationQuality: { cls, uncertaintyM: 100, basis: null, note: '' },
    foundInRadiusM: distanceM,
    sourceId: 'CBDG_OTWORY_MAPSERVER',
    sourceUrl: 'x',
    lithology: [],
    stratigraphy: [],
    lithologyMaxDepthM: 200,
    lithologyProfileName: null,
    lithologySourceNote: null,
    notes: [],
    detailSourceUrl: 'x',
  }
}

describe('assessCredibility - ocena wiarygodnosci raportu', () => {
  it('jeden otwor daleko o slabej lokalizacji dostaje niska ocene mimo 100% pokrycia', () => {
    const c = assessCredibility({
      coveragePct: 100,
      layers: [layer(1, 0, 100, 521)],
      boreholes: [detail(1, 521, 'przybliżona')],
      targetDepthM: 100,
      elevationCorrected: false,
    })
    expect(c.score).toBeLessThan(60)
    expect(['niska', 'orientacyjna']).toContain(c.grade)
    expect(c.reasons.some((r) => r.includes('JEDNEGO otworu'))).toBe(true)
    expect(c.reasons.some((r) => r.includes('najbliższej miejscowości'))).toBe(true)
    expect(c.reasons.some((r) => r.includes('został skorygowany wysokościowo'))).toBe(true)
  })

  it('kilka bliskich otworow o dobrej lokalizacji dostaje wysoka ocene', () => {
    const c = assessCredibility({
      coveragePct: 100,
      layers: [layer(1, 0, 30, 60), layer(2, 30, 60, 80), layer(3, 60, 80, 90), layer(4, 80, 100, 95)],
      boreholes: [
        detail(1, 60, 'geodezyjna'),
        detail(2, 80, 'geodezyjna'),
        detail(3, 90, 'mapowa'),
        detail(4, 95, 'mapowa'),
      ],
      targetDepthM: 100,
      elevationCorrected: true,
    })
    expect(c.score).toBeGreaterThanOrEqual(78)
    expect(c.grade).toBe('wysoka')
  })

  it('brak jakichkolwiek danych daje ocene orientacyjna', () => {
    const c = assessCredibility({
      coveragePct: 0,
      layers: [{ fromM: 0, toM: 100, description: null, chronostratigraphy: null, noData: true, evidence: null }],
      boreholes: [],
      targetDepthM: 100,
      elevationCorrected: false,
    })
    expect(c.grade).toBe('orientacyjna')
    expect(c.reasons.some((r) => r.includes('Żaden otwór'))).toBe(true)
  })

  it('naglowek zawsze niesie zalecenie adekwatne do oceny', () => {
    const low = assessCredibility({
      coveragePct: 40,
      layers: [layer(1, 0, 40, 3000)],
      boreholes: [detail(1, 3000, 'przybliżona')],
      targetDepthM: 100,
      elevationCorrected: false,
    })
    expect(low.headline.length).toBeGreaterThan(20)
    expect(low.reasons.some((r) => r.includes('bez jakichkolwiek danych'))).toBe(true)
  })

  it('punktacja skladowa sumuje sie do wyniku', () => {
    const c = assessCredibility({
      coveragePct: 100,
      layers: [layer(1, 0, 100, 100)],
      boreholes: [detail(1, 100, 'mapowa')],
      targetDepthM: 100,
      elevationCorrected: true,
    })
    const b = c.breakdown
    const sum = b.coverage + b.boreholeCount + b.proximity + b.locationQuality + b.elevationCorrection
    expect(Math.round(sum)).toBe(c.score)
  })
})
