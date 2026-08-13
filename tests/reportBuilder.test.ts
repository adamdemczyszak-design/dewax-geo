import { describe, it, expect } from 'vitest'
import { rankForDetailFetch, NEAR_FIRST, buildHydroStatements, NO_DATA_TEXT, plural } from '../server/report/reportBuilder'
import { parseArcGisDate } from '../server/cbdg/boreholeSearch'
import type { GroundwaterPoint, HydroContextArea } from '../server/types'

describe('plural - polska odmiana liczebnikow', () => {
  const OTWOR: [string, string, string] = ['otwór', 'otwory', 'otworów']
  it('1 -> forma pojedyncza', () => expect(plural(1, OTWOR)).toBe('otwór'))
  it('2-4 -> forma mnoga', () => {
    expect(plural(2, OTWOR)).toBe('otwory')
    expect(plural(3, OTWOR)).toBe('otwory')
    expect(plural(4, OTWOR)).toBe('otwory')
  })
  it('0 i 5-21 -> dopelniacz', () => {
    expect(plural(0, OTWOR)).toBe('otworów')
    expect(plural(5, OTWOR)).toBe('otworów')
    expect(plural(11, OTWOR)).toBe('otworów')
    expect(plural(21, OTWOR)).toBe('otworów')
  })
  it('nastolatki 12-14 zawsze dopelniacz', () => {
    expect(plural(12, OTWOR)).toBe('otworów')
    expect(plural(13, OTWOR)).toBe('otworów')
    expect(plural(14, OTWOR)).toBe('otworów')
  })
  it('22-24 i 102-104 -> forma mnoga', () => {
    expect(plural(22, OTWOR)).toBe('otwory')
    expect(plural(103, OTWOR)).toBe('otwory')
  })
})

describe('parseArcGisDate', () => {
  it('epoch w sekundach -> data ISO', () => {
    expect(parseArcGisDate(1782770400)).toBe('2026-06-30')
  })
  it('epoch w milisekundach -> data ISO', () => {
    expect(parseArcGisDate(1782770400000)).toBe('2026-06-30')
  })
  it('tekst ISO zostaje przyciety do daty', () => {
    expect(parseArcGisDate('1973-12-31T00:00:00')).toBe('1973-12-31')
  })
  it('null i pusty tekst -> null', () => {
    expect(parseArcGisDate(null)).toBeNull()
    expect(parseArcGisDate('')).toBeNull()
  })
  it('nigdy nie zwraca surowej liczby epoch', () => {
    expect(parseArcGisDate(1782770400)).not.toMatch(/^\d{10}$/)
  })
})

const s = (distanceM: number, finalDepthM: number | null) => ({ distanceM, finalDepthM })

describe('rankForDetailFetch - kolejnosc pobierania profili', () => {
  it('najpierw pobiera najblizsze otwory, niezaleznie od glebokosci', () => {
    const input = [s(500, 300), s(10, 5), s(20, 8)]
    const out = rankForDetailFetch(input, 100)
    expect(out.slice(0, 3).map((x) => x.distanceM)).toEqual([10, 20, 500])
  })

  it('po najblizszych priorytet maja otwory siegajace glebokosci docelowej', () => {
    const near = Array.from({ length: NEAR_FIRST }, (_, i) => s(i + 1, 20))
    const shallowFar = s(100, 30)
    const deepFarther = s(900, 250)
    const out = rankForDetailFetch([...near, shallowFar, deepFarther], 100)
    expect(out[NEAR_FIRST].distanceM).toBe(900) // gleboki przed plytkim, mimo wiekszej odleglosci
    expect(out[NEAR_FIRST + 1].distanceM).toBe(100)
  })

  it('nie odklada glebokiego otworu za dziesiatki plytkich sasiadow', () => {
    const shallowSwarm = Array.from({ length: 40 }, (_, i) => s(10 + i, 25))
    const deep = s(480, 260)
    const out = rankForDetailFetch([...shallowSwarm, deep], 100)
    // gleboki otwor musi trafic do pobrania w pierwszej dziesiatce, inaczej
    // budzet zjedza plytkie otwory i profil nigdy nie siega glebokosci docelowej
    expect(out.findIndex((x) => x.distanceM === 480)).toBeLessThan(10)
  })

  it('otwory gleboksze sortowane sa miedzy soba wg odleglosci', () => {
    const near = Array.from({ length: NEAR_FIRST }, (_, i) => s(i + 1, 10))
    const out = rankForDetailFetch([...near, s(3000, 200), s(800, 150)], 100)
    expect(out[NEAR_FIRST].distanceM).toBe(800)
    expect(out[NEAR_FIRST + 1].distanceM).toBe(3000)
  })

  it('otwory o nieznanej glebokosci traktowane sa jako plytkie', () => {
    const near = Array.from({ length: NEAR_FIRST }, (_, i) => s(i + 1, 10))
    const out = rankForDetailFetch([...near, s(200, null), s(700, 400)], 100)
    expect(out[NEAR_FIRST].distanceM).toBe(700)
  })

  it('nie gubi ani nie duplikuje otworow', () => {
    const input = [s(5, 10), s(50, 200), s(500, 20), s(1, 1), s(9999, 999)]
    const out = rankForDetailFetch(input, 100)
    expect(out).toHaveLength(input.length)
    expect(new Set(out.map((x) => x.distanceM)).size).toBe(input.length)
  })
})

