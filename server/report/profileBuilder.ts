import type { BoreholeDetail, EvidenceRef, SyntheticLayer } from '../types'

export interface ProfileCoverage {
  layers: SyntheticLayer[]
  gaps: Array<{ fromM: number; toM: number }>
  /** Procent zakresu 0..targetDepth pokryty danymi CBDG. */
  coveragePct: number
  coveredM: number
  targetDepthM: number
  /** Czy zastosowano korektę wysokościową (znana rzędna działki i otworów). */
  elevationCorrected: boolean
  /** Otwory, dla których korekty nie dało się zastosować (brak rzędnej w CBDG). */
  boreholesWithoutElevation: number[]
}

const EPS = 1e-6

export interface ProfileOptions {
  /**
   * Rzędna terenu w punkcie inwestycji [m n.p.m.].
   *
   * Gdy podana, głębokości warstw są przeliczane z układu otworu na układ działki:
   * warstwa leżąca na rzędnej bezwzględnej H trafia na głębokość (rzędna działki − H).
   * Bez tego warstwy z otworu stojącego np. 5 m niżej byłyby wpisane w profil
   * o 5 m za płytko — to błąd merytoryczny, nie zaokrąglenie.
   */
  siteElevationM?: number | null
}

/**
 * Budowa syntetycznego profilu 0..targetDepth z profili litologicznych CBDG.
 *
 * Regula doboru: dla kazdego przedzialu glebokosci wybierany jest NAJBLIZSZY otwor,
 * ktory faktycznie posiada opis litologiczny na tej glebokosci. Nic nie jest
 * ekstrapolowane ani interpolowane - jesli zaden otwor nie ma danych, przedzial
 * zostaje oznaczony jako "brak danych w sprawdzonym zakresie".
 */
export function buildSyntheticProfile(
  boreholes: BoreholeDetail[],
  targetDepthM: number,
  options: ProfileOptions = {},
): ProfileCoverage {
  const siteElevationM = options.siteElevationM ?? null

  if (!(targetDepthM > 0)) {
    return {
      layers: [],
      gaps: [],
      coveragePct: 0,
      coveredM: 0,
      targetDepthM: 0,
      elevationCorrected: false,
      boreholesWithoutElevation: [],
    }
  }

  // Otwory posortowane rosnaco wg odleglosci - pierwszy pasujacy wygrywa.
  const sorted = [...boreholes]
    .filter((b) => b.lithology.length > 0)
    .sort((a, b) => a.distanceM - b.distanceM)

  const withoutElevation: number[] = []
  /** Przesunięcie profilu otworu na układ głębokości działki [m]. */
  const shiftFor = (b: BoreholeDetail): number => {
    if (siteElevationM === null) return 0
    if (b.elevationM === null || !Number.isFinite(b.elevationM)) {
      if (!withoutElevation.includes(b.cbdgId)) withoutElevation.push(b.cbdgId)
      return 0
    }
    return siteElevationM - b.elevationM
  }

  const cuts = new Set<number>([0, targetDepthM])
  for (const b of sorted) {
    const shift = shiftFor(b)
    for (const l of b.lithology) {
      for (const d of [l.fromM + shift, l.toM + shift]) {
        if (d > 0 && d < targetDepthM) cuts.add(round4(d))
      }
    }
  }

  const bounds = [...cuts].sort((a, b) => a - b)
  const raw: SyntheticLayer[] = []

  for (let i = 0; i < bounds.length - 1; i++) {
    const fromM = bounds[i]
    const toM = bounds[i + 1]
    if (toM - fromM < EPS) continue
    const mid = (fromM + toM) / 2

    let picked:
      | { b: BoreholeDetail; description: string; chrono: string | null; shift: number; srcFrom: number; srcTo: number }
      | null = null

    for (const b of sorted) {
      const shift = shiftFor(b)
      // Głębokość w układzie otworu odpowiadająca środkowi przedziału na działce.
      const midInBorehole = mid - shift
      const layer = b.lithology.find(
        (l) => l.fromM <= midInBorehole + EPS && l.toM >= midInBorehole - EPS,
      )
      if (layer) {
        picked = {
          b,
          description: layer.description,
          chrono: layer.chronostratigraphy,
          shift,
          srcFrom: layer.fromM,
          srcTo: layer.toM,
        }
        break
      }
    }

    if (picked) {
      const evidence: EvidenceRef = {
        cbdgId: picked.b.cbdgId,
        boreholeName: picked.b.name,
        distanceM: picked.b.distanceM,
        locationUncertaintyM: picked.b.locationQuality?.uncertaintyM,
        fromM,
        toM,
        sourceFromM: picked.srcFrom,
        sourceToM: picked.srcTo,
        elevationShiftM: round2(picked.shift),
        sourceId: 'CBDG_OTWORY_REST',
        sourceUrl: picked.b.detailSourceUrl,
      }
      raw.push({
        fromM,
        toM,
        description: picked.description,
        chronostratigraphy: picked.chrono,
        noData: false,
        evidence,
      })
    } else {
      raw.push({
        fromM,
        toM,
        description: null,
        chronostratigraphy: null,
        noData: true,
        evidence: null,
      })
    }
  }

  const layers = mergeAdjacent(raw)
  const gaps = layers
    .filter((l) => l.noData)
    .map((l) => ({ fromM: l.fromM, toM: l.toM }))
  const coveredM = layers
    .filter((l) => !l.noData)
    .reduce((sum, l) => sum + (l.toM - l.fromM), 0)

  return {
    layers,
    gaps,
    coveredM: round2(coveredM),
    coveragePct: round2((coveredM / targetDepthM) * 100),
    targetDepthM,
    elevationCorrected:
      siteElevationM !== null && sorted.some((b) => b.elevationM !== null),
    boreholesWithoutElevation: withoutElevation,
  }
}

/** Scalenie sasiadujacych przedzialow o tym samym zrodle i opisie. */
function mergeAdjacent(layers: SyntheticLayer[]): SyntheticLayer[] {
  const out: SyntheticLayer[] = []
  for (const l of layers) {
    const prev = out[out.length - 1]
    const sameSource =
      prev &&
      prev.noData === l.noData &&
      prev.description === l.description &&
      prev.evidence?.cbdgId === l.evidence?.cbdgId &&
      Math.abs(prev.toM - l.fromM) < EPS
    if (sameSource) {
      prev.toM = l.toM
      if (prev.evidence) {
        prev.evidence.toM = l.toM
        if (l.evidence?.sourceToM !== undefined) prev.evidence.sourceToM = l.evidence.sourceToM
      }
    } else {
      out.push({
        ...l,
        evidence: l.evidence ? { ...l.evidence } : null,
      })
    }
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
