import type { GeocodeCandidate, GeocodeQuery, GeocoderAdapter } from './index'
import {
  foldPl,
  normalizePostalCode,
  splitHouseNumber,
  stripCityPrefix,
  stripStreetPrefix,
  tidy,
} from './normalize'

const UUG_URL = 'https://services.gugik.gov.pl/uug/'

interface UugRow {
  city?: string | null
  citypart?: string | null
  street?: string | null
  number?: string | null
  code?: string | null
  teryt?: string | null
  simc?: string | null
  ulic?: string | null
  /** Sciezka administracyjna w formacie {Polska,mazowieckie,minski,"Minsk Mazowiecki"}. */
  jednostka?: string | null
  x?: string
  y?: string
  accuracy?: string
}

interface UugResponse {
  type?: string
  'found objects'?: number
  'returned objects'?: number
  results?: Record<string, UugRow> | null
}

interface Attempt {
  location: string
  level: 'address' | 'street' | 'city'
  accuracyM: number
  label: string
}

/**
 * Usluga Uniwersalnej Wyszukiwarki GUGiK (UUG) - oficjalne, otwarte zrodlo
 * panstwowe dla lokalizacji adresow w Polsce.
 *
 * Zachowanie uslugi (zweryfikowane empirycznie na zywej usludze):
 *  - "Minsk Mazowiecki, Warszawska 10" zwraca PUNKT ADRESOWY z numerem domu,
 *    kodem pocztowym i identyfikatorami TERYT/SIMC/ULIC,
 *  - "Wola Kielpinska 10" (wies bez ulic) rowniez zwraca punkt adresowy,
 *  - "Warszawa, Marszalkowska" zwraca geometrie ulicy (typ `street`),
 *  - "Warszawa" zwraca punkt miejscowosci (typ `city`),
 *  - nieistniejacy numer daje `found objects > 0` przy `returned objects: 0` -
 *    usluga odrzuca dopasowanie wlasnym filtrem `only exact numbers`.
 *
 * Adapter schodzi kaskada od najdokladniejszego zapytania do najogolniejszego
 * i JAWNIE raportuje, na jakim poziomie ustalil pozycje (`matchLevel`) oraz
 * jaka niepewnosc z tego wynika (`accuracyM`). Wiertacz musi wiedziec, czy
 * punkt to dzialka, czy srodek miejscowosci.
 */
export const gugikAdapter: GeocoderAdapter = {
  id: 'gugik-uug',
  name: 'GUGiK — Usługa Uniwersalnej Wyszukiwarki (UUG)',
  official: true,
  attribution: 'Główny Urząd Geodezji i Kartografii (GUGiK), PRG / EMUiA',

  async geocode(q: GeocodeQuery, fetchImpl: typeof fetch = fetch): Promise<GeocodeCandidate[]> {
    const city = stripCityPrefix(tidy(q.city ?? ''))
    const street = stripStreetPrefix(tidy(q.street ?? ''))
    const postal = normalizePostalCode(q.postalCode ?? '')
    if (!city) return []

    for (const attempt of buildAttempts(city, street, q.houseNumber ?? '')) {
      const rows = await queryUug(attempt.location, fetchImpl)
      if (!rows.length) continue

      const candidates = rows
        .map((r) => toCandidate(r, attempt, city, q.houseNumber ?? ''))
        .filter((c): c is GeocodeCandidate => c !== null)
      if (!candidates.length) continue

      return narrowByPostalCode(candidates, postal).slice(0, 10)
    }

    return []
  },
}

/**
 * Kaskada zapytan - od najdokladniejszego do najogolniejszego.
 * Pierwsza proba, ktora cokolwiek zwroci, konczy poszukiwania.
 */
