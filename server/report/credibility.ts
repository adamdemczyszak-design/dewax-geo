import { locationWeight } from './locationQuality'
import type { BoreholeDetail, SyntheticLayer } from '../types'

export type CredibilityGrade = 'wysoka' | 'umiarkowana' | 'niska' | 'orientacyjna'

export interface CredibilityAssessment {
  score: number
  grade: CredibilityGrade
  /** Zdania wyjaśniające, co obniża lub podnosi ocenę — kolejność: najważniejsze pierwsze. */
  reasons: string[]
  /** Jednozdaniowy werdykt do nagłówka raportu. */
  headline: string
  breakdown: {
    coverage: number
    boreholeCount: number
    proximity: number
    locationQuality: number
    elevationCorrection: number
  }
}

const MAX = { coverage: 35, boreholeCount: 20, proximity: 25, locationQuality: 12, elevation: 8 }

export interface CredibilityInput {
  coveragePct: number
  layers: SyntheticLayer[]
  boreholes: BoreholeDetail[]
  targetDepthM: number
  /** Czy udało się pobrać rzędną terenu i skorygować profil wysokościowo. */
  elevationCorrected: boolean
}

/**
 * Ocena wiarygodności raportu.
 *
 * Powstała, bo samo „pokrycie 100%" jest komunikatem mylącym: profil zszyty
 * z JEDNEGO otworu z 1958 r. oddalonego o 500 m, o lokalizacji przypisanej wg
 * najbliższej miejscowości, ma pokrycie 100% i zerową wartość projektową.
 * Nagłówek raportu musi mówić prawdę bez czytania sekcji dowodowej.
 */
export function assessCredibility(input: CredibilityInput): CredibilityAssessment {
  const { coveragePct, layers, boreholes, elevationCorrected } = input
  const used = layers.filter((l) => !l.noData && l.evidence)
  const usedIds = new Set(used.map((l) => l.evidence!.cbdgId))
  const usedBoreholes = boreholes.filter((b) => usedIds.has(b.cbdgId))
  const distances = used.map((l) => l.evidence!.distanceM)

  const reasons: string[] = []

  // 1. Pokrycie profilu
  const coverage = (Math.max(0, Math.min(100, coveragePct)) / 100) * MAX.coverage
  if (coveragePct < 100) {
    const gapM = layers.filter((l) => l.noData).reduce((s, l) => s + (l.toM - l.fromM), 0)
    reasons.push(
      `Profil pokryty danymi w ${coveragePct}% — ${round1(gapM)} m zakresu bez jakichkolwiek danych CBDG.`,
    )
  }

  // 2. Liczba niezależnych otworów
  const n = usedIds.size
  const boreholeCount = n === 0 ? 0 : n === 1 ? 4 : n === 2 ? 10 : n === 3 ? 15 : MAX.boreholeCount
  if (n === 0) {
    reasons.push('Żaden otwór CBDG nie dostarczył danych do profilu.')
  } else if (n === 1) {
    reasons.push(
      'Cały profil pochodzi z JEDNEGO otworu — brak potwierdzenia krzyżowego. Zmienność warunków między otworami jest nieznana.',
    )
  } else if (n === 2) {
    reasons.push('Profil oparty na dwóch otworach — potwierdzenie krzyżowe minimalne.')
  }

  // 3. Bliskość dowodów
  const maxDist = distances.length ? Math.max(...distances) : Infinity
  const proximity = !distances.length
    ? 0
    : maxDist <= 100
      ? MAX.proximity
      : maxDist <= 250
        ? 20
        : maxDist <= 500
          ? 14
          : maxDist <= 1000
            ? 8
            : maxDist <= 2000
              ? 4
              : 2
  if (Number.isFinite(maxDist) && maxDist > 500) {
    reasons.push(
      `Najdalszy otwór użyty w profilu leży ${maxDist} m od punktu inwestycji — na takim dystansie budowa geologiczna może się istotnie zmieniać.`,
    )
  }

  // 4. Jakość lokalizacji otworów użytych w profilu
  const weights = usedBoreholes.map((b) => locationWeight(b.locationQuality.cls))
  const avgWeight = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0
  const locationQuality = avgWeight * MAX.locationQuality
  const approx = usedBoreholes.filter((b) => b.locationQuality.cls === 'przybliżona')
  if (approx.length) {
    reasons.push(
      `${approx.length} z ${usedBoreholes.length} otworów użytych w profilu ma położenie przypisane wg najbliższej miejscowości — podane odległości są orientacyjne (niepewność rzędu 1 km).`,
    )
  }

  // 5. Korekta wysokościowa
  const elevation = elevationCorrected ? MAX.elevation : 0
  if (!elevationCorrected && usedIds.size > 0) {
    reasons.push(
      'Nie udało się ustalić rzędnej terenu — profil NIE został skorygowany wysokościowo. Głębokości warstw mogą być przesunięte o różnicę wysokości między otworem a działką.',
    )
  }

  const score = Math.round(coverage + boreholeCount + proximity + locationQuality + elevation)
  const grade: CredibilityGrade =
    score >= 78 ? 'wysoka' : score >= 55 ? 'umiarkowana' : score >= 32 ? 'niska' : 'orientacyjna'

  const HEADLINES: Record<CredibilityGrade, string> = {
    wysoka:
      'Dane wystarczające do wstępnego projektowania dolnego źródła; rozpoznanie własne nadal zalecane.',
    umiarkowana:
      'Dane pozwalają oszacować warunki, ale nie zastępują rozpoznania na działce. Wycenę oprzeć na nich z zapasem.',
    niska:
      'Dane zbyt ubogie do projektowania. Traktować jako wskazówkę kierunkową; wymagany otwór pilotażowy.',
    orientacyjna:
      'Brak realnej podstawy dowodowej dla tej lokalizacji. Nie opierać na tym raporcie żadnych decyzji technicznych ani cenowych.',
  }

  if (!reasons.length) {
    reasons.push(
      `Profil pokryty w 100% danymi z ${n} otworów, najdalszy ${maxDist} m, korekta wysokościowa zastosowana.`,
    )
  }

  return {
    score,
    grade,
    reasons,
    headline: HEADLINES[grade],
    breakdown: {
      coverage: round1(coverage),
      boreholeCount,
      proximity,
      locationQuality: round1(locationQuality),
      elevationCorrection: elevation,
    },
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
