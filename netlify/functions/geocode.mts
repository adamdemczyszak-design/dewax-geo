import type { Config } from '@netlify/functions'
import { geocodeAddress } from '../../server/geocoder/geocoderService'

/**
 * Geokodowanie adresu. Modul jest calkowicie odseparowany od danych geologicznych.
 */
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const q = {
    street: url.searchParams.get('street') ?? undefined,
    houseNumber: url.searchParams.get('houseNumber') ?? undefined,
    postalCode: url.searchParams.get('postalCode') ?? undefined,
    city: url.searchParams.get('city') ?? undefined,
  }

  if (!q.city?.trim()) {
    return json({ error: 'Pole „miejscowość" jest wymagane do geokodowania.' }, 400)
  }

  try {
    const outcome = await geocodeAddress(q)
    return json(outcome, 200)
  } catch (err) {
    return json({ error: `Błąd geokodera: ${(err as Error).message}` }, 502)
  }
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export const config: Config = {
  path: '/api/geocode',
}
