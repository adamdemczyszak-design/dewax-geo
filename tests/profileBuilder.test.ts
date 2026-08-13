import { describe, it, expect } from 'vitest'
import { buildSyntheticProfile } from '../server/report/profileBuilder'
import type { BoreholeDetail } from '../server/types'

function bh(
  cbdgId: number,
  distanceM: number,
  layers: Array<[number, number, string]>,
): BoreholeDetail {
  return {
    cbdgId,
    name: `OTWOR-${cbdgId}`,
    lat: 52.23,
    lon: 21.01,
    distanceM,
    finalDepthM: layers.length ? layers[layers.length - 1][1] : null,
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
    lithologyMaxDepthM: layers.length ? Math.max(...layers.map((l) => l[1])) : null,
    lithologyProfileName: null,
    lithologySourceNote: null,
    notes: [],
    detailSourceUrl: `https://otworywiertnicze.pgi.gov.pl/boreholes/${cbdgId}`,
  }
}

describe('buildSyntheticProfile - wykrywanie luk', () => {
  it('bez otworow caly zakres jest luka', () => {
    const res = buildSyntheticProfile([], 100)
    expect(res.gaps).toEqual([{ fromM: 0, toM: 100 }])
    expect(res.coveragePct).toBe(0)
    expect(res.layers).toHaveLength(1)
    expect(res.layers[0].noData).toBe(true)
    expect(res.layers[0].evidence).toBeNull()
  })

  it('pelne pokrycie z jednego otworu daje 100% i brak luk', () => {
    const res = buildSyntheticProfile([bh(1, 50, [[0, 30, 'piasek'], [30, 120, 'il']])], 100)
    expect(res.gaps).toEqual([])
    expect(res.coveragePct).toBe(100)
    expect(res.layers.map((l) => [l.fromM, l.toM])).toEqual([
      [0, 30],
      [30, 100],
    ])
  })

  it('wykrywa luke w srodku profilu', () => {
    const res = buildSyntheticProfile([bh(1, 50, [[0, 20, 'piasek'], [60, 100, 'il']])], 100)
    expect(res.gaps).toEqual([{ fromM: 20, toM: 60 }])
    expect(res.coveragePct).toBe(60)
    const gapLayer = res.layers.find((l) => l.noData)!
    expect(gapLayer.description).toBeNull()
    expect(gapLayer.evidence).toBeNull()
  })

  it('wykrywa luke ponizej konca najglebszego profilu', () => {
    const res = buildSyntheticProfile([bh(1, 50, [[0, 60, 'piasek']])], 100)
    expect(res.gaps).toEqual([{ fromM: 60, toM: 100 }])
    expect(res.coveragePct).toBe(60)
  })

  it('wykrywa luke w stropie profilu', () => {
    const res = buildSyntheticProfile([bh(1, 50, [[10, 100, 'il']])], 100)
    expect(res.gaps).toEqual([{ fromM: 0, toM: 10 }])
  })

  it('laczy dane z dwoch otworow, wypelniajac luke blizszego dalszym', () => {
    const res = buildSyntheticProfile(
      [bh(1, 50, [[0, 40, 'piasek']]), bh(2, 300, [[0, 150, 'glina']])],
      100,
    )
    expect(res.gaps).toEqual([])
    expect(res.coveragePct).toBe(100)
    // 0-40 z blizszego otworu, 40-100 z dalszego
    expect(res.layers[0].evidence?.cbdgId).toBe(1)
    expect(res.layers[1].evidence?.cbdgId).toBe(2)
    expect(res.layers[1].fromM).toBe(40)
    expect(res.layers[1].toM).toBe(100)
  })

  it('preferuje otwor blizszy, nawet jesli dalszy tez ma dane', () => {
    const res = buildSyntheticProfile(
      [bh(9, 800, [[0, 100, 'il z odleglego otworu']]), bh(7, 30, [[0, 100, 'piasek z bliskiego']])],
      100,
    )
    expect(res.layers).toHaveLength(1)
    expect(res.layers[0].evidence?.cbdgId).toBe(7)
    expect(res.layers[0].description).toBe('piasek z bliskiego')
  })

  it('kazda warstwa z danymi ma komplet dowodow: ID CBDG, odleglosc, zakres, zrodlo', () => {
    const res = buildSyntheticProfile([bh(4242, 137, [[0, 100, 'piasek']])], 100)
    const l = res.layers[0]
    expect(l.evidence).toMatchObject({
      cbdgId: 4242,
      distanceM: 137,
      fromM: 0,
      toM: 100,
      sourceId: 'CBDG_OTWORY_REST',
    })
    expect(l.evidence?.sourceUrl).toContain('otworywiertnicze.pgi.gov.pl')
  })

  it('przycina profil do glebokosci docelowej', () => {
    const res = buildSyntheticProfile([bh(1, 10, [[0, 500, 'piaskowiec']])], 100)
    expect(res.layers).toHaveLength(1)
    expect(res.layers[0].toM).toBe(100)
    expect(res.coveredM).toBe(100)
  })

  it('scala sasiadujace warstwy o tym samym opisie i zrodle', () => {
    const res = buildSyntheticProfile(
      [bh(1, 10, [[0, 20, 'piasek'], [20, 50, 'piasek'], [50, 100, 'il']])],
      100,
    )
    expect(res.layers.map((l) => [l.fromM, l.toM])).toEqual([
      [0, 50],
      [50, 100],
    ])
  })

  it('nie scala warstw o tym samym opisie pochodzacych z roznych otworow', () => {
    const res = buildSyntheticProfile(
      [bh(1, 10, [[0, 40, 'piasek']]), bh(2, 900, [[40, 100, 'piasek']])],
      100,
    )
    expect(res.layers).toHaveLength(2)
    expect(res.layers[0].evidence?.cbdgId).toBe(1)
    expect(res.layers[1].evidence?.cbdgId).toBe(2)
  })

  it('pomija otwory bez profilu litologicznego', () => {
    const res = buildSyntheticProfile([bh(1, 10, []), bh(2, 500, [[0, 100, 'il']])], 100)
    expect(res.coveragePct).toBe(100)
    expect(res.layers[0].evidence?.cbdgId).toBe(2)
  })

  it('obsluguje wiele rozlacznych luk', () => {
    const res = buildSyntheticProfile(
      [bh(1, 10, [[10, 30, 'piasek'], [50, 70, 'il']])],
      100,
    )
    expect(res.gaps).toEqual([
      { fromM: 0, toM: 10 },
      { fromM: 30, toM: 50 },
      { fromM: 70, toM: 100 },
    ])
    expect(res.coveragePct).toBe(40)
  })

  it('zwraca pusty wynik dla niepoprawnej glebokosci docelowej', () => {
    expect(buildSyntheticProfile([bh(1, 10, [[0, 100, 'x']])], 0).layers).toEqual([])
  })
})
