import type { Config } from '@netlify/functions'
import { suggest } from '../../server/geocoder/suggestAdapter'

/**
 * Podpowiedzi nazw miejscowosci i ulic przy wpisywaniu.
 *
 * Zwraca WYLACZNIE tekst do wstawienia w pole formularza - wspolrzedne
 * punktu ustala pozniej kaskada GUGiK UUG w /api/geocode. Modul jest
 * calkowicie odseparowany od danych geologicznych.
 */
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') === 'street' ? 'street' : 'city'
  const q = url.searchParams.get('q') ?? ''

  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  const near =
    Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0
      ? { lat, lon }
      : undefined

  try {
    const suggestions = await suggest(kind, q, near)
    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Podpowiedzi dla tego samego przedrostka sa identyczne dla wszystkich.
        'cache-control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    // Brak podpowiedzi nie moze blokowac pracy z formularzem - user
    // zawsze moze wpisac nazwe recznie i uruchomic wyszukiwanie.
    return new Response(
      JSON.stringify({ suggestions: [], error: (err as Error).message }),
      { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }
}

export const config: Config = {
  path: '/api/suggest',
}
