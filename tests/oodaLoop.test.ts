import { describe, it, expect } from 'vitest'
import { runOodaLoop } from '../server/core/oodaLoop'
import { AuditLog } from '../server/core/auditLog'
import { RADIUS_LADDER } from '../server/endpoints'
import type { BoreholeDetail, LithologyLayer } from '../server/types'

const CENTER = { lat: 52.2297, lon: 21.0122 }

function borehole(
  cbdgId: number,
  distanceM: number,
  layers: Array<[number, number, string]>,
): BoreholeDetail {
  const lithology: LithologyLayer[] = layers.map(([fromM, toM, description]) => ({
    fromM,
    toM,
    description,
    descriptionBasis: 'okruchowe',
    chronostratigraphy: 'czwartorzed',
    lithostratigraphy: null,
  }))
  return {
    cbdgId,
    name: `OTWOR-${cbdgId}`,
    lat: 52.23,
    lon: 21.01,
    distanceM,
    finalDepthM: layers.length ? layers[layers.length - 1][1] : null,
    elevationM: 100,
    drillingYear: 1990,
    drillingPurpose: 'hydrogeologiczny',
    stratigraphyAtBottom: 'czwartorzed',
    locality: 'Testowo',
    commune: null,
    county: null,
    voivodeship: null,
    locationBasis: null,
    locationQuality: { cls: 'mapowa', uncertaintyM: 100, basis: null, note: 'test' },
    foundInRadiusM: distanceM,
    sourceId: 'CBDG_OTWORY_MAPSERVER',
    sourceUrl: 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/cbdg_otwory/MapServer/0',
    lithology,
    stratigraphy: [],
    lithologyMaxDepthM: lithology.length ? Math.max(...lithology.map((l) => l.toM)) : null,
    lithologyProfileName: 'Profil testowy',
    lithologySourceNote: 'test',
    notes: [],
    detailSourceUrl: `https://otworywiertnicze.pgi.gov.pl/boreholes/${cbdgId}`,
  }
}

describe('runOodaLoop - rozszerzanie promienia', () => {
  it('konczy na pierwszym promieniu, gdy profil pokrywa glebokosc docelowa', async () => {
    const audit = new AuditLog()
    const calls: number[] = []
    const res = await runOodaLoop(
      {
        audit,
        collect: async (_c, r) => {
          calls.push(r)
          return [borehole(1, 50, [[0, 120, 'piasek drobnoziarnisty']])]
        },
      },
      { center: CENTER, targetDepthM: 100 },
    )

    expect(calls).toEqual([200])
    expect(res.finalRadiusM).toBe(200)
    expect(res.radiiChecked).toEqual([200])
    expect(res.cycles).toHaveLength(1)
    expect(res.cycles[0].decision).toBe('wystarczajace')
    expect(res.coveragePct).toBe(100)
    expect(res.sufficient).toBe(true)
  })

  it('rozszerza promien w kolejnosci 200 -> 500 -> 1000 az do pelnego pokrycia', async () => {
    const audit = new AuditLog()
    const calls: number[] = []
    const res = await runOodaLoop(
      {
        audit,
        collect: async (_c, r) => {
          calls.push(r)
          if (r === 200) return []
          if (r === 500) return [borehole(1, 400, [[0, 40, 'glina zwalowa']])]
          return [
            borehole(1, 400, [[0, 40, 'glina zwalowa']]),
            borehole(2, 900, [[0, 150, 'il pstry']]),
          ]
        },
      },
      { center: CENTER, targetDepthM: 100 },
    )

    expect(calls).toEqual([200, 500, 1000])
    expect(res.finalRadiusM).toBe(1000)
    expect(res.cycles.map((c) => c.decision)).toEqual([
      'rozszerz-promien',
      'rozszerz-promien',
      'wystarczajace',
    ])
    expect(res.coveragePct).toBe(100)
  })

  it('przechodzi cala drabine promieni i konczy statusem "wyczerpano-promienie"', async () => {
    const audit = new AuditLog()
    const calls: number[] = []
    const res = await runOodaLoop(
      { audit, collect: async (_c, r) => { calls.push(r); return [] } },
      { center: CENTER, targetDepthM: 100 },
    )

    expect(calls).toEqual([...RADIUS_LADDER])
    expect(res.finalRadiusM).toBe(5000)
    expect(res.sufficient).toBe(false)
    expect(res.coveragePct).toBe(0)
    expect(res.cycles.at(-1)?.decision).toBe('wyczerpano-promienie')
    expect(res.gaps).toEqual([{ fromM: 0, toM: 100 }])
  })

  it('rozszerza promien, gdy profil nie siega glebokosci docelowej', async () => {
    const audit = new AuditLog()
    const calls: number[] = []
    await runOodaLoop(
      {
        audit,
        collect: async (_c, r) => {
          calls.push(r)
          return [borehole(1, 100, [[0, 60, 'piasek']])] // tylko do 60 m
        },
      },
      { center: CENTER, targetDepthM: 100 },
    )
    // 60/100 = 60% pokrycia -> petla musi przejsc cala drabine
    expect(calls).toEqual([...RADIUS_LADDER])
  })

  it('nie rozszerza promienia ponizej progu, gdy minCoveragePct jest obnizony', async () => {
    const audit = new AuditLog()
    const calls: number[] = []
    const res = await runOodaLoop(
      {
        audit,
        collect: async (_c, r) => {
          calls.push(r)
          return [borehole(1, 100, [[0, 80, 'piasek']])]
        },
      },
      { center: CENTER, targetDepthM: 100, minCoveragePct: 75 },
    )
    expect(calls).toEqual([200])
    expect(res.sufficient).toBe(true)
    expect(res.coveragePct).toBe(80)
  })

  it('zapisuje w audycie promien, liczbe otworow i decyzje w kazdym cyklu', async () => {
    const audit = new AuditLog()
    await runOodaLoop(
      {
        audit,
        collect: async (_c, r) => (r >= 1000 ? [borehole(1, 900, [[0, 120, 'piasek']])] : []),
      },
      { center: CENTER, targetDepthM: 100 },
    )

    const entries = audit.all()
    const decisions = entries.filter((e) => e.stage === 'ooda:zdecyduj')
    expect(decisions).toHaveLength(3)
    expect(decisions[0].radiusM).toBe(200)
    expect(decisions[0].decision).toBe('rozszerz-promien')
    expect(decisions[2].radiusM).toBe(1000)
    expect(decisions[2].decision).toBe('wystarczajace')

    const observations = entries.filter((e) => e.stage === 'ooda:obserwuj')
    expect(observations.map((e) => e.radiusM)).toEqual([200, 500, 1000])

    const orientation = entries.filter((e) => e.stage === 'ooda:zorientuj')
    expect(orientation.at(-1)?.found).toBe(1)
    expect(entries.every((e) => typeof e.ts === 'string')).toBe(true)
  })

  it('respektuje wlasna drabine promieni', async () => {
    const audit = new AuditLog()
    const calls: number[] = []
    await runOodaLoop(
      { audit, collect: async (_c, r) => { calls.push(r); return [] } },
      { center: CENTER, targetDepthM: 100, radiusLadder: [100, 300] },
    )
    expect(calls).toEqual([100, 300])
  })
})
