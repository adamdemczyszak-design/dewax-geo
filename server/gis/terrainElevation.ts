import { AuditLog } from '../core/auditLog'
import { TtlCache, cbdgCache } from '../core/cache'
import { toPl1992 } from '../geo/distance'
import type { LatLon } from '../types'

/**
 * Rzędna terenu z Numerycznego Modelu Terenu GUGiK.
 *
 * Moduł celowo oddzielony od danych geologicznych — dostarcza wyłącznie wysokość
 * punktu, potrzebną do korekty wysokościowej profilu. Bez niej warstwy z otworów
 * stojących na innej rzędnej są sklejane z błędem równym różnicy wysokości.
 *
 * Usługa: GET https://services.gugik.gov.pl/nmt/?request=GetHByXY&x=<X>&y=<Y>
 * UWAGA: parametry są w układzie PL-1992 w konwencji geodezyjnej,
 * czyli X = northing, Y = easting — odwrotnie niż kolejność x,y w ArcGIS.
 * Odpowiedź to zwykły tekst z liczbą, np. `116.8`.
 */
const NMT_URL = 'https://services.gugik.gov.pl/nmt/'

export interface TerrainElevation {
  elevationM: number
  source: string
  sourceUrl: string
}

export async function fetchTerrainElevation(
  point: LatLon,
  opts: {
    audit: AuditLog
    cache?: TtlCache<unknown>
    fetchImpl?: typeof fetch
    timeoutMs?: number
  },
): Promise<TerrainElevation | null> {
  const cache = opts.cache ?? cbdgCache
  const fetchImpl = opts.fetchImpl ?? fetch
  const p = toPl1992(point)
  // p.x = easting, p.y = northing (proj4). GUGiK oczekuje X=northing, Y=easting.
  const url = `${NMT_URL}?request=GetHByXY&x=${p.y.toFixed(2)}&y=${p.x.toFixed(2)}`

  const cached = cache.get(url)
  if (cached !== undefined) {
    opts.audit.add({
      stage: 'teren:rzedna',
      message: `Rzędna terenu z pamięci podręcznej: ${cached} m n.p.m.`,
      endpoint: url,
      sourceId: 'GUGIK_NMT',
      cache: 'hit',
    })
    return { elevationM: cached as number, source: 'GUGiK NMT', sourceUrl: url }
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    const durationMs = Date.now() - startedAt
    if (!res.ok) {
      opts.audit.add({
        stage: 'teren:rzedna',
        message: 'Usługa NMT GUGiK nie zwróciła wysokości — korekta wysokościowa profilu niedostępna.',
        endpoint: url,
        sourceId: 'GUGIK_NMT',
        httpStatus: res.status,
        durationMs,
        cache: 'miss',
      })
      return null
    }
    const text = (await res.text()).trim()
    const value = Number(text.replace(',', '.'))
    // Zakres wysokości w Polsce: -2 m (Żuławy) .. 2500 m (Tatry).
    if (!Number.isFinite(value) || value < -10 || value > 2600) {
      opts.audit.add({
        stage: 'teren:rzedna',
        message: `Usługa NMT zwróciła wartość spoza dopuszczalnego zakresu ("${text}") — pomijam korektę wysokościową.`,
        endpoint: url,
        sourceId: 'GUGIK_NMT',
        durationMs,
        cache: 'miss',
      })
      return null
    }
    cache.set(url, value)
    opts.audit.add({
      stage: 'teren:rzedna',
      message: `Rzędna terenu w punkcie inwestycji: ${value} m n.p.m. (GUGiK NMT).`,
      endpoint: url,
      sourceId: 'GUGIK_NMT',
      httpStatus: res.status,
      durationMs,
      cache: 'miss',
    })
    return { elevationM: value, source: 'GUGiK NMT', sourceUrl: url }
  } catch (err) {
    opts.audit.add({
      stage: 'teren:rzedna',
      message: `Nie udało się pobrać rzędnej terenu: ${(err as Error).message}. Korekta wysokościowa profilu niedostępna.`,
      endpoint: url,
      sourceId: 'GUGIK_NMT',
      cache: 'miss',
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}
