import { beforeEach, describe, expect, it } from 'vitest'
import { clearSuggestCache, suggest } from '../server/geocoder/suggestAdapter'

/**
 * Odpowiedzi sa zrzutami z zywej uslugi Photon. Testy pilnuja tego, co
 * decyduje o uzytecznosci listy: braku duplikatow, odciecia zagranicy
 * i odsiania obiektow, ktore nie sa ulicami.
 */

// Cache zyje w module, wiec bez tego kolejny test z tym samym przedrostkiem
// dostalby odpowiedz poprzedniego zamiast odpytac swoj stub.
beforeEach(() => clearSuggestCache())

function feature(props: Record<string, unknown>, lon = 21, lat = 52) {
  return { properties: props, geometry: { coordinates: [lon, lat] } }
}

function stub(features: unknown[]) {
  const urls: string[] = []
  const impl = (async (url: string) => {
    urls.push(String(url))
    return { ok: true, json: async () => ({ features }) } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, urls }
}

describe('podpowiedzi miejscowości', () => {
  it('nie odpytuje usługi poniżej trzech znaków', async () => {
    const { impl, urls } = stub([])
    expect(await suggest('city', 'Wo', undefined, impl)).toEqual([])
    expect(urls).toHaveLength(0)
  })

  it('rozróżnia miejscowości o tej samej nazwie po powiecie', async () => {
    const { impl } = stub([
      feature({ name: 'Wólka', county: 'powiat lubelski', state: 'lubelskie', countrycode: 'PL' }),
      feature({ name: 'Wólka', county: 'powiat siedlecki', state: 'mazowieckie', countrycode: 'PL' }),
      // Ten sam obiekt zwrocony po raz drugi - do odsiania.
      feature({ name: 'Wólka', county: 'powiat lubelski', state: 'lubelskie', countrycode: 'PL' }),
    ])
    const out = await suggest('city', 'Wólka', undefined, impl)

    expect(out).toHaveLength(2)
    expect(out[0].context).toBe('powiat lubelski, lubelskie')
    expect(out[1].context).toBe('powiat siedlecki, mazowieckie')
  })

  it('odcina wyniki spoza Polski', async () => {
    const { impl } = stub([
      feature({ name: 'Berlin', countrycode: 'DE', state: 'Berlin' }),
      feature({ name: 'Berlin', countrycode: 'PL', county: 'powiat mielecki' }),
    ])
    const out = await suggest('city', 'Berlin', undefined, impl)

    expect(out).toHaveLength(1)
    expect(out[0].context).toBe('powiat mielecki')
  })

  it('niesie punkt orientacyjny do zawężenia podpowiedzi ulic', async () => {
    const { impl } = stub([
      feature({ name: 'Serock', countrycode: 'PL', county: 'powiat legionowski' }, 21.07, 52.5),
    ])
    const out = await suggest('city', 'Seroc', undefined, impl)

    expect(out[0].hint).toEqual({ lat: 52.5, lon: 21.07 })
  })

  it('ogranicza listę do ośmiu pozycji', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      feature({ name: `Wola ${i}`, countrycode: 'PL', county: `powiat ${i}` }),
    )
    const out = await suggest('city', 'Wola', undefined, stub(many).impl)
    expect(out).toHaveLength(8)
  })

  it('szuka miejscowości w ramce Polski', async () => {
    const { impl, urls } = stub([])
    await suggest('city', 'Kraków', undefined, impl)

    const p = new URL(urls[0]).searchParams
    expect(p.get('osm_tag')).toBe('place')
    expect(p.get('bbox')).toBe('14.07,49.0,24.15,54.9')
  })
})

describe('podpowiedzi ulic', () => {
  it('scala odcinki tej samej ulicy w jedną pozycję', async () => {
    const seg = { name: 'Marszałkowska', city: 'Warszawa', district: 'Śródmieście', countrycode: 'PL', osm_value: 'secondary' }
    const { impl } = stub([feature(seg), feature(seg), feature(seg)])
    const out = await suggest('street', 'Marsza', { lat: 52.23, lon: 21.01 }, impl)

    expect(out).toHaveLength(1)
    expect(out[0].value).toBe('Marszałkowska')
    expect(out[0].context).toBe('Warszawa, Śródmieście')
  })

  it('ta sama nazwa ulicy w dwóch miastach to dwie pozycje', async () => {
    const { impl } = stub([
      feature({ name: 'Polna', city: 'Serock', countrycode: 'PL', osm_value: 'residential' }),
      feature({ name: 'Polna', city: 'Zegrze', countrycode: 'PL', osm_value: 'residential' }),
    ])
    const out = await suggest('street', 'Poln', { lat: 52.5, lon: 21.07 }, impl)
    expect(out).toHaveLength(2)
  })

  it('odrzuca obiekty, które nie są ulicami', async () => {
    const { impl } = stub([
      feature({ name: 'Centrum 12', city: 'Warszawa', countrycode: 'PL', osm_value: 'bus_stop' }),
      feature({ name: 'Marszałkowska', city: 'Warszawa', countrycode: 'PL', osm_value: 'secondary' }),
    ])
    const out = await suggest('street', 'Mar', { lat: 52.23, lon: 21.01 }, impl)

    expect(out).toHaveLength(1)
    expect(out[0].value).toBe('Marszałkowska')
  })

  it('zawęża szukanie ulic do okolicy wybranej miejscowości', async () => {
    const { impl, urls } = stub([])
    await suggest('street', 'Polna', { lat: 52.5, lon: 21.07 }, impl)

    const p = new URL(urls[0]).searchParams
    expect(p.get('osm_tag')).toBe('highway')
    // Ramka +/-0.2 stopnia wokol miejscowosci, nie cala Polska.
    expect(p.get('bbox')).toBe('20.8700,52.3000,21.2700,52.7000')
    expect(p.get('lat')).toBe('52.5')
  })

  it('awaria usługi nie wywraca formularza — zwraca pustą listę', async () => {
    const impl = (async () => {
      throw new Error('brak sieci')
    }) as unknown as typeof fetch

    await expect(suggest('city', 'Warszawa', undefined, impl)).resolves.toEqual([])
  })
})
