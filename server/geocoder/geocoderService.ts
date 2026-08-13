import { gugikAdapter } from './gugikAdapter'
import { nominatimAdapter } from './nominatimAdapter'
import { getEnv } from '../core/env'
import type { GeocodeCandidate, GeocodeQuery, GeocoderAdapter } from './index'

export interface GeocodeOutcome {
  candidates: GeocodeCandidate[]
  /** Kolejnosc i wynik prob poszczegolnych dostawcow - do audytu. */
  providersTried: Array<{ id: string; name: string; official: boolean; results: number; error?: string }>
  note: string | null
}

/**
 * Serwis geokodowania oparty na adapterach.
 * Priorytet ma zawsze oficjalna usluga panstwowa (GUGiK UUG).
 * Adapter pomocniczy uruchamiany jest tylko, gdy zostanie jawnie wlaczony
 * zmienna srodowiskowa GEOCODER_FALLBACK.
 */
export async function geocodeAddress(
  q: GeocodeQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeOutcome> {
  const chain: GeocoderAdapter[] = [gugikAdapter]
  if ((getEnv('GEOCODER_FALLBACK') ?? '').toLowerCase() === 'nominatim') {
    chain.push(nominatimAdapter)
  }

  const providersTried: GeocodeOutcome['providersTried'] = []

  for (const adapter of chain) {
    try {
      const results = await adapter.geocode(q, fetchImpl)
      providersTried.push({
        id: adapter.id,
        name: adapter.name,
        official: adapter.official,
        results: results.length,
      })
      if (results.length) {
        return {
          candidates: results,
          providersTried,
          note: noteFor(results[0]),
        }
      }
    } catch (err) {
      providersTried.push({
        id: adapter.id,
        name: adapter.name,
        official: adapter.official,
        results: 0,
        error: (err as Error).message,
      })
    }
  }

  return {
    candidates: [],
    providersTried,
    note: 'Nie udało się ustalić współrzędnych dla podanego adresu. Użyj lokalizacji GPS lub podaj współrzędne ręcznie.',
  }
}

function noteFor(best: GeocodeCandidate): string | null {
  if (best.matchLevel === 'city') {
    return (
      'UWAGA: adres został zlokalizowany wyłącznie na poziomie miejscowości ' +
      `(niepewność rzędu ${best.accuracyM ?? '?'} m). Wynik analizy geologicznej należy traktować ` +
      'jako orientacyjny dla rejonu, a nie dla działki. Zalecane użycie GPS na miejscu inwestycji.'
    )
  }
  if (best.matchLevel === 'street') {
    return (
      'UWAGA: usługa GUGiK zlokalizowała ulicę, ale nie konkretny numer domu ' +
      `(niepewność rzędu ${best.accuracyM ?? '?'} m). Dla precyzyjnego wyniku użyj lokalizacji GPS na działce.`
    )
  }
  return null
}
