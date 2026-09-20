import type { GshpReport } from '../server/types'
import type { GeocodeOutcome } from '../server/geocoder/geocoderService'
import type { EndpointDescriptor } from '../server/endpoints'
import type { Suggestion } from '../server/geocoder/suggestAdapter'

export interface AnalyzeInput {
  lat: number
  lon: number
  targetDepthM: number
  method: 'gps' | 'address' | 'map' | 'parcel'
  locationLabel: string
  accuracyM: number | null
  matchLevel?: 'address' | 'street' | 'city' | 'gps' | 'parcel' | 'map'
  /** Opcjonalne — włącza wstępny dobór długości odwiertów. */
  heatPumpKw?: number | null
  scop?: number | null
  annualHours?: 1800 | 2100 | null
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Nieprawidłowa odpowiedź serwera (HTTP ${res.status}).`)
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error
    throw new Error(msg ?? `Błąd serwera (HTTP ${res.status}).`)
  }
  return data as T
}

export async function analyze(input: AnalyzeInput): Promise<GshpReport> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parse<GshpReport>(res)
}

export async function geocode(q: {
  street?: string
  houseNumber?: string
  postalCode?: string
  city?: string
  parcelId?: string
}): Promise<GeocodeOutcome> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v?.trim()) params.set(k, v.trim())
  const res = await fetch(`/api/geocode?${params}`)
  return parse<GeocodeOutcome>(res)
}

export async function fetchEndpoints(): Promise<{
  endpoints: EndpointDescriptor[]
  radiusLadderM: number[]
  defaultTargetDepthM: number
  policy: string
}> {
  const res = await fetch('/api/endpoints')
  return parse(res)
}

/**
 * Podpowiedzi nazw przy wpisywaniu.
 *
 * `signal` pozwala anulowac zapytanie, gdy uzytkownik pisze dalej - bez tego
 * wolniejsza odpowiedz dla krotszego przedrostka potrafilaby nadpisac swiezsza
 * liste i lista "skakalaby" pod palcami.
 */
export async function suggest(
  kind: 'city' | 'street',
  q: string,
  near?: { lat: number; lon: number } | null,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const params = new URLSearchParams({ kind, q })
  if (near) {
    params.set('lat', String(near.lat))
    params.set('lon', String(near.lon))
  }
  const res = await fetch(`/api/suggest?${params}`, { signal })
  const data = await parse<{ suggestions: Suggestion[] }>(res)
  return data.suggestions ?? []
}
