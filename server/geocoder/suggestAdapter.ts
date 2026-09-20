import { TtlCache } from '../core/cache'
import { getEnv } from '../core/env'
import { foldPl, tidy } from './normalize'

/**
 * Podpowiedzi nazw przy wpisywaniu (autouzupelnianie).
 *
 * ZAKRES ODPOWIEDZIALNOSCI - wazne dla zasady dowodowej aplikacji:
 * ten modul dostarcza WYLACZNIE TEKST do wpisania w pole formularza.
 * Nie ustala pozycji otworu i nie podaje wspolrzednych do raportu.
 * Po wybraniu podpowiedzi adres i tak przechodzi pelna kaskade GUGiK UUG,
 * ktora jest jedynym zrodlem wspolrzednych adresowych. Pole `hint` sluzy
 * tylko do zawezenia kolejnej listy podpowiedzi (ulice w okolicy wybranej
 * miejscowosci) i nigdzie poza tym modulem nie jest uzywane.
 *
 * Dostawca: Photon (OpenStreetMap). Uzasadnienie wyboru - usluga UUG
 * dopasowuje nazwy DOKLADNIE i na czesciowy wpis ("Wola Kieł", "Warsza")
 * zwraca zero wynikow, wiec do podpowiedzi sie nie nadaje. Photon dopasowuje
 * po przedrostku i radzi sobie z zapisem bez polskich znakow
 * ("Wolka Kos" -> "Wólka Kosowska"), co jest tu calym sensem funkcji.
 */

const PHOTON_URL = 'https://photon.komoot.io/api/'

/** Ramka obejmujaca Polske - odcina podpowiedzi zagraniczne. */
const PL_BBOX = '14.07,49.0,24.15,54.9'

/** Wartosci `osm_value`, ktore sa faktycznie ulicami, a nie przystankiem czy przejsciem. */
const STREET_VALUES = new Set([
  'residential',
  'living_street',
  'pedestrian',
  'primary',
  'secondary',
  'tertiary',
  'trunk',
  'unclassified',
  'road',
  'service',
])

export interface Suggestion {
  kind: 'city' | 'street'
  /** Nazwa wstawiana do pola formularza. */
  value: string
  /** Wiersz opisowy pod nazwa - pozwala odroznic miejscowosci o tej samej nazwie. */
  context: string
  /**
   * Punkt orientacyjny UZYWANY WYLACZNIE do zawezania kolejnych podpowiedzi.
   * Nigdy nie trafia do raportu ani do analizy geologicznej.
   */
  hint?: { lat: number; lon: number }
}

interface PhotonFeature {
  properties?: {
    name?: string
    city?: string
    district?: string
    locality?: string
    county?: string
    state?: string
    countrycode?: string
    osm_value?: string
  }
  geometry?: { coordinates?: [number, number] }
}

// Podpowiedzi sa odpytywane przy pisaniu, wiec cache jest tu istotny:
// oszczedza publiczna usluge i wyglaadza opoznienia przy cofaniu znaku.
const cache = new TtlCache<Suggestion[]>(60 * 60 * 1000, 2000)

/** Czysci cache podpowiedzi - potrzebne w testach, by przebiegi byly niezalezne. */
export function clearSuggestCache(): void {
  cache.clear()
}

export function suggestCacheKey(kind: string, q: string, near?: LatLonHint): string {
  const n = near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : '-'
  return `${kind}|${foldPl(q)}|${n}`
}

export interface LatLonHint {
  lat: number
  lon: number
}

export async function suggest(
  kind: 'city' | 'street',
  query: string,
  near?: LatLonHint,
  fetchImpl: typeof fetch = fetch,
): Promise<Suggestion[]> {
  const q = tidy(query)
  // Ponizej trzech znakow lista jest bezuzyteczna, a ruch do uslugi spory.
  if (q.length < 3) return []

  const key = suggestCacheKey(kind, q, near)
  const cached = cache.get(key)
  if (cached) return cached

  const params = new URLSearchParams({
    q,
    limit: '15',
    lang: 'default',
    osm_tag: kind === 'city' ? 'place' : 'highway',
  })

  if (kind === 'street' && near) {
    // Ulice szukamy w okolicy wybranej miejscowosci (~20 km), nie w calym kraju.
    const d = 0.2
    params.set(
      'bbox',
      `${(near.lon - d).toFixed(4)},${(near.lat - d).toFixed(4)},` +
        `${(near.lon + d).toFixed(4)},${(near.lat + d).toFixed(4)}`,
    )
    params.set('lat', String(near.lat))
    params.set('lon', String(near.lon))
  } else {
    params.set('bbox', PL_BBOX)
  }

  const base = getEnv('PHOTON_URL') ?? PHOTON_URL

  let features: PhotonFeature[]
  try {
    const res = await fetchImpl(`${base}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'dewax-geo/1.0 (asystent wiertacza GSHP)' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { features?: PhotonFeature[] }
    features = data.features ?? []
  } catch {
    // Podpowiedzi sa udogodnieniem - ich brak nie moze przerwac pracy z formularzem.
    return []
  }

  const out = kind === 'city' ? mapCities(features) : mapStreets(features)
  cache.set(key, out)
  return out
}

function mapCities(features: PhotonFeature[]): Suggestion[] {
  const seen = new Set<string>()
  const out: Suggestion[] = []

  for (const f of features) {
    const p = f.properties ?? {}
    if (p.countrycode !== 'PL') continue
    const name = p.name?.trim()
    if (!name) continue

    const context = [p.county, p.state].filter(Boolean).join(', ')
    // Miejscowosci o tej samej nazwie w roznych powiatach to ROZNE pozycje -
    // klucz musi je rozroznic, inaczej wiertacz nie wybierze wlasciwej.
    const key = `${foldPl(name)}|${foldPl(context)}`
    if (seen.has(key)) continue
    seen.add(key)

    const coords = f.geometry?.coordinates
    out.push({
      kind: 'city',
      value: name,
      context,
      hint:
        coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])
          ? { lat: coords[1], lon: coords[0] }
          : undefined,
    })
    if (out.length >= 8) break
  }
  return out
}

function mapStreets(features: PhotonFeature[]): Suggestion[] {
  const seen = new Set<string>()
  const out: Suggestion[] = []

  for (const f of features) {
    const p = f.properties ?? {}
    if (p.countrycode !== 'PL') continue
    if (p.osm_value && !STREET_VALUES.has(p.osm_value)) continue
    const name = p.name?.trim()
    if (!name) continue

    const city = p.city ?? p.locality ?? ''
    // OSM trzyma dluga ulice jako wiele odcinkow - bez tego lista bylaby
    // szescioma wierszami "Marszałkowska".
    const key = `${foldPl(name)}|${foldPl(city)}`
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      kind: 'street',
      value: name,
      context: [city, p.district].filter(Boolean).join(', '),
    })
    if (out.length >= 8) break
  }
  return out
}