function buildAttempts(city: string, street: string, houseNumberRaw: string): Attempt[] {
  const attempts: Attempt[] = []
  const hn = houseNumberRaw.trim() ? splitHouseNumber(houseNumberRaw) : null

  if (hn) {
    // Punkt adresowy: z ulica (miasta) albo bez niej (wsie o zabudowie numerowanej).
    attempts.push({
      location: street ? `${city}, ${street} ${hn.full}` : `${city} ${hn.full}`,
      level: 'address',
      accuracyM: 15,
      label: 'Punkt adresowy z rejestru EMUiA (GUGiK UUG) — numer domu zlokalizowany',
    })
    // "10A" nieznane usludze, ale "10" zwykle tak - to wciaz kilka metrow, nie 300.
    if (hn.base) {
      attempts.push({
        location: street ? `${city}, ${street} ${hn.base}` : `${city} ${hn.base}`,
        level: 'address',
        accuracyM: 40,
        label: `Punkt adresowy dla numeru „${hn.base}” — wyróżnika „${hn.full}” nie ma w rejestrze`,
      })
    }
  }

  if (street) {
    attempts.push({
      location: `${city}, ${street}`,
      level: 'street',
      accuracyM: 300,
      label: 'Punkt reprezentatywny ulicy (GUGiK UUG) — numer domu nie został zlokalizowany',
    })
  }

  attempts.push({
    location: city,
    level: 'city',
    accuracyM: 2000,
    label: 'Punkt reprezentatywny miejscowości (GUGiK UUG)',
  })

  return attempts
}

async function queryUug(location: string, fetchImpl: typeof fetch): Promise<UugRow[]> {
  const url = `${UUG_URL}?${new URLSearchParams({
    request: 'GetAddress',
    location,
    srid: '4326',
  })}`

  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const text = await res.text()
    // Usluga na bledne zapytanie odpowiada zwyklym tekstem, nie JSON-em.
    if (!text.trim().startsWith('{')) return []
    const data = JSON.parse(text) as UugResponse
    return data.results ? Object.values(data.results) : []
  } catch {
    return []
  }
}

function toCandidate(
  r: UugRow,
  attempt: Attempt,
  fallbackCity: string,
  requestedNumber: string,
): GeocodeCandidate | null {
  const lon = Number(r.x)
  const lat = Number(r.y)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  // Numer bierzemy z odpowiedzi uslugi, nie z pola formularza: tylko to, co
  // zwrocil rejestr, jest faktycznie zlokalizowane. Doklejanie numeru
  // wpisanego przez uzytkownika do wyniku ulicowego sugerowaloby precyzje,
  // ktorej ten punkt nie ma.
  const number =
    attempt.level === 'address' ? (r.number ?? (requestedNumber.trim() || null)) : null

  const formatted = [
    [r.street ?? undefined, number ?? undefined].filter(Boolean).join(' ') || undefined,
    [r.code ?? undefined, r.city ?? fallbackCity].filter(Boolean).join(' '),
    r.citypart ?? undefined,
    administrativePath(r.jednostka),
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
    label: attempt.label,
    formatted,
    registry: {
      teryt: r.teryt ?? null,
      simc: r.simc ?? null,
      ulic: r.ulic ?? null,
      code: r.code ?? null,
    },
  }
}

/** "{Polska,mazowieckie,minski,"Minsk Mazowiecki"}" -> "mazowieckie, miński". */
function administrativePath(jednostka: string | null | undefined): string | undefined {
  if (!jednostka) return undefined
  const parts = jednostka
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((p) => p.trim().replace(/^"|"$/g, ''))
    .filter((p) => p && p.toLowerCase() !== 'polska')
  if (!parts.length) return undefined
  return parts.slice(0, 2).join(', ')
}

/**
 * Kod pocztowy sluzy do zawezenia wynikow po stronie aplikacji - UUG nie
 * przyjmuje go jako kryterium zapytania. Filtr jest nie-destrukcyjny: jesli
 * odrzucilby wszystko (np. uzytkownik pomylil kod), oddajemy pelna liste,
 * bo lepszy niepewny wynik do wyboru niz komunikat "nie znaleziono".
 */
function narrowByPostalCode(
  candidates: GeocodeCandidate[],
  postal: string | null,
): GeocodeCandidate[] {
  if (!postal) return candidates
  const want = foldPl(postal)
  const hit = candidates.filter((c) => {
    const code = c.registry?.code
    return code ? foldPl(code) === want : false
  })
  return hit.length ? hit : candidates
}
