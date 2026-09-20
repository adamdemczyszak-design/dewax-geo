import type { Config } from '@netlify/functions'
import { AuditLog } from '../../server/core/auditLog'
import { buildReport } from '../../server/report/reportBuilder'
import type { ResolvedLocation } from '../../server/types'

/**
 * Analiza geologiczna punktu inwestycji.
 * Cale odpytywanie uslug PGI odbywa sie po stronie serwera - przegladarka
 * nigdy nie laczy sie bezposrednio z CBDG (brak problemow z CORS).
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Dozwolona jest wyłącznie metoda POST.' }, 405)
  }

  let body: {
    lat?: unknown
    lon?: unknown
    targetDepthM?: unknown
    method?: unknown
    matchLevel?: unknown
    locationLabel?: unknown
    accuracyM?: unknown
    heatPumpKw?: unknown
    scop?: unknown
    annualHours?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'Nieprawidłowy JSON w treści żądania.' }, 400)
  }

  const lat = Number(body.lat)
  const lon = Number(body.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'Wymagane poprawne współrzędne lat/lon.' }, 400)
  }
  if (lat < 48.8 || lat > 55.0 || lon < 13.8 || lon > 24.3) {
    return json(
      {
        error:
          'Punkt leży poza obszarem Polski. Baza CBDG obejmuje wyłącznie terytorium RP — analiza nie zostanie wykonana.',
      },
      422,
    )
  }

  const location: ResolvedLocation = {
    lat,
    lon,
    method: asMethod(body.method),
    label:
      typeof body.locationLabel === 'string' && body.locationLabel.trim()
        ? body.locationLabel.trim()
        : 'Punkt wskazany przez użytkownika',
    accuracyM: Number.isFinite(Number(body.accuracyM)) ? Number(body.accuracyM) : null,
    provider: asMethod(body.method) === 'gps' ? 'navigator.geolocation' : 'geokoder',
    // Poziom dopasowania ustala geokoder i musi dotrwac do raportu - to on
    // decyduje, czy wynik dotyczy dzialki, czy calej miejscowosci.
    matchLevel: asMatchLevel(body.matchLevel, asMethod(body.method)),
  }

  const audit = new AuditLog()
  try {
    const heatPumpKw = Number(body.heatPumpKw)
    const scop = Number(body.scop)
    const report = await buildReport({
      location,
      targetDepthM: Number(body.targetDepthM),
      heatPumpKw: Number.isFinite(heatPumpKw) && heatPumpKw > 0 ? Math.min(500, heatPumpKw) : null,
      scop: Number.isFinite(scop) && scop > 1 && scop < 10 ? scop : null,
      annualHours: body.annualHours === 2100 ? 2100 : body.annualHours === 1800 ? 1800 : null,
      audit,
    })
    return json(report, 200)
  } catch (err) {
    return json(
      {
        error: `Analiza nie powiodła się: ${(err as Error).message}`,
        audit: audit.all(),
      },
      502,
    )
  }
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export const config: Config = {
  path: '/api/analyze',
}

const METHODS = ['gps', 'address', 'map', 'parcel'] as const
const LEVELS = ['address', 'street', 'city', 'gps', 'parcel', 'map'] as const

function asMethod(v: unknown): ResolvedLocation['method'] {
  return (METHODS as readonly string[]).includes(v as string)
    ? (v as ResolvedLocation['method'])
    : 'address'
}

function asMatchLevel(
  v: unknown,
  method: ResolvedLocation['method'],
): ResolvedLocation['matchLevel'] {
  if ((LEVELS as readonly string[]).includes(v as string)) {
    return v as ResolvedLocation['matchLevel']
  }
  if (method === 'gps') return 'gps'
  if (method === 'map') return 'map'
  if (method === 'parcel') return 'parcel'
  return undefined
}
