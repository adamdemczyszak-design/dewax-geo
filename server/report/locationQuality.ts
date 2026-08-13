import { normalizePl } from './riskDetector'
import type { LocationQuality, LocationQualityClass } from '../types'

/**
 * Ocena wiarygodności położenia otworu na podstawie pola „podstawa lokalizacji"
 * (PODS_LOKA) z CBDG.
 *
 * Powód: znaczna część otworów archiwalnych ma współrzędne przypisane wg najbliższej
 * miejscowości. Odległość „195 m od punktu" policzona z takiej pozycji jest fałszywą
 * precyzją — rzeczywisty otwór może leżeć kilometr dalej. Raport dowodowy nie może
 * traktować takiego otworu na równi z otworem pomierzonym geodezyjnie.
 *
 * Wartości niepewności są konserwatywnym oszacowaniem rzędu wielkości, nie pomiarem.
 */
const RULES: Array<{ cls: LocationQualityClass; uncertaintyM: number; keywords: string[] }> = [
  {
    cls: 'geodezyjna',
    uncertaintyM: 10,
    keywords: ['gps', 'pomiar geodezyjny', 'geodezyjn', 'pomiar terenowy', 'niwelacj', 'rtk'],
  },
  {
    cls: 'mapowa',
    uncertaintyM: 100,
    keywords: [
      'mapa topograficzna',
      'szkic lokalizacyjny',
      'mapa zasadnicza',
      'ortofotomapa',
      'mapa',
      'szkic',
      'plan',
    ],
  },
  {
    cls: 'przybliżona',
    uncertaintyM: 1000,
    keywords: [
      'wspolrzedne najblizszej miejscowosci',
      'najblizszej miejscowosci',
      'miejscowosci',
      'srodek miejscowosci',
      'orientacyjn',
      'przyblizon',
    ],
  },
]

const NOTES: Record<LocationQualityClass, string> = {
  geodezyjna: 'Położenie otworu pomierzone geodezyjnie — odległość wiarygodna.',
  mapowa:
    'Położenie otworu odczytane z mapy lub szkicu — odległość obarczona niepewnością rzędu 100 m.',
  'przybliżona':
    'Położenie otworu przypisane wg najbliższej miejscowości — rzeczywista lokalizacja może różnić się nawet o ok. 1 km. Odległość ma charakter orientacyjny.',
  nieznana:
    'CBDG nie podaje podstawy lokalizacji otworu — wiarygodności położenia nie da się ocenić.',
}

export function assessLocationQuality(basis: string | null | undefined): LocationQuality {
  const raw = basis?.trim() || null
  if (!raw) {
    return { cls: 'nieznana', uncertaintyM: 500, basis: null, note: NOTES.nieznana }
  }
  const hay = normalizePl(raw)
  // Kolejność reguł ma znaczenie: najpierw najdokładniejsze, potem coraz gorsze.
  // „przybliżona" sprawdzana jest jako pierwsza wśród słów o miejscowości, bo opis
  // typu „współrzędne najbliższej miejscowości" bywa łączony z innymi określeniami.
  for (const kw of RULES[2].keywords) {
    if (hay.includes(normalizePl(kw))) {
      return { cls: 'przybliżona', uncertaintyM: RULES[2].uncertaintyM, basis: raw, note: NOTES['przybliżona'] }
    }
  }
  for (const rule of [RULES[0], RULES[1]]) {
    for (const kw of rule.keywords) {
      if (hay.includes(normalizePl(kw))) {
        return { cls: rule.cls, uncertaintyM: rule.uncertaintyM, basis: raw, note: NOTES[rule.cls] }
      }
    }
  }
  return { cls: 'nieznana', uncertaintyM: 500, basis: raw, note: NOTES.nieznana }
}

/** Waga dowodowa klasy lokalizacji (0–1) — używana w ocenie wiarygodności raportu. */
export function locationWeight(cls: LocationQualityClass): number {
  switch (cls) {
    case 'geodezyjna':
      return 1
    case 'mapowa':
      return 0.75
    case 'nieznana':
      return 0.4
    case 'przybliżona':
      return 0.2
  }
}
