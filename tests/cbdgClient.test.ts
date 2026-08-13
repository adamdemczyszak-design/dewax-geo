import { describe, it, expect, vi } from 'vitest'
import { TtlCache } from '../server/core/cache'
import { AuditLog } from '../server/core/auditLog'
import { CbdgClient } from '../server/cbdg/cbdgClient'
import { searchBoreholes } from '../server/cbdg/boreholeSearch'
import { ENDPOINTS } from '../server/endpoints'

describe('TtlCache', () => {
  it('zwraca zapisana wartosc i liczy trafienia', () => {
    const c = new TtlCache<number>(1000, 10)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    expect(c.getStats().hits).toBe(1)
    expect(c.getStats().misses).toBe(0)
  })

  it('nie zwraca wartosci po uplywie TTL', () => {
    let now = 0
    const c = new TtlCache<number>(100, 10, () => now)
    c.set('a', 1)
    now = 50
    expect(c.get('a')).toBe(1)
    now = 201
    expect(c.get('a')).toBeUndefined()
  })

  it('usuwa najstarsze wpisy po przekroczeniu limitu (LRU)', () => {
    const c = new TtlCache<number>(10_000, 2)
    c.set('a', 1)
    c.set('b', 2)
    c.get('a') // odswiezenie 'a'
    c.set('c', 3)
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBe(1)
    expect(c.get('c')).toBe(3)
    expect(c.getStats().evictions).toBe(1)
  })
})

describe('CbdgClient - cache i audyt', () => {
  const arcgisResponse = {
    features: [
      {
        attributes: {
          ID_CBDG: 3121,
          NAZWA: 'WARSZAWA',
          GLEBOKOSC: 236,
          RZEDNA: 100.5,
          STRAT: 'trzeciorzed',
          CEL_WIERC: 'hydrogeologiczny',
          ROK: 1965,
          MIEJSCOWOSC: 'Warszawa',
          GMINA: 'Warszawa',
          POWIAT: 'Warszawa',
          WOJEWODZTWO: 'mazowieckie',
          PODS_LOKA: 'mapa topograficzna',
        },
        geometry: { x: 21.0122, y: 52.2306 },
      },
    ],
  }

  const makeFetch = (payload: unknown) =>
    vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

  it('drugie identyczne zapytanie jest obslugiwane z cache', async () => {
    const audit = new AuditLog()
    const fetchImpl = makeFetch(arcgisResponse)
    const client = new CbdgClient({
      audit,
      cache: new TtlCache(60_000, 50),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const center = { lat: 52.2297, lon: 21.0122 }

    await searchBoreholes(client, center, 500)
    await searchBoreholes(client, center, 500)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const cacheHits = audit.all().filter((e) => e.cache === 'hit')
    expect(cacheHits).toHaveLength(1)
    expect(cacheHits[0].sourceId).toBe('CBDG_OTWORY_MAPSERVER')
  })

  it('odpytuje oficjalny adres uslugi CBDG w ukladzie PL-1992', async () => {
    const audit = new AuditLog()
    const fetchImpl = makeFetch(arcgisResponse)
    const client = new CbdgClient({
      audit,
      cache: new TtlCache(60_000, 50),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await searchBoreholes(client, { lat: 52.2297, lon: 21.0122 }, 200)

    const url = String((fetchImpl.mock.calls[0] as unknown[])[0])
    expect(url.startsWith(ENDPOINTS.CBDG_OTWORY_MAPSERVER.url)).toBe(true)
    expect(url).toContain('inSR=2180')
    expect(url).toContain('distance=200')
    expect(url).toContain('units=esriSRUnit_Meter')
    expect(url).toContain('outSR=4326')
  })

  it('mapuje atrybuty otworu i liczy odleglosc haversine', async () => {
    const audit = new AuditLog()
    const client = new CbdgClient({
      audit,
      cache: new TtlCache(60_000, 50),
      fetchImpl: makeFetch(arcgisResponse) as unknown as typeof fetch,
    })
    const res = await searchBoreholes(client, { lat: 52.2297, lon: 21.0122 }, 500)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      cbdgId: 3121,
      name: 'WARSZAWA',
      finalDepthM: 236,
      foundInRadiusM: 500,
      sourceId: 'CBDG_OTWORY_MAPSERVER',
    })
    // 52.2306 - 52.2297 = 0.0009 stopnia => ok. 100 m
    expect(res[0].distanceM).toBeGreaterThan(90)
    expect(res[0].distanceM).toBeLessThan(110)
  })

  it('odrzuca otwory poza zadanym promieniem, nawet jesli usluga je zwroci', async () => {
    const far = {
      features: [
        {
          attributes: { ID_CBDG: 1, NAZWA: 'DALEKI' },
          geometry: { x: 21.0122, y: 52.2497 }, // ~2.2 km na polnoc
        },
      ],
    }
    const client = new CbdgClient({
      audit: new AuditLog(),
      cache: new TtlCache(60_000, 50),
      fetchImpl: makeFetch(far) as unknown as typeof fetch,
    })
    const res = await searchBoreholes(client, { lat: 52.2297, lon: 21.0122 }, 200)
    expect(res).toHaveLength(0)
  })

  it('zglasza blad, gdy usluga PGI zwroci obiekt error', async () => {
    const client = new CbdgClient({
      audit: new AuditLog(),
      cache: new TtlCache(60_000, 50),
      retries: 0,
      fetchImpl: makeFetch({ error: { code: 400, message: 'Invalid query' } }) as unknown as typeof fetch,
    })
    await expect(
      searchBoreholes(client, { lat: 52.2297, lon: 21.0122 }, 200),
    ).rejects.toThrow(/Invalid query/)
  })
})

describe('AuditLog', () => {
  it('zapisuje wpisy w kolejnosci wraz ze znacznikiem czasu', () => {
    const audit = new AuditLog(() => new Date('2026-01-01T10:00:00Z'))
    audit.add({ stage: 'a', message: 'pierwszy', radiusM: 200 })
    audit.add({ stage: 'b', message: 'drugi', found: 3, decision: 'rozszerz-promien' })
    const all = audit.all()
    expect(all).toHaveLength(2)
    expect(all[0].ts).toBe('2026-01-01T10:00:00.000Z')
    expect(all[0].radiusM).toBe(200)
    expect(all[1].decision).toBe('rozszerz-promien')
  })
})
