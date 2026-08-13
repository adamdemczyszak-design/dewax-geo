import type { CbdgClient } from './cbdgClient'
import { ENDPOINTS, pickMpgnBracket } from '../endpoints'
import { toPl1992 } from '../geo/distance'
import type { LatLon, MpgnData, ValueRange } from '../types'

/**
 * Mapa Potencjału Geotermii Niskotemperaturowej (MPGN) PIG-PIB.
 *
 * To jedyne oficjalne źródło parametrów, z których projektuje się dolne źródło:
 *  - λ  — przewodność termiczna gruntu [W/(m·K)] w przedziale 0..H,
 *  - qᵥ — jednostkowa wydajność termiczna otworu [W/m] dla 1800 i 2100 h/rok.
 *
 * Serwis publikuje wartości jako poligony z przedziałem tekstowym (np. "40-45"),
 * dlatego zwracamy zakres min–max, a nie jedną liczbę. Żadna wartość nie jest
 * uśredniana ani interpolowana — brak poligonu w punkcie = brak danych.
 */
export async function loadMpgn(
  client: CbdgClient,
  point: LatLon,
  targetDepthM: number,
): Promise<MpgnData> {
  const bracket = pickMpgnBracket(targetDepthM)
  const p = toPl1992(point)
  const base = ENDPOINTS.MPGN_GEOTERMIA.url

  const query = async (layer: number): Promise<Record<string, unknown> | null> => {
    const res = await client.queryPointInPolygon(`${base}/${layer}`, p.x, p.y, {
      sourceId: 'MPGN_GEOTERMIA',
      stage: 'geotermia:mpgn',
    })
    return res.features[0]?.attributes ?? null
  }

  const [lambdaAttrs, qv1800Attrs, qv2100Attrs] = await Promise.all([
    query(bracket.lambdaLayer).catch(() => null),
    query(bracket.qv1800Layer).catch(() => null),
    query(bracket.qv2100Layer).catch(() => null),
  ])

  return {
    bracketDepthM: bracket.depthM,
    targetDepthM,
    lambdaWmK: parseLambda(lambdaAttrs),
    qv1800Wm: parseRangeField(qv1800Attrs?.ZAKRES),
    qv2100Wm: parseRangeField(qv2100Attrs?.ZAKRES),
    sourceId: 'MPGN_GEOTERMIA',
    sourceUrl: base,
  }
}

/** Warstwy λ mają pola liczbowe OD_FROM/DO_TO oraz tekstowe ZAKRES_RANGE. */
function parseLambda(attrs: Record<string, unknown> | null): ValueRange | null {
  if (!attrs) return null
  const from = Number(attrs.OD_FROM)
  const to = Number(attrs.DO_TO)
  if (Number.isFinite(from) && Number.isFinite(to)) {
    return { min: from, max: to, label: formatRange(from, to) }
  }
  return parseRangeField(attrs.ZAKRES_RANGE)
}

/** Warstwy qᵥ mają wyłącznie tekst typu "40-45" (bywa też "1,4-1,7"). */
export function parseRangeField(v: unknown): ValueRange | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim().replace(/,/g, '.')
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/)
  if (m) {
    const min = Number(m[1])
    const max = Number(m[2])
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max, label: formatRange(min, max) }
    }
  }
  const single = Number(s)
  if (Number.isFinite(single)) return { min: single, max: single, label: formatRange(single, single) }
  return null
}

function formatRange(min: number, max: number): string {
  const f = (n: number) => String(n).replace('.', ',')
  return min === max ? f(min) : `${f(min)}–${f(max)}`
}
