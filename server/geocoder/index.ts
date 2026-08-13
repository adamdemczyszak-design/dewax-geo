import type { ResolvedLocation } from '../types'

/**
 * Warstwa geokodowania jest CELOWO oddzielona od warstwy danych geologicznych.
 * Geokoder zamienia adres na wspolrzedne i nic wiecej - nie dostarcza zadnych
 * informacji o gruncie. Zadne dane z geokodera nie trafiaja do czesci
 * geologicznej raportu.
 */

export interface GeocodeQuery {
  street?: string
  houseNumber?: string
  postalCode?: string
  city?: string
}

export interface GeocodeCandidate extends ResolvedLocation {
  /** Pelny, sformatowany adres zwrocony przez dostawce. */
  formatted: string
  /** Dodatkowe identyfikatory rejestrowe (TERYT/SIMC/ULIC) jesli dostepne. */
  registry?: Record<string, string | null>
}

export interface GeocoderAdapter {
  id: string
  name: string
  /** Czy dostawca jest oficjalnym rejestrem panstwowym. */
  official: boolean
  attribution: string
  geocode(q: GeocodeQuery, fetchImpl?: typeof fetch): Promise<GeocodeCandidate[]>
}

export function formatQuery(q: GeocodeQuery): string {
  return [
    [q.street, q.houseNumber].filter(Boolean).join(' '),
    [q.postalCode, q.city].filter(Boolean).join(' '),
  ]
    .filter((s) => s && s.trim().length)
    .join(', ')
}
