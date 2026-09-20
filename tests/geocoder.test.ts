import { describe, expect, it } from 'vitest'
import { gugikAdapter } from '../server/geocoder/gugikAdapter'
import { geocodeParcel, isPlausibleParcelId } from '../server/geocoder/uldkAdapter'
import {
  normalizePostalCode,
  splitHouseNumber,
  stripCityPrefix,
  stripStreetPrefix,
} from '../server/geocoder/normalize'
import { parseCoords } from '../src/coords'

/**
 * Odpowiedzi uslug sa zrzutami z zywych serwisow GUGiK (UUG i ULDK),
 * zebranymi przy projektowaniu adaptera. Testy pilnuja przede wszystkim
 * tego, co bylo zepsute: numer domu musi trafiac do zapytania, a poziom
 * dopasowania musi byc raportowany zgodnie z prawda.
 */

const UUG_ADDRESS = JSON.stringify({
  type: 'address',
  'found objects': 15,
  'returned objects': 1,
  results: {
    '1': {
      city: 'Mińsk Mazowiecki',
      citypart: null,
      street: 'Warszawska',
      number: '10',
      teryt: '141201',
      simc: '0975687',
      ulic: '23682',
      code: '05-300',
      jednostka: '{Polska,mazowieckie,miński,"Mińsk Mazowiecki"}',
      x: '21.5435556620289',
      y: '52.1863487628189',
      accuracy: '1',
    },
  },
})

const UUG_VILLAGE = JSON.stringify({
  type: 'address',
  'returned objects': 1,
  results: {
    '1': {
      city: 'Wola Kiełpińska',
      street: null,
      number: '10',
      teryt: '140804',
      simc: '0008390',
      ulic: null,
      code: '05-140',
      jednostka: '{Polska,mazowieckie,legionowski,Serock}',
      x: '20.991353230254',
      y: '52.5018838781891',
    },
  },
})

const UUG_STREET = JSON.stringify({
  type: 'street',
  'found objects': 1,
  results: {
    '1': {
      street: 'ulica Marszałkowska',
      city: 'Warszawa',
      teryt: '146501',
      simc: '0918123',
      ulic: '12400',
      x: '21.0123420894858',
      y: '52.2288011708547',
    },
  },
})

/** Usluga odrzuca nieistniejacy numer: znalazla obiekty, ale nie zwraca zadnego. */
const UUG_EMPTY = JSON.stringify({
  type: 'address',
  'found objects': 15,
  'returned objects': 0,
  results: null,
})

/**
 * Udaje usluge UUG i zbiera odpytane adresy.
 * Dopasowanie jest DOKLADNE, bo cala rzecz dotyczy tego, o co adapter pyta:
 * przy dopasowaniu czesciowym zapytanie o "Warszawska 10A" trafiloby w regule
 * dla "Warszawska 10" i test przestalby cokolwiek sprawdzac.
 */
