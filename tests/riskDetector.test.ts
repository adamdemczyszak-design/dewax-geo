import { describe, it, expect } from 'vitest'
import { detectRisks, normalizePl, RISK_RULES } from '../server/report/riskDetector'
import type { BoreholeDetail, GroundwaterPoint } from '../server/types'

function bh(layers: Array<[number, number, string]>, cbdgId = 1, distanceM = 120): BoreholeDetail {
  return {
    cbdgId,
    name: `OTWOR-${cbdgId}`,
    lat: 52.23,
    lon: 21.01,
    distanceM,
    finalDepthM: null,
    elevationM: null,
    drillingYear: null,
    drillingPurpose: null,
    stratigraphyAtBottom: null,
    locality: null,
    commune: null,
    county: null,
    voivodeship: null,
    locationBasis: null,
    locationQuality: { cls: 'mapowa', uncertaintyM: 100, basis: null, note: 'test' },
    foundInRadiusM: 200,
    sourceId: 'CBDG_OTWORY_MAPSERVER',
    sourceUrl: 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/cbdg_otwory/MapServer/0',
    lithology: layers.map(([fromM, toM, description]) => ({
      fromM,
      toM,
      description,
      descriptionBasis: null,
      chronostratigraphy: null,
      lithostratigraphy: null,
    })),
    stratigraphy: [],
    lithologyMaxDepthM: null,
    lithologyProfileName: null,
    lithologySourceNote: null,
    notes: [],
    detailSourceUrl: `https://otworywiertnicze.pgi.gov.pl/boreholes/${cbdgId}`,
  }
}

function gw(over: Partial<GroundwaterPoint>): GroundwaterPoint {
  return {
    id: 1,
    name: 'PSH-1',
    lat: 52.23,
    lon: 21.01,
    distanceM: 400,
    drilledLevelM: null,
    stabilisedLevelM: null,
    measuredLevelM: null,
    measurementDate: null,
    aquiferTopM: null,
    aquiferBottomM: null,
    lithology: null,
    chronostratigraphy: null,
    mediumType: null,
    yieldLps: null,
    boreholeDepthM: null,
    sourceId: 'PSH_MONITORING_WOD',
    sourceUrl: 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/hydrogeologia/mwp/MapServer/0',
    ...over,
  }
}

const codes = (r: ReturnType<typeof detectRisks>) => r.found.map((f) => f.code)

describe('normalizePl', () => {
  it('usuwa polskie znaki diakrytyczne', () => {
    expect(normalizePl('Iły Poznańskie, żwir, ŁUPEK')).toBe('ily poznanskie, zwir, lupek')
  })
  it('normalizuje biale znaki', () => {
    expect(normalizePl('  piasek   drobny \n ')).toBe('piasek drobny')
  })
})

