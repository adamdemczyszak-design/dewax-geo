import { gugikAdapter } from './gugikAdapter'
import { nominatimAdapter } from './nominatimAdapter'
import { geocodeParcel, isPlausibleParcelId } from './uldkAdapter'
import { getEnv } from '../core/env'
import type { GeocodeCandidate, GeocodeQuery, GeocoderAdapter } from './index'

export interface GeocodeOutcome {
  candidates: GeocodeCandidate[]
  /** Kolejnosc i wynik prob poszczegolnych dostawcow - do audytu. */
  providersTried: Array<{ id: string; name: string; official: boolean; results: number; error?: string }>
  note: string | null
}

/** Im wyzej, tym pewniejszy punkt. Steruje kolejnoscia listy wyboru. */
const LEVEL_RANK: Record<string, number> = {
  address: 4,
  parcel: 3,
  street: 2,
  city: 1,
}

/**
 * Serwis geokodowania oparty na adapterach.
 *
 * Priorytet ma zawsze oficjalna usluga panstwowa (GUGiK). Zrodlo pomocnicze
 * (OpenStreetMap) uruchamiamy nie tylko gdy GUGiK nie zwrocil nic, ale takze
 * gdy zwrocil sam srodek miejscowosci - punkt o niepewnosci 2 km nie jest
 * odpowiedzia na pytanie "gdzie wiercic", a OSM bywa w takich miejscach
 * dokladniejszy. Wyniki obu zrodel trafiaja na jedna liste, uporzadkowana
 * wedlug dokladnosci, z jawnie oznaczonym dostawca.
 *
 * Wylaczenie zrodla pomocniczego: GEOCODER_FALLBACK=off
 */
