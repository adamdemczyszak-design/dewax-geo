import type { GeocodeCandidate, GeocodeQuery, GeocoderAdapter } from './index'

const UUG_URL = 'https://services.gugik.gov.pl/uug/'

interface UugResponse {
  type?: string
  'found objects'?: number
  results?: Record<
    string,
    {
      city?: string
      street?: string
      number?: string
      code?: string
      teryt?: string
      simc?: string
      ulic?: string
      voivodeship?: string
      county?: string
      commune?: string
      x?: string
      y?: string
      accuracy?: string
    }
  > | null
}

/**
 * Usluga Uniwersalnej Wyszukiwarki GUGiK (UUG) - oficjalne, otwarte zrodlo
 * panstwowe dla lokalizacji adresow w Polsce.
 *
 * Zachowanie uslugi (zweryfikowane empirycznie):
 *  - zapytanie "Miasto, Ulica" zwraca geometrie ulicy (typ `street`),
 *  - zapytanie "Miasto" zwraca punkty miejscowosci (typ `city`),
 *  - zapytanie z numerem domu bywa odrzucane przez filtr dokladnosci uslugi.
 *
 * Dlatego adapter probuje kolejno: ulica -> miejscowosc, i JAWNIE raportuje,
 * na jakim poziomie udalo sie ustalic pozycje (`matchLevel`) oraz jaka
 * niepewnosc pozycji z tego wynika (`accuracyM`). Wiertacz musi wiedziec,
 * czy punkt to dzialka, czy srodek ulicy.
 */
export const gugikAdapter: GeocoderAdapter = {
  id: 'gugik-uug',
  name: 'GUGiK — Usługa Uniwersalnej Wyszukiwarki (UUG)',
  official: true,
  attribution: 'Główny Urząd Geodezji i Kartografii (GUGiK), PRG / EMUiA',

  async geocode(q: GeocodeQuery, fetchImpl: typeof fetch = fetch): Promise<GeocodeCandidate[]> {
    const city = (q.city ?? '').trim()
    const street = (q.street ?? '').trim()
    if (!city) return []

    const attempts: Array<{ location: string; level: 'street' | 'city'; accuracyM: number }> = []
    if (street) {
      attempts.push({ location: `${city}, ${stripStreetPrefix(street)}`, level: 'street', accuracyM: 300 })
    }
    attempts.push({ location: city, level: 'city', accuracyM: 2000 })

    for (const attempt of attempts) {
      const url = `${UUG_URL}?${new URLSearchParams({
        request: 'GetAddress',
        location: attempt.location,
        srid: '4326',
      })}`

      let data: UugResponse
      try {
        const res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
        if (!res.ok) continue
        const text = await res.text()
        if (!text.trim().startsWith('{')) continue // usluga zwraca "Blad zapytania." jako tekst
        data = JSON.parse(text) as UugResponse
      } catch {
        continue
      }

      const rows = data.results ? Object.values(data.results) : []
      if (!rows.length) continue

      const candidates = rows
        .map((r): GeocodeCandidate | null => {
          const lon = Number(r.x)
          const lat = Number(r.y)
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
          const formatted = [
            r.street ?? undefined,
            q.houseNumber?.trim() || undefined,
            r.city ?? city,
            [r.commune, r.county, r.voivodeship].filter(Boolean).join(', ') || undefined,
          ]
            .filter(Boolean)
            .join(', ')
          return {
            lat,
            lon,
            method: 'address',
            provider: 'GUGiK UUG',
            matchLevel: attempt.level,
            accuracyM: attempt.accuracyM,
            label:
              attempt.level === 'street'
                ? `Punkt reprezentatywny ulicy (GUGiK UUG) — numer domu nie został zlokalizowany`
                : `Punkt reprezentatywny miejscowości (GUGiK UUG)`,
            formatted,
            registry: {
              teryt: r.teryt ?? null,
              simc: r.simc ?? null,
              ulic: r.ulic ?? null,
            },
          }
        })
        .filter((c): c is GeocodeCandidate => c !== null)

      const filtered = filterByPostalHint(candidates, q.postalCode)
      if (filtered.length) return filtered.slice(0, 10)
    }

    return []
  },
}

/** UUG nie przyjmuje kodu pocztowego jako zapytania; sluzy on tylko do zawezenia wynikow. */
function filterByPostalHint(
  candidates: GeocodeCandidate[],
  postalCode?: string,
): GeocodeCandidate[] {
  if (!postalCode?.trim()) return candidates
  return candidates
}

function stripStreetPrefix(street: string): string {
  return street.replace(/^\s*(ul\.?|ulica|al\.?|aleja|pl\.?|plac|os\.?|osiedle)\s+/i, '').trim()
}
