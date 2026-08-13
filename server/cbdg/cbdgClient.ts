import { AuditLog } from '../core/auditLog'
import { TtlCache, cbdgCache } from '../core/cache'
import { ENDPOINTS, type SourceId } from '../endpoints'

export interface ArcGisFeature {
  attributes: Record<string, unknown>
  geometry?: { x: number; y: number }
}

export interface ArcGisQueryResult {
  features: ArcGisFeature[]
  exceededTransferLimit?: boolean
  error?: { code: number; message: string; details?: string[] }
}

export interface CbdgClientOptions {
  audit: AuditLog
  cache?: TtlCache<unknown>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Liczba ponowien przy bledzie sieci / 5xx / ograniczeniu tempa. */
  retries?: number
  /** Bazowe opoznienie miedzy ponowieniami [ms] (narasta liniowo). */
  retryDelayMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class CbdgError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CbdgError'
  }
}

const USER_AGENT =
  'dewax-geo/1.0 (asystent wiertacza GSHP; dane: CBDG PGI-PIB)'

/**
 * Klient uslug CBDG PGI-PIB.
 *
 * Odpowiada wylacznie za transport: budowa adresu, cache, ponowienia, audyt.
 * Nie interpretuje danych geologicznych - to zadanie modulow wyzszego poziomu.
 */
export class CbdgClient {
  private readonly audit: AuditLog
  private readonly cache: TtlCache<unknown>
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly retryDelayMs: number

  constructor(opts: CbdgClientOptions) {
    this.audit = opts.audit
    this.cache = opts.cache ?? cbdgCache
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 20_000
    this.retries = opts.retries ?? 2
    this.retryDelayMs = opts.retryDelayMs ?? 350
  }