function stubFetch(byQuery: Array<{ match: string; body: string }>) {
  const calls: string[] = []
  const impl = (async (url: string) => {
    calls.push(String(url))
    // Parametr trzeba odczytac przez URLSearchParams: spacje sa kodowane
    // jako "+", wiec samo decodeURIComponent ich nie odtworzy.
    const asked = new URL(String(url)).searchParams.get('location') ?? ''
    const hit = byQuery.find((r) => asked === r.match)
    return {
      ok: true,
      text: async () => hit?.body ?? UUG_EMPTY,
    } as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** Parametr `location` wyslany do uslugi - to on byl sednem usterki. */
function locationsAsked(calls: string[]): string[] {
  return calls.map((u) => new URL(u).searchParams.get('location') ?? '')
}

describe('gugikAdapter — kaskada zapytań', () => {
  it('pyta o numer domu jako pierwszy i zwraca poziom „address”', async () => {
    const { impl, calls } = stubFetch([{ match: 'Mińsk Mazowiecki, Warszawska 10', body: UUG_ADDRESS }])
    const out = await gugikAdapter.geocode(
      { city: 'Mińsk Mazowiecki', street: 'ul. Warszawska', houseNumber: '10' },
      impl,
    )

    expect(locationsAsked(calls)[0]).toBe('Mińsk Mazowiecki, Warszawska 10')
    expect(out).toHaveLength(1)
    expect(out[0].matchLevel).toBe('address')
    expect(out[0].accuracyM).toBe(15)
    expect(out[0].lat).toBeCloseTo(52.18635, 4)
    expect(out[0].lon).toBeCloseTo(21.54356, 4)
  })

  it('obsługuje wieś bez ulicy — „Miejscowość numer”', async () => {
    const { impl, calls } = stubFetch([{ match: 'Wola Kiełpińska 10', body: UUG_VILLAGE }])
    const out = await gugikAdapter.geocode({ city: 'Wola Kiełpińska', houseNumber: '10' }, impl)

    expect(locationsAsked(calls)[0]).toBe('Wola Kiełpińska 10')
    expect(out[0].matchLevel).toBe('address')
    expect(out[0].formatted).toContain('10')
    expect(out[0].formatted).toContain('05-140')
  })

  it('gdy numeru z wyróżnikiem nie ma w rejestrze, próbuje samej liczby', async () => {
    const { impl, calls } = stubFetch([{ match: 'Mińsk Mazowiecki, Warszawska 10', body: UUG_ADDRESS }])
    // "10A" nie istnieje w rejestrze -> UUG_EMPTY; samo "10" juz tak.
    const out = await gugikAdapter.geocode(
      { city: 'Mińsk Mazowiecki', street: 'Warszawska', houseNumber: '10A' },
      impl,
    )
    const asked = locationsAsked(calls)

    expect(asked[0]).toBe('Mińsk Mazowiecki, Warszawska 10A')
    expect(asked[1]).toBe('Mińsk Mazowiecki, Warszawska 10')
    expect(out[0].accuracyM).toBe(40)
    expect(out[0].label).toContain('10A')
  })

  it('schodzi do poziomu ulicy i NIE dokleja numeru, którego nie zlokalizował', async () => {
    const { impl } = stubFetch([{ match: 'Warszawa, Marszałkowska', body: UUG_STREET }])
    const out = await gugikAdapter.geocode(
      { city: 'Warszawa', street: 'Marszałkowska', houseNumber: '12' },
      impl,
    )

    expect(out[0].matchLevel).toBe('street')
    expect(out[0].accuracyM).toBe(300)
    // Numer 12 nie zostal zlokalizowany - nie wolno go pokazac jako czesc wyniku.
    expect(out[0].formatted).not.toContain('12')
  })

  it('zdejmuje prefiksy „ul.” i „m. st.” przed wysłaniem zapytania', async () => {
    const { impl, calls } = stubFetch([])
    await gugikAdapter.geocode({ city: 'm. st. Warszawa', street: 'al. Jerozolimskie' }, impl)

    expect(locationsAsked(calls)[0]).toBe('Warszawa, Jerozolimskie')
  })

  it('bez miejscowości nie odpytuje usługi', async () => {
    const { impl, calls } = stubFetch([])
    const out = await gugikAdapter.geocode({ street: 'Warszawska', houseNumber: '10' }, impl)

    expect(out).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('filtr kodu pocztowego nie kasuje wyników, gdy kod się nie zgadza', async () => {
    const { impl } = stubFetch([{ match: 'Mińsk Mazowiecki, Warszawska 10', body: UUG_ADDRESS }])
    const out = await gugikAdapter.geocode(
      { city: 'Mińsk Mazowiecki', street: 'Warszawska', houseNumber: '10', postalCode: '99-999' },
      impl,
    )

    // Lepiej pokazac niepewny wynik do wyboru niz "nie znaleziono".
    expect(out).toHaveLength(1)
    expect(out[0].registry?.code).toBe('05-300')
  })
})

describe('uldkAdapter — działki ewidencyjne', () => {
  const PARCEL_WKT =
    'SRID=2180;POLYGON((674979.387744 482566.884586,674936.977898 482580.47618,' +
    '674897.797149 482593.026733,674882.591677 482540.601222,674902.700647 482533.835193,' +
    '674979.387744 482566.884586))'
  const ULDK_OK = `0\n141201_1.0001.1867/2|${PARCEL_WKT}|mazowieckie|powiat miński|Mińsk Mazowiecki (miasto)|Mińsk Mazowiecki|1867/2\n`

  const uldkFetch = (body: string) =>
    (async () => ({ ok: true, text: async () => body }) as Response) as unknown as typeof fetch

  it('przelicza geometrię PL-1992 na WGS84 i zwraca środek działki', async () => {
    const out = await geocodeParcel('141201_1.0001.1867/2', uldkFetch(ULDK_OK))

    expect(out).not.toBeNull()
    // Dzialka lezy w Minsku Mazowieckim - sprawdzamy, ze uklad nie zostal pomylony.
    expect(out!.lat).toBeGreaterThan(52.15)
    expect(out!.lat).toBeLessThan(52.25)
    expect(out!.lon).toBeGreaterThan(21.5)
    expect(out!.lon).toBeLessThan(21.6)
    expect(out!.matchLevel).toBe('parcel')
    expect(out!.outline.length).toBeGreaterThanOrEqual(5)
    expect(out!.formatted).toContain('1867/2')
  })

  it('niepewność wynika z rozmiaru działki, a nie ze stałej', async () => {
    const out = await geocodeParcel('141201_1.0001.1867/2', uldkFetch(ULDK_OK))
    expect(out!.areaM2).toBeGreaterThan(0)
    expect(out!.accuracyM).toBe(Math.round(Math.sqrt(out!.areaM2! / Math.PI)))
  })

  it('kod statusu inny niż 0 oznacza brak wyniku', async () => {
    const out = await geocodeParcel('141201_1.0001.1867/2', uldkFetch('-1 nie znaleziono\n'))
    expect(out).toBeNull()
  })

  it('odrzuca identyfikator o złym formacie bez odpytywania usługi', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return { ok: true, text: async () => ULDK_OK } as Response
    }) as unknown as typeof fetch

    expect(await geocodeParcel('działka 15', spy)).toBeNull()
    expect(called).toBe(false)
    expect(isPlausibleParcelId('141201_1.0001.1867/2')).toBe(true)
    expect(isPlausibleParcelId('1867/2')).toBe(false)
  })
})

describe('normalizacja wpisu', () => {
  it('rozbija numer domu na część bazową i wyróżnik', () => {
    expect(splitHouseNumber('10A')).toEqual({ full: '10A', base: '10' })
    expect(splitHouseNumber('12 / 3')).toEqual({ full: '12/3', base: '12' })
    expect(splitHouseNumber('10')).toEqual({ full: '10', base: null })
  })

  it('porządkuje kod pocztowy albo odrzuca nie-kod', () => {
    expect(normalizePostalCode('05300')).toBe('05-300')
    expect(normalizePostalCode(' 05-300 ')).toBe('05-300')
    expect(normalizePostalCode('053')).toBeNull()
  })

  it('zdejmuje prefiksy rodzaju ulicy i miejscowości', () => {
    expect(stripStreetPrefix('ul. Warszawska')).toBe('Warszawska')
    expect(stripStreetPrefix('Aleja Róż')).toBe('Róż')
    expect(stripCityPrefix('gm. Serock')).toBe('Serock')
    // Nazwa wlasna zaczynajaca sie tak samo jak prefiks nie moze zostac okaleczona.
    expect(stripCityPrefix('Wolsztyn')).toBe('Wolsztyn')
  })
})

describe('parseCoords', () => {
  it('czyta stopnie dziesiętne w kilku zapisach', () => {
    expect(parseCoords('52.186349, 21.543556')).toEqual({ lat: 52.186349, lon: 21.543556 })
    expect(parseCoords('52,186349 21,543556')).toEqual({ lat: 52.186349, lon: 21.543556 })
  })

  it('czyta zapis stopniowy niezależnie od kolejności', () => {
    const a = parseCoords('52°11\'10.9"N 21°32\'36.8"E')
    expect(a!.lat).toBeCloseTo(52.18636, 4)
    expect(a!.lon).toBeCloseTo(21.54356, 4)

    const b = parseCoords('21°32\'36.8"E 52°11\'10.9"N')
    expect(b!.lat).toBeCloseTo(52.18636, 4)
    expect(b!.lon).toBeCloseTo(21.54356, 4)
  })

  it('odrzuca punkt spoza Polski i zamienione współrzędne', () => {
    expect(parseCoords('21.543556, 52.186349')).toBeNull()
    expect(parseCoords('48.8566, 2.3522')).toBeNull()
    expect(parseCoords('')).toBeNull()
    expect(parseCoords('gdzieś koło Serocka')).toBeNull()
  })
})