describe('detectRisks - litologia', () => {
  it('wykrywa kurzawke', () => {
    const r = detectRisks({ boreholes: [bh([[12, 18, 'piasek pylasty - kurzawka']])] })
    expect(codes(r)).toContain('KURZAWKA')
    const f = r.found.find((x) => x.code === 'KURZAWKA')!
    expect(f.severity).toBe('wysokie')
    expect(f.matches[0].evidence).toMatchObject({ cbdgId: 1, distanceM: 120, fromM: 12, toM: 18 })
  })

  it('wykrywa piaski nawodnione', () => {
    const r = detectRisks({ boreholes: [bh([[20, 35, 'Piaski średnioziarniste nawodnione']])] })
    expect(codes(r)).toContain('PIASKI_NAWODNIONE')
  })

  it('nie zglasza nawodnienia, gdy opis mowi o braku wody', () => {
    const r = detectRisks({ boreholes: [bh([[20, 35, 'piasek suchy, brak wody']])] })
    expect(codes(r)).not.toContain('PIASKI_NAWODNIONE')
  })

  it('wykrywa ily poznanskie i ily pstre', () => {
    const r1 = detectRisks({ boreholes: [bh([[25, 90, 'iły poznańskie, pstre']])] })
    expect(codes(r1)).toContain('ILY_POZNANSKIE')
    const r2 = detectRisks({ boreholes: [bh([[25, 90, 'ił pstry (szaro-rdzawy)']])] })
    expect(codes(r2)).toContain('ILY_POZNANSKIE')
  })

  it('wykrywa kras i pustki', () => {
    const r = detectRisks({ boreholes: [bh([[40, 60, 'wapień skrasowiały z pustkami']])] })
    expect(codes(r)).toContain('KRAS')
  })

  it('wykrywa anhydryty i gipsy', () => {
    const r = detectRisks({ boreholes: [bh([[80, 95, 'anhydryt z wkładkami gipsu']])] })
    expect(codes(r)).toContain('ANHYDRYT_GIPS')
  })

  it('wykrywa skaly twarde', () => {
    const r = detectRisks({ boreholes: [bh([[60, 100, 'granit gruboziarnisty']])] })
    expect(codes(r)).toContain('SKALY_TWARDE')
  })

  it('wykrywa glazy i otoczaki', () => {
    const r = detectRisks({ boreholes: [bh([[4, 7, 'glina zwałowa z otoczakami i głazami']])] })
    expect(codes(r)).toContain('GLAZY_OTOCZAKI')
  })

  it('wykrywa grunty organiczne', () => {
    const r = detectRisks({ boreholes: [bh([[0, 2, 'torf i namuł organiczny']])] })
    expect(codes(r)).toContain('TORF_GRUNT_ORGANICZNY')
  })

  it('nie zglasza ryzyk przy neutralnym opisie', () => {
    const r = detectRisks({ boreholes: [bh([[0, 100, 'piasek średnioziarnisty']])] })
    expect(r.found).toHaveLength(0)
    expect(r.notFound).toHaveLength(RISK_RULES.length)
  })

  it('ignoruje warstwy ponizej glebokosci docelowej', () => {
    const r = detectRisks({
      boreholes: [bh([[0, 100, 'piasek'], [150, 180, 'anhydryt']])],
      targetDepthM: 100,
    })
    expect(codes(r)).not.toContain('ANHYDRYT_GIPS')
  })

  it('zbiera trafienia z wielu otworow w jedna kategorie', () => {
    const r = detectRisks({
      boreholes: [
        bh([[10, 20, 'kurzawka']], 111, 80),
        bh([[30, 40, 'grunt upłynniony']], 222, 300),
      ],
    })
    const f = r.found.find((x) => x.code === 'KURZAWKA')!
    expect(f.matches).toHaveLength(2)
    expect(f.matches.map((m) => m.evidence.cbdgId).sort()).toEqual([111, 222])
  })

  it('nie duplikuje tego samego trafienia', () => {
    const r = detectRisks({ boreholes: [bh([[10, 20, 'kurzawka kurzawka']])] })
    expect(r.found.find((x) => x.code === 'KURZAWKA')!.matches).toHaveLength(1)
  })

  it('sortuje ryzyka od najpowazniejszych', () => {
    const r = detectRisks({
      boreholes: [bh([[0, 2, 'torf'], [10, 20, 'kurzawka']])],
    })
    expect(r.found[0].severity).toBe('wysokie')
  })

  it('zwraca liste ryzyk sprawdzonych i niepotwierdzonych', () => {
    const r = detectRisks({ boreholes: [bh([[10, 20, 'kurzawka']])] })
    expect(r.notFound.map((n) => n.code)).not.toContain('KURZAWKA')
    expect(r.found.length + r.notFound.length).toBe(RISK_RULES.length)
  })

  it('kazde trafienie ma pelny komplet dowodow', () => {
    const r = detectRisks({ boreholes: [bh([[12, 18, 'kurzawka']], 777, 45)] })
    const m = r.found[0].matches[0]
    expect(m.evidence.cbdgId).toBe(777)
    expect(m.evidence.distanceM).toBe(45)
    expect(m.evidence.sourceUrl).toContain('otworywiertnicze.pgi.gov.pl/boreholes/777')
    expect(m.keyword).toBeTruthy()
    expect(m.matchedText).toContain('kurzawka')
  })
})

describe('detectRisks - pomiary zwierciadla wody (PSH)', () => {
  it('wykrywa samowyplyw przy ujemnym zwierciadle ustalonym', () => {
    const r = detectRisks({ boreholes: [], groundwater: [gw({ stabilisedLevelM: -1.5 })] })
    expect(codes(r)).toContain('ARTEZYJSKIE')
    expect(r.found[0].matches[0].matchedText).toContain('samowypływ')
  })

  it('wykrywa zwierciadlo napiete, gdy ustalone jest plytsze od nawierconego', () => {
    const r = detectRisks({
      boreholes: [],
      groundwater: [gw({ drilledLevelM: 32, stabilisedLevelM: 6 })],
    })
    expect(codes(r)).toContain('ARTEZYJSKIE')
  })

  it('nie zglasza naporowosci przy roznicy ponizej 1 m', () => {
    const r = detectRisks({
      boreholes: [],
      groundwater: [gw({ drilledLevelM: 8, stabilisedLevelM: 7.5 })],
    })
    expect(codes(r)).not.toContain('ARTEZYJSKIE')
  })

  it('laczy dowody z litologii i z pomiarow w jednej kategorii', () => {
    const r = detectRisks({
      boreholes: [bh([[30, 45, 'woda artezyjska nawiercona']])],
      groundwater: [gw({ stabilisedLevelM: -0.5 })],
    })
    const f = r.found.find((x) => x.code === 'ARTEZYJSKIE')!
    expect(f.matches).toHaveLength(2)
    expect(f.matches.map((m) => m.evidence.sourceId)).toContain('PSH_MONITORING_WOD')
    expect(f.matches.map((m) => m.evidence.sourceId)).toContain('CBDG_OTWORY_REST')
  })
})