  private async getJson<T>(
    url: string,
    meta: { sourceId: SourceId; stage: string; radiusM?: number },
  ): Promise<T> {
    const cached = this.cache.get(url)
    if (cached !== undefined) {
      this.audit.add({
        stage: meta.stage,
        message: `Odpowiedź z pamięci podręcznej: ${ENDPOINTS[meta.sourceId].name}`,
        endpoint: url,
        sourceId: meta.sourceId,
        radiusM: meta.radiusM,
        cache: 'hit',
      })
      return cached as T
    }

    let lastErr: unknown
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const startedAt = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const res = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        })
        const durationMs = Date.now() - startedAt
        if (!res.ok) {
          this.audit.add({
            stage: meta.stage,
            message: `Błąd HTTP z usługi ${ENDPOINTS[meta.sourceId].name}`,
            endpoint: url,
            sourceId: meta.sourceId,
            radiusM: meta.radiusM,
            httpStatus: res.status,
            durationMs,
            cache: 'miss',
          })
          // 403/429 = ograniczenie tempa po stronie PGI; 5xx = chwilowa awaria.
          // W obu przypadkach ponawiamy z narastajacym opoznieniem.
          const retryable = res.status >= 500 || res.status === 403 || res.status === 429
          if (retryable && attempt < this.retries) {
            await sleep(this.retryDelayMs * (attempt + 1))
            continue
          }
          throw new CbdgError(`HTTP ${res.status}`, url, res.status)
        }
        const json = (await res.json()) as T
        this.audit.add({
          stage: meta.stage,
          message: `Pobrano dane z usługi ${ENDPOINTS[meta.sourceId].name}`,
          endpoint: url,
          sourceId: meta.sourceId,
          radiusM: meta.radiusM,
          httpStatus: res.status,
          durationMs,
          cache: 'miss',
        })
        this.cache.set(url, json)
        return json
      } catch (err) {
        lastErr = err
        if (attempt >= this.retries) break
      } finally {
        clearTimeout(timer)
      }
    }

    this.audit.add({
      stage: meta.stage,
      message: `Nie udało się pobrać danych: ${String(lastErr)}`,
      endpoint: url,
      sourceId: meta.sourceId,
      radiusM: meta.radiusM,
      cache: 'miss',
    })
    throw new CbdgError(
      `Brak odpowiedzi z usługi PGI: ${String(lastErr)}`,
      url,
    )
  }

  /**
   * Zapytanie przestrzenne do warstwy ArcGIS MapServer.
   * Geometria przekazywana jest w PL-1992 (EPSG:2180), czyli w natywnym ukladzie
   * uslugi CBDG - dzieki temu bufor w metrach liczony jest bez znieksztalcen.
   */
  async queryLayer(
    layerUrl: string,
    params: Record<string, string | number | boolean>,
    meta: { sourceId: SourceId; stage: string; radiusM?: number },
  ): Promise<ArcGisQueryResult> {
    const qs = new URLSearchParams({ f: 'json', ...toStringRecord(params) })
    const url = `${layerUrl}/query?${qs.toString()}`
    const json = await this.getJson<ArcGisQueryResult>(url, meta)
    if (json.error) {
      throw new CbdgError(
        `Usługa PGI zwróciła błąd: ${json.error.message}`,
        url,
      )
    }
    return { features: json.features ?? [], exceededTransferLimit: json.exceededTransferLimit }
  }

  /** Zapytanie punktowe (point-in-polygon) - konteksty hydrogeologiczne. */
  async queryPointInPolygon(
    layerUrl: string,
    x: number,
    y: number,
    meta: { sourceId: SourceId; stage: string },
  ): Promise<ArcGisQueryResult> {
    return this.queryLayer(
      layerUrl,
      {
        geometry: `${x},${y}`,
        geometryType: 'esriGeometryPoint',
        inSR: 2180,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        returnGeometry: false,
      },
      meta,
    )
  }

  /** Metryka otworu + informacja, jakie zestawy danych sa dla niego dostepne. */
  async boreholeDetails(cbdgId: number): Promise<BoreholeApiDetails> {
    return this.getJson<BoreholeApiDetails>(
      `${apiRoot()}/boreholes/${cbdgId}`,
      { sourceId: 'CBDG_OTWORY_REST', stage: 'otwor:metryka' },
    )
  }

  async lithologicalProfiles(cbdgId: number): Promise<ProfileRef[]> {
    return this.getJson<ProfileRef[]>(
      `${apiRoot()}/boreholes/${cbdgId}/lithologicalprofiles`,
      { sourceId: 'CBDG_OTWORY_REST', stage: 'otwor:profile-litologiczne' },
    )
  }

  async lithologicalUnits(cbdgId: number, profileId: number): Promise<LithologicalUnitApi[]> {
    return this.getJson<LithologicalUnitApi[]>(
      `${apiRoot()}/boreholes/${cbdgId}/profiles/${profileId}/lithologicalunits`,
      { sourceId: 'CBDG_OTWORY_REST', stage: 'otwor:warstwy-litologiczne' },
    )
  }

  async stratigraphicProfiles(cbdgId: number): Promise<ProfileRef[]> {
    return this.getJson<ProfileRef[]>(
      `${apiRoot()}/boreholes/${cbdgId}/stratigraphicprofiles`,
      { sourceId: 'CBDG_OTWORY_REST', stage: 'otwor:profile-stratygraficzne' },
    )
  }

  async stratigraphicLayers(profileId: number, type = 'C'): Promise<StratigraphicLayerApi[]> {
    return this.getJson<StratigraphicLayerApi[]>(
      `${apiRoot()}/profiles/${profileId}/stratigraphicLayers/${type}`,
      { sourceId: 'CBDG_OTWORY_REST', stage: 'otwor:warstwy-stratygraficzne' },
    )
  }
}

function apiRoot(): string {
  return 'https://otworywiertnicze.pgi.gov.pl'
}

function toStringRecord(
  params: Record<string, string | number | boolean>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
}

/* ---------- Ksztalty odpowiedzi API CBDG Otwory wiertnicze ---------- */

export interface BoreholeApiDetails {
  borehole: {
    id: number
    name: string
    depth: number | null
    height: number | null
    locality: string | null
    commune: string | null
    county: string | null
    voivodeship: string | null
    locationBasis: string | null
    locationDesc: string | null
    drillingPurpose: string | null
    drillingYear: number | null
    chronoBottomFrom: string | null
    x1992: number | null
    y1992: number | null
    sourceDatabase: string | null
    cbdhId: number | null
  }
  features: {
    stratigraphy: boolean
    lithology: boolean
    observations: boolean
    [k: string]: boolean
  }
}

export interface ProfileRef {
  id: number
  name: string
  category: string | null
  informationSource: string | null
  informationSourceShort: string | null
  createDate: string | null
}

export interface LithologicalUnitApi {
  id: number
  from: number
  to: number
  description: string | null
  descriptionBasis: string | null
  chronostratigraphy: string | null
  lithostratigraphy: string | null
}

export interface StratigraphicLayerApi {
  id: number
  from: number
  to: number
  description: string | null
  author: string | null
  comments: string | null
}
