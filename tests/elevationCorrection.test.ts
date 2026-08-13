import { describe, it, expect } from 'vitest'
import { buildSyntheticProfile } from '../server/report/profileBuilder'
import type { BoreholeDetail } from '../server/types'

function bh(
  cbdgId: number,
  distanceM: number,
  elevationM: number | null,
  layers: Array<[number, number, string]>,
): BoreholeDetail {
  return {
    cbdgId,
    name: `OTWOR-${cbdgId}`,
    lat: 52.23,
    lon: 21.01,
    distanceM,
    finalDepthM: layers.length ? layers[layers.length - 1][1] : null,
    elevationM,
    drillingYear: null,
    drillingPurpose: null,
    stratigraphyAtBottom: null,
    locality: null,
    commune: null,
    county: null,
    voivodeship: null,
    locationBasis: null,
    locationQuality: { cls: 'mapowa', uncertaintyM: 100, basis: null, note: 'test' },
    foundInRadiusM: 500,
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
    lithologyMaxDepthM: layers.length ? Math.max(...layers.map((l) => l[1])) : null,
    lithologyProfileName: null,
    lithologySourceNote: null,
    notes: [],
    detailSourceUrl: `https://otworywiertnicze.pgi.gov.pl/boreholes/${cbdgId}`,
  }
}

describe('korekta wysokosciowa profilu', () => {
  it('bez rzednej dzialki profil pozostaje w ukladzie otworu', () => {
    const res = buildSyntheticProfile([bh(1, 100, 100, [[0, 20, 'piasek'], [20, 120, 'il']])], 100)
    expect(res.elevationCorrected).toBe(false)
    expect(res.layers[0].fromM).toBe(0)
    expect(res.layers[1].fromM).toBe(20)
  })

  it('otwor stojacy 5 m nizej: warstwy przesuwaja sie w dol o 5 m', () => {
    // Otwór na rzędnej 107,7; działka na 112,7 → strop warstwy z 0 m w otworze
    // leży na działce dopiero 5 m poniżej terenu.
    const res = buildSyntheticProfile(
      [bh(1, 500, 107.7, [[0, 20, 'piasek'], [20, 120, 'il']])],
      100,
      { siteElevationM: 112.7 },
    )
    expect(res.elevationCorrected).toBe(true)
    // 0-5 m: brak danych (otwór nie sięga tak wysoko w układzie działki)
    expect(res.layers[0].noData).toBe(true)
    expect(res.layers[0].fromM).toBe(0)
    expect(res.layers[0].toM).toBeCloseTo(5, 6)
    // piasek 0-20 w otworze -> 5-25 na działce
    expect(res.layers[1].description).toBe('piasek')
    expect(res.layers[1].fromM).toBeCloseTo(5, 6)
    expect(res.layers[1].toM).toBeCloseTo(25, 6)
  })

  it('otwor stojacy 5 m wyzej: warstwy przesuwaja sie w gore o 5 m', () => {
    const res = buildSyntheticProfile(
      [bh(1, 500, 117.7, [[0, 20, 'piasek'], [20, 120, 'il']])],
      100,
      { siteElevationM: 112.7 },
    )
    expect(res.layers[0].noData).toBe(false)
    expect(res.layers[0].description).toBe('piasek')
    expect(res.layers[0].fromM).toBe(0)
    // piasek konczy sie na 20 m w otworze -> 15 m na dzialce
    expect(res.layers[0].toM).toBeCloseTo(15, 6)
    expect(res.layers[1].description).toBe('il')
  })

  it('dowod zawiera oryginalne glebokosci otworu i wielkosc korekty', () => {
    const res = buildSyntheticProfile([bh(7, 300, 105, [[0, 120, 'glina']])], 100, {
      siteElevationM: 110,
    })
    const l = res.layers.find((x) => !x.noData)!
    expect(l.evidence?.elevationShiftM).toBeCloseTo(5, 6)
    expect(l.evidence?.sourceFromM).toBe(0)
    expect(l.evidence?.sourceToM).toBe(120)
    expect(l.fromM).toBeCloseTo(5, 6)
  })

  it('otwor bez rzednej jest uzyty bez korekty i odnotowany', () => {
    const res = buildSyntheticProfile([bh(3, 300, null, [[0, 120, 'glina']])], 100, {
      siteElevationM: 110,
    })
    expect(res.boreholesWithoutElevation).toContain(3)
    expect(res.layers[0].fromM).toBe(0)
    expect(res.layers[0].evidence?.elevationShiftM).toBe(0)
  })

  it('rowna rzedna nie zmienia profilu', () => {
    const bez = buildSyntheticProfile([bh(1, 300, 110, [[0, 30, 'a'], [30, 120, 'b']])], 100)
    const z = buildSyntheticProfile([bh(1, 300, 110, [[0, 30, 'a'], [30, 120, 'b']])], 100, {
      siteElevationM: 110,
    })
    expect(z.layers.map((l) => [l.fromM, l.toM])).toEqual(bez.layers.map((l) => [l.fromM, l.toM]))
  })

  it('korekta zmienia pokrycie, gdy otwor stoi nizej niz dzialka', () => {
    // Otwór ma głowicę na 95 m n.p.m., działka leży na 105 m n.p.m. — czyli 10 m wyżej.
    // Strop otworu (0 m) odpowiada dopiero 10 m p.p.t. na działce, więc górne 10 m
    // profilu działki NIE jest udokumentowane. Luka jest w stropie, nie w spągu.
    const res = buildSyntheticProfile([bh(1, 200, 95, [[0, 100, 'piasek']])], 100, {
      siteElevationM: 105,
    })
    expect(res.coveragePct).toBe(90)
    expect(res.gaps).toEqual([{ fromM: 0, toM: 10 }])
  })

  it('dwa otwory na roznych rzednych sa sprowadzane do wspolnego ukladu', () => {
    const res = buildSyntheticProfile(
      [
        bh(1, 100, 110, [[0, 40, 'blizszy']]),
        bh(2, 800, 100, [[0, 200, 'dalszy']]),
      ],
      100,
      { siteElevationM: 110 },
    )
    // bliższy bez przesunięcia 0-40; dalszy przesunięty o +10 → od 10 m, więc
    // od 40 m na działce odpowiada 30 m w otworze 2 — dane są, luki nie ma
    expect(res.gaps).toEqual([])
    expect(res.layers[0].evidence?.cbdgId).toBe(1)
    expect(res.layers[1].evidence?.cbdgId).toBe(2)
    expect(res.layers[1].evidence?.elevationShiftM).toBeCloseTo(10, 6)
  })
})
