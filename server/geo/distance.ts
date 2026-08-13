import proj4 from 'proj4'
import type { LatLon } from '../types'

/** Promien Ziemi wg sredniej promienia kuli WGS84 (IUGG) [m]. */
export const EARTH_RADIUS_M = 6371008.8

/** PL-1992 (EPSG:2180) - uklad wspolrzednych plaskich uzywany przez CBDG. */
export const EPSG_2180 =
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

export const EPSG_4326 = '+proj=longlat +datum=WGS84 +no_defs'

proj4.defs('EPSG:2180', EPSG_2180)

const toRad = (deg: number): number => (deg * Math.PI) / 180

/**
 * Odleglosc ortodromiczna miedzy dwoma punktami (wzor haversine) w metrach.
 * Blad wzgledem elipsoidy < 0.5% - w zupelnosci wystarczajacy dla promieni <= 5 km.
 */
export function haversineDistanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Azymut poczatkowy z punktu a do b w stopniach (0 = polnoc, rosnaco zgodnie z ruchem wskazowek). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLon = toRad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/** Kierunek swiata (16-dzielny) - uzywany w opisie otworu w raporcie. */
export function compassPl(a: LatLon, b: LatLon): string {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ]
  const idx = Math.round(bearingDeg(a, b) / 22.5) % 16
  return dirs[idx]
}

/** WGS84 (lon/lat) -> PL-1992 (x/y w metrach). */
export function toPl1992(p: LatLon): { x: number; y: number } {
  const [x, y] = proj4(EPSG_4326, EPSG_2180, [p.lon, p.lat])
  return { x, y }
}

/** PL-1992 (x/y w metrach) -> WGS84 (lat/lon). */
export function fromPl1992(x: number, y: number): LatLon {
  const [lon, lat] = proj4(EPSG_2180, EPSG_4326, [x, y])
  return { lat, lon }
}

/** Kwadratowa obwiednia (w PL-1992) wokol punktu - do zapytan przestrzennych ArcGIS. */
export function envelopePl1992(center: LatLon, radiusM: number) {
  const { x, y } = toPl1992(center)
  return {
    xmin: x - radiusM,
    ymin: y - radiusM,
    xmax: x + radiusM,
    ymax: y + radiusM,
  }
}
