import type { GeocodeCandidate, GeocodeQuery, GeocoderAdapter } from './index'
import { getEnv } from '../core/env'

/**
 * Adapter opcjonalny (domyslnie WYLACZONY).
 *
 * Sluzy wylacznie do zamiany adresu na wspolrzedne, gdy oficjalna usluga GUGiK
 * nie potrafi zlokalizowac numeru domu. NIE jest i NIE MOZE byc zrodlem
 * jakichkolwiek danych geologicznych.
 *
 * Wlaczenie: zmienna srodowiskowa GEOCODER_FALLBACK=nominatim
 * Adres instancji: NOMINATIM_URL (domyslnie publiczna instancja OSM).
 */
export const nominatimAdapter: GeocoderAdapter = {
  id: 'nominatim',
  name: 'Nominatim (OpenStreetMap) — źródło pomocnicze, nieoficjalne',
  official: false,
  attribution: '© OpenStreetMap contributors (ODbL)',

  async geocode(q: GeocodeQuery, fetchImpl: typeof fetch = fetch): Promise<GeocodeCandidate[]> {
    const base = getEnv('NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org/search'
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      countrycodes: 'pl',
      limit: '10',
    })
    if (q.street) params.set('street', [q.houseNumber, q.street].filter(Boolean).join(' '))
    if (q.city) params.set('city', q.city)
    if (q.postalCode) params.set('postalcode', q.postalCode)

    const res = await fetchImpl(`${base}?${params}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'dewax-geo/1.0 (asystent wiertacza GSHP)',
      },
    })
    if (!res.ok) return []
    const rows = (await res.json()) as Array<{
      lat: string
      lon: string
      display_name: string
      type?: string
      category?: string
    }>

    return rows
      .map((r): GeocodeCandidate | null => {
        const lat = Number(r.lat)
        const lon = Number(r.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
        const isHouse = r.type === 'house' || r.category === 'place'
        return {
          lat,
          lon,
          method: 'address',
          provider: 'Nominatim / OpenStreetMap',
          matchLevel: isHouse ? 'address' : 'street',
          accuracyM: isHouse ? 30 : 250,
          label: 'Pozycja z geokodera pomocniczego OpenStreetMap (źródło nieoficjalne)',
          formatted: r.display_name,
        }
      })
      .filter((c): c is GeocodeCandidate => c !== null)
  },
}
