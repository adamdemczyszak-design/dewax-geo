import proj4 from 'proj4'
import type { GeocodeCandidate } from './index'
import { tidy } from './normalize'

const ULDK_URL = 'https://uldk.gugik.gov.pl/'

/**
 * Uklad PL-1992 (EPSG:2180) - w nim ULDK zwraca geometrie dzialek.
 * Kolejnosc wspolrzednych w zwracanym WKT to (easting northing).
 */
const PL1992 =
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

export interface ParcelResult extends GeocodeCandidate {
  /** Obrys dzialki w WGS84 - do narysowania na mapie wyboru punktu. */
  outline: Array<[number, number]>
  areaM2: number | null
}

/**
 * Usluga Lokalizacji Dzialek Katastralnych (ULDK) GUGiK.
 *
 * Dla wiertacza numer dzialki bywa pewniejszy niz adres: dzialka
 * niezabudowana czesto NIE MA jeszcze adresu, a odwiert i tak wykonuje sie
 * na dzialce, nie pod numerem domu. ULDK zwraca pelny obrys, wiec zamiast
 * pojedynczego punktu mozemy pokazac granice i pozwolic wskazac miejsce
 * odwiertu wewnatrz nich.
 *
 * Format odpowiedzi (tekst, nie JSON):
 *   linia 1: kod statusu ("0" = sukces, "-1" = blad)
 *   linia 2: pola rozdzielone znakiem "|", zgodnie z parametrem `result`
 */
export async function geocodeParcel(
  parcelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParcelResult | null> {
  const id = tidy(parcelId)
  if (!isPlausibleParcelId(id)) return null

  const url = `${ULDK_URL}?${new URLSearchParams({
    request: 'GetParcelById',
    id,
    result: 'teryt,geom_wkt,voivodeship,county,commune,region,parcel',
  })}`

  let text: string
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'text/plain' } })
    if (!res.ok) return null
    text = await res.text()
  } catch {
    return null
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length || lines[0] !== '0') return null

  const cols = lines[1]?.split('|') ?? []
  const [teryt, geomWkt, voivodeship, county, commune, region, parcel] = cols
  if (!geomWkt) return null

  const outline = wktPolygonToWgs84(geomWkt)
  if (outline.length < 3) return null

  const { lat, lon } = polygonCentroid(outline)
  const areaM2 = polygonAreaM2(geomWkt)

  const formatted = [
    `działka nr ${parcel ?? '?'}`,
    region ? `obręb ${region}` : undefined,
    commune,
    county,
    voivodeship,
  ]
    .filter(Boolean)
    .join(', ')

  return {
    lat,
    lon,
    method: 'address',
    provider: 'GUGiK ULDK',
    matchLevel: 'parcel',
    // Punkt to srodek ciezkosci dzialki; niepewnosc to promien kola o tym samym polu.
    accuracyM: areaM2 ? Math.round(Math.sqrt(areaM2 / Math.PI)) : 100,
    label:
      'Środek geometryczny działki ewidencyjnej (GUGiK ULDK) — wskaż na mapie właściwe miejsce odwiertu',
    formatted,
    registry: { teryt: teryt ?? null, parcel: parcel ?? null, region: region ?? null },
    outline,
    areaM2,
  }
}

/**
 * Identyfikator dzialki wg TERYT ma postac WWPPGG_R.XXXX.NDZ,
 * np. "141201_1.0001.1867/2". Wstepna walidacja oszczedza zbednego zapytania
 * i pozwala od razu powiedziec uzytkownikowi, ze wpisal cos innego.
 */
export function isPlausibleParcelId(id: string): boolean {
  return /^\d{6}_\d+\.\d+\.[\dA-Za-z/\\.-]+$/.test(id.trim())
}

/** Wyciaga pierwszy pierscien poligonu z WKT i przelicza go na WGS84. */
function wktPolygonToWgs84(wkt: string): Array<[number, number]> {
  const body = wkt.replace(/^SRID=\d+;/i, '')
  const m = /\(\(([^)]*)\)/.exec(body)
  if (!m) return []
  return m[1]
    .split(',')
    .map((pair) => {
      const [e, n] = pair.trim().split(/\s+/).map(Number)
      if (!Number.isFinite(e) || !Number.isFinite(n)) return null
      const [lon, lat] = proj4(PL1992, 'EPSG:4326', [e, n])
      return [lat, lon] as [number, number]
    })
    .filter((p): p is [number, number] => p !== null)
}

/** Srodek ciezkosci wielokata (wzor na moment pola), nie srednia wierzcholkow. */
function polygonCentroid(ring: Array<[number, number]>): { lat: number; lon: number } {
  let twiceArea = 0
  let lat = 0
  let lon = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lat1, lon1] = ring[j]
    const [lat2, lon2] = ring[i]
    const f = lon1 * lat2 - lon2 * lat1
    twiceArea += f
    lon += (lon1 + lon2) * f
    lat += (lat1 + lat2) * f
  }
  if (twiceArea === 0) {
    // Zdegenerowany obrys - cofamy sie do sredniej arytmetycznej wierzcholkow.
    const n = ring.length
    return {
      lat: ring.reduce((s, p) => s + p[0], 0) / n,
      lon: ring.reduce((s, p) => s + p[1], 0) / n,
    }
  }
  const k = 1 / (3 * twiceArea)
  return { lat: lat * k, lon: lon * k }
}

/** Pole dzialki liczone w metrach wprost z geometrii PL-1992 (uklad metryczny). */
function polygonAreaM2(wkt: string): number | null {
  const body = wkt.replace(/^SRID=\d+;/i, '')
  const m = /\(\(([^)]*)\)/.exec(body)
  if (!m) return null
  const pts = m[1]
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 2 && p.every(Number.isFinite))
  if (pts.length < 3) return null
  let twice = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    twice += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  }
  return Math.round(Math.abs(twice) / 2)
}