export async function geocodeAddress(
  q: GeocodeQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeOutcome> {
  const providersTried: GeocodeOutcome['providersTried'] = []

  // Numer dzialki ewidencyjnej jest jednoznaczny - jesli go podano,
  // rozstrzyga i nie ma sensu pytac geokoderow adresowych.
  if (q.parcelId?.trim()) {
    return geocodeByParcel(q.parcelId, providersTried, fetchImpl)
  }

  const collected: GeocodeCandidate[] = []

  const gugik = await runAdapter(gugikAdapter, q, providersTried, fetchImpl)
  collected.push(...gugik)

  const best = bestLevel(collected)
  if (fallbackEnabled() && best < LEVEL_RANK.street) {
    const osm = await runAdapter(nominatimAdapter, q, providersTried, fetchImpl)
    collected.push(...osm)
  }

  const candidates = dedupe(collected).sort(byQuality)

  if (!candidates.length) {
    return {
      candidates: [],
      providersTried,
      note:
        'Nie udało się ustalić współrzędnych dla podanego adresu. Sprawdź pisownię miejscowości, ' +
        'wpisz numer działki ewidencyjnej albo wskaż punkt bezpośrednio na mapie.',
    }
  }

  return { candidates, providersTried, note: noteFor(candidates[0]) }
}

async function geocodeByParcel(
  parcelId: string,
  providersTried: GeocodeOutcome['providersTried'],
  fetchImpl: typeof fetch,
): Promise<GeocodeOutcome> {
  const entry = { id: 'gugik-uldk', name: 'GUGiK — ULDK (działki ewidencyjne)', official: true }

  if (!isPlausibleParcelId(parcelId)) {
    providersTried.push({ ...entry, results: 0, error: 'nieprawidłowy format identyfikatora' })
    return {
      candidates: [],
      providersTried,
      note:
        'Identyfikator działki ma nieprawidłowy format. Oczekiwany wzór to WWPPGG_R.XXXX.NDZ, ' +
        'na przykład 141201_1.0001.1867/2.',
    }
  }

  try {
    const parcel = await geocodeParcel(parcelId, fetchImpl)
    providersTried.push({ ...entry, results: parcel ? 1 : 0 })
    if (!parcel) {
      return {
        candidates: [],
        providersTried,
        note:
          'Nie znaleziono działki o podanym identyfikatorze w rejestrze ULDK. ' +
          'Sprawdź numer w wypisie z ewidencji gruntów lub wskaż punkt na mapie.',
      }
    }
    return { candidates: [parcel], providersTried, note: noteFor(parcel) }
  } catch (err) {
    providersTried.push({ ...entry, results: 0, error: (err as Error).message })
    return {
      candidates: [],
      providersTried,
      note: `Usługa ULDK nie odpowiedziała: ${(err as Error).message}`,
    }
  }
}

async function runAdapter(
  adapter: GeocoderAdapter,
  q: GeocodeQuery,
  providersTried: GeocodeOutcome['providersTried'],
  fetchImpl: typeof fetch,
): Promise<GeocodeCandidate[]> {
  try {
    const results = await adapter.geocode(q, fetchImpl)
    providersTried.push({
      id: adapter.id,
      name: adapter.name,
      official: adapter.official,
      results: results.length,
    })
    return results
  } catch (err) {
    providersTried.push({
      id: adapter.id,
      name: adapter.name,
      official: adapter.official,
      results: 0,
      error: (err as Error).message,
    })
    return []
  }
}

function fallbackEnabled(): boolean {
  const v = (getEnv('GEOCODER_FALLBACK') ?? '').toLowerCase()
  return v !== 'off' && v !== 'none' && v !== '0'
}

function bestLevel(candidates: GeocodeCandidate[]): number {
  return candidates.reduce((max, c) => Math.max(max, LEVEL_RANK[c.matchLevel ?? ''] ?? 0), 0)
}

/** Najpierw poziom dopasowania, potem deklarowana dokladnosc, potem zrodlo oficjalne. */
function byQuality(a: GeocodeCandidate, b: GeocodeCandidate): number {
  const lvl = (LEVEL_RANK[b.matchLevel ?? ''] ?? 0) - (LEVEL_RANK[a.matchLevel ?? ''] ?? 0)
  if (lvl !== 0) return lvl
  const acc = (a.accuracyM ?? 1e9) - (b.accuracyM ?? 1e9)
  if (acc !== 0) return acc
  const aOfficial = a.provider.startsWith('GUGiK') ? 0 : 1
  const bOfficial = b.provider.startsWith('GUGiK') ? 0 : 1
  return aOfficial - bOfficial
}

/** Punkty blizsze niz ~11 m to ten sam adres podany przez dwa zrodla. */
function dedupe(candidates: GeocodeCandidate[]): GeocodeCandidate[] {
  const out: GeocodeCandidate[] = []
  for (const c of candidates) {
    const dup = out.some(
      (o) => Math.abs(o.lat - c.lat) < 1e-4 && Math.abs(o.lon - c.lon) < 1e-4,
    )
    if (!dup) out.push(c)
  }
  return out
}

function noteFor(best: GeocodeCandidate): string | null {
  if (best.matchLevel === 'city') {
    return (
      'UWAGA: adres został zlokalizowany wyłącznie na poziomie miejscowości ' +
      `(niepewność rzędu ${best.accuracyM ?? '?'} m). Wynik analizy geologicznej należy traktować ` +
      'jako orientacyjny dla rejonu, a nie dla działki. Popraw punkt na mapie albo użyj GPS na miejscu inwestycji.'
    )
  }
  if (best.matchLevel === 'street') {
    return (
      'UWAGA: zlokalizowano ulicę, ale nie konkretny numer domu ' +
      `(niepewność rzędu ${best.accuracyM ?? '?'} m). Przesuń znacznik na mapie na miejsce odwiertu ` +
      'albo użyj lokalizacji GPS na działce.'
    )
  }
  if (best.matchLevel === 'parcel') {
    return (
      `Wskazano środek działki (niepewność rzędu ${best.accuracyM ?? '?'} m — połowa jej rozmiaru). ` +
      'Odwiert rzadko wypada w środku działki — przesuń znacznik na planowane miejsce.'
    )
  }
  return null
}
