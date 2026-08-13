import { describe, it, expect } from 'vitest'
import {
  haversineDistanceM,
  bearingDeg,
  compassPl,
  toPl1992,
  fromPl1992,
  envelopePl1992,
} from '../server/geo/distance'

describe('haversineDistanceM', () => {
  it('zwraca 0 dla tego samego punktu', () => {
    const p = { lat: 52.2297, lon: 21.0122 }
    expect(haversineDistanceM(p, p)).toBe(0)
  })

  it('liczy odleglosc 1 stopnia szerokosci geograficznej (~111.2 km)', () => {
    const d = haversineDistanceM({ lat: 52, lon: 21 }, { lat: 53, lon: 21 })
    expect(d).toBeGreaterThan(111_100)
    expect(d).toBeLessThan(111_300)
  })

  it('liczy odleglosc Warszawa - Krakow z bledem < 0.5%', () => {
    // Wartosc referencyjna ortodromy: ok. 252 km
    const d = haversineDistanceM({ lat: 52.2297, lon: 21.0122 }, { lat: 50.0647, lon: 19.945 })
    expect(d).toBeGreaterThan(251_000)
    expect(d).toBeLessThan(253_500)
  })

  it('jest symetryczna', () => {
    const a = { lat: 52.4, lon: 16.9 }
    const b = { lat: 51.1, lon: 17.03 }
    expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 6)
  })

  it('poprawnie liczy male dystanse rzedu setek metrow', () => {
    // 0.001 stopnia szerokosci = ok. 111.2 m
    const d = haversineDistanceM({ lat: 52.0, lon: 21.0 }, { lat: 52.001, lon: 21.0 })
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })

  it('uwzglednia zbieznosc poludnikow (1 stopien dlugosci na 52N jest krotszy)', () => {
    const lat = haversineDistanceM({ lat: 52, lon: 21 }, { lat: 53, lon: 21 })
    const lon = haversineDistanceM({ lat: 52, lon: 21 }, { lat: 52, lon: 22 })
    expect(lon).toBeLessThan(lat * 0.65)
    expect(lon).toBeGreaterThan(lat * 0.55)
  })
})

describe('bearingDeg / compassPl', () => {
  it('azymut na polnoc wynosi ~0', () => {
    expect(bearingDeg({ lat: 52, lon: 21 }, { lat: 52.1, lon: 21 })).toBeCloseTo(0, 1)
  })
  it('azymut na wschod wynosi ~90', () => {
    expect(bearingDeg({ lat: 52, lon: 21 }, { lat: 52, lon: 21.1 })).toBeCloseTo(90, 0)
  })
  it('azymut jest zawsze w zakresie 0-360', () => {
    const b = bearingDeg({ lat: 52, lon: 21 }, { lat: 51.9, lon: 20.9 })
    expect(b).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThan(360)
  })
  it('zwraca kierunek swiata', () => {
    expect(compassPl({ lat: 52, lon: 21 }, { lat: 52.1, lon: 21 })).toBe('N')
    expect(compassPl({ lat: 52, lon: 21 }, { lat: 52, lon: 21.1 })).toBe('E')
    expect(compassPl({ lat: 52, lon: 21 }, { lat: 51.9, lon: 21 })).toBe('S')
  })
})

describe('transformacja PL-1992 (EPSG:2180)', () => {
  it('konwersja tam i z powrotem zachowuje pozycje z dokladnoscia < 1 mm', () => {
    const p = { lat: 52.2297, lon: 21.0122 }
    const xy = toPl1992(p)
    const back = fromPl1992(xy.x, xy.y)
    expect(back.lat).toBeCloseTo(p.lat, 9)
    expect(back.lon).toBeCloseTo(p.lon, 9)
  })

  it('zwraca wspolrzedne w zakresie obowiazujacym dla Polski', () => {
    const { x, y } = toPl1992({ lat: 52.2297, lon: 21.0122 })
    // Zakres PL-1992: X (northing) ok. 130-900 km, Y (easting) ok. 140-880 km
    expect(x).toBeGreaterThan(100_000)
    expect(x).toBeLessThan(950_000)
    expect(y).toBeGreaterThan(100_000)
    expect(y).toBeLessThan(950_000)
  })

  it('odleglosc w PL-1992 zgadza sie z haversine z dokladnoscia < 0.2% na 5 km', () => {
    const a = { lat: 52.2297, lon: 21.0122 }
    const b = { lat: 52.2697, lon: 21.0522 }
    const hav = haversineDistanceM(a, b)
    const pa = toPl1992(a)
    const pb = toPl1992(b)
    const planar = Math.hypot(pa.x - pb.x, pa.y - pb.y)
    expect(Math.abs(planar - hav) / hav).toBeLessThan(0.002)
  })

  it('obwiednia ma bok rowny 2 x promien', () => {
    const env = envelopePl1992({ lat: 52.2297, lon: 21.0122 }, 500)
    expect(env.xmax - env.xmin).toBeCloseTo(1000, 6)
    expect(env.ymax - env.ymin).toBeCloseTo(1000, 6)
  })
})