const gw = (over: Partial<GroundwaterPoint>): GroundwaterPoint => ({
  id: 1,
  name: 'PSH-1',
  lat: 52,
  lon: 21,
  distanceM: 300,
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
})

describe('buildHydroStatements', () => {
  it('bez punktow monitoringu mowi wprost o braku danych', () => {
    const out = buildHydroStatements([], [], [], 2000)
    expect(out[0]).toContain(NO_DATA_TEXT)
    expect(out.some((s) => s.includes('nie leży w granicach GZWP'))).toBe(true)
  })

  it('opisuje zwierciadlo nawiercone i ustalone najblizszego punktu', () => {
    const out = buildHydroStatements([gw({ drilledLevelM: 12, stabilisedLevelM: 8 })], [], [], 2000)
    expect(out[0]).toContain('zwierciadło nawiercone 12 m p.p.t.')
    expect(out[0]).toContain('zwierciadło ustalone 8 m p.p.t.')
    expect(out[0]).toContain('300 m')
  })

  it('podaje strop i spag warstwy wodonosnej wraz z litologia', () => {
    const out = buildHydroStatements(
      [gw({ stabilisedLevelM: 5, aquiferTopM: 30, aquiferBottomM: 55, lithology: 'piaski' })],
      [],
      [],
      2000,
    )
    expect(out.some((s) => s.includes('strop 30 m, spąg 55 m'))).toBe(true)
    expect(out.some((s) => s.includes('piaski'))).toBe(true)
  })

  it('formatuje liczby dziesietne z przecinkiem', () => {
    const out = buildHydroStatements([gw({ drilledLevelM: 12.5, stabilisedLevelM: 8.2 })], [], [], 2000)
    expect(out[0]).toContain('12,5 m p.p.t.')
    expect(out[0]).toContain('8,2 m p.p.t.')
  })

  it('nie stawia podwojnej kropki po skrocie "p.p.t."', () => {
    const out = buildHydroStatements([gw({ stabilisedLevelM: 40 })], [], [], 2000)
    expect(out[0]).not.toContain('..')
    expect(out[0].endsWith('p.p.t.')).toBe(true)
  })

  it('odmienia czasownik: 2-4 punkty "znajduja sie", 5+ "znajduje sie"', () => {
    const many = (n: number) =>
      buildHydroStatements(
        Array.from({ length: n }, () => gw({ stabilisedLevelM: 5 })),
        [], [], 2000,
      ).find((s) => s.includes('monitoringu z pomiarem'))!
    expect(many(2)).toContain('znajdują się 2 punkty')
    expect(many(7)).toContain('znajduje się 7 punktów')
    expect(many(22)).toContain('znajdują się 22 punkty')
  })

  it('raportuje przynaleznosc do GZWP z numerem i nazwa', () => {
    const area: HydroContextArea = {
      layerLabel: 'GZWP udokumentowane',
      attributes: { NR: '215', NAZWA: 'Subniecka warszawska' },
      sourceId: 'CBDG_GZWP',
      sourceUrl: 'x',
    }
    const out = buildHydroStatements([], [area], [], 2000)
    expect(out.some((s) => s.includes('GZWP udokumentowane') && s.includes('nr 215'))).toBe(true)
  })
})
