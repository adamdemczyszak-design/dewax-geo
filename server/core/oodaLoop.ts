import type { BoreholeDetail, LatLon, OodaCycle } from '../types'
import { RADIUS_LADDER } from '../endpoints'
import { AuditLog } from './auditLog'
import { buildSyntheticProfile } from '../report/profileBuilder'

export interface OodaDeps {
  /** Wyszukanie i pobranie szczegolow otworow w danym promieniu. */
  collect: (center: LatLon, radiusM: number) => Promise<BoreholeDetail[]>
  audit: AuditLog
  /** Twardy warunek przerwania (np. wyczerpany budzet czasu funkcji). */
  shouldStop?: () => string | null
}

export interface OodaOptions {
  center: LatLon
  targetDepthM: number
  radiusLadder?: readonly number[]
  /** Minimalne pokrycie profilu 0..targetDepth [%], przy ktorym przerywamy petle. */
  minCoveragePct?: number
  /** Maksymalna liczba otworow, dla ktorych pobieramy pelne profile. */
  maxBoreholes?: number
  /** Rzędna terenu w punkcie inwestycji — do korekty wysokościowej profilu. */
  siteElevationM?: number | null
}

export interface OodaResult {
  boreholes: BoreholeDetail[]
  cycles: OodaCycle[]
  finalRadiusM: number
  radiiChecked: number[]
  coveragePct: number
  gaps: Array<{ fromM: number; toM: number }>
  sufficient: boolean
}

/**
 * Petla OODA (Observe - Orient - Decide - Act) sterujaca rozszerzaniem promienia.
 *
 * Obserwuj:  odpytaj CBDG w biezacym promieniu.
 * Zorientuj: zbuduj syntetyczny profil i policz pokrycie 0..glebokosc docelowa.
 * Zdecyduj:  pokrycie wystarczajace -> koniec; w przeciwnym razie rozszerz promien.
 * Dzialaj:   przejdz do kolejnego promienia z drabiny; kazdy krok trafia do audytu.
 *
 * Petla NIE dopisuje danych - jesli po ostatnim promieniu zostaja luki,
 * zwraca je jawnie jako braki danych.
 */
export async function runOodaLoop(
  deps: OodaDeps,
  opts: OodaOptions,
): Promise<OodaResult> {
  const ladder = opts.radiusLadder ?? RADIUS_LADDER
  const minCoveragePct = opts.minCoveragePct ?? 100
  const { center, targetDepthM } = opts

  const cycles: OodaCycle[] = []
  const radiiChecked: number[] = []
  let boreholes: BoreholeDetail[] = []
  let coveragePct = 0
  let gaps: Array<{ fromM: number; toM: number }> = [{ fromM: 0, toM: targetDepthM }]
  let finalRadiusM = ladder[0]
  let sufficient = false

  for (let i = 0; i < ladder.length; i++) {
    const radiusM = ladder[i]
    finalRadiusM = radiusM
    radiiChecked.push(radiusM)

    deps.audit.add({
      stage: 'ooda:obserwuj',
      message: `Cykl ${i + 1}: wyszukiwanie otworów CBDG w promieniu ${radiusM} m`,
      radiusM,
    })

    boreholes = await deps.collect(center, radiusM)

    const withLithology = boreholes.filter((b) => b.lithology.length > 0)
    const profile = buildSyntheticProfile(boreholes, targetDepthM, {
      siteElevationM: opts.siteElevationM ?? null,
    })
    coveragePct = profile.coveragePct
    gaps = profile.gaps

    const maxLithologyDepthM = withLithology.length
      ? Math.max(...withLithology.map((b) => b.lithologyMaxDepthM ?? 0))
      : null

    deps.audit.add({
      stage: 'ooda:zorientuj',
      message:
        `Znaleziono ${boreholes.length} otworów, w tym ${withLithology.length} z profilem litologicznym. ` +
        `Pokrycie profilu 0-${targetDepthM} m: ${coveragePct}%. ` +
        `Najgłębszy profil: ${maxLithologyDepthM ?? 'brak'} m.`,
      radiusM,
      found: boreholes.length,
    })

    const enough = coveragePct >= minCoveragePct - 1e-9
    const isLast = i === ladder.length - 1

    let decision: OodaCycle['decision']
    let reason: string

    if (enough) {
      decision = 'wystarczajace'
      reason = `Profil litologiczny pokrywa ${coveragePct}% zakresu 0–${targetDepthM} m p.p.t. Rozszerzanie promienia zbędne.`
      sufficient = true
    } else if (isLast) {
      decision = 'wyczerpano-promienie'
      reason =
        `Wyczerpano drabinę promieni (maks. ${radiusM} m). Pokrycie ${coveragePct}%. ` +
        `Pozostałe luki zostają oznaczone jako brak danych w sprawdzonym zakresie.`
    } else {
      decision = 'rozszerz-promien'
      reason =
        `Pokrycie ${coveragePct}% < ${minCoveragePct}% (luki: ${formatGaps(gaps)}). ` +
        `Rozszerzam promień ${radiusM} m → ${ladder[i + 1]} m.`
    }

    cycles.push({
      cycle: i + 1,
      radiusM,
      observedBoreholes: boreholes.length,
      boreholesWithLithology: withLithology.length,
      maxLithologyDepthM,
      coveragePct,
      gaps,
      decision,
      reason,
    })

    deps.audit.add({
      stage: 'ooda:zdecyduj',
      message: reason,
      radiusM,
      found: boreholes.length,
      decision,
    })

    if (enough) break

    const stopReason = deps.shouldStop?.()
    if (stopReason && !isLast) {
      deps.audit.add({
        stage: 'ooda:przerwanie',
        message: `Pętla przerwana przed rozszerzeniem promienia: ${stopReason}`,
        radiusM,
        decision: 'przerwano',
      })
      cycles[cycles.length - 1].decision = 'wyczerpano-promienie'
      cycles[cycles.length - 1].reason =
        `${stopReason} Pozostałe luki zostają oznaczone jako brak danych w sprawdzonym zakresie.`
      break
    }
  }

  return { boreholes, cycles, finalRadiusM, radiiChecked, coveragePct, gaps, sufficient }
}

export function formatGaps(gaps: Array<{ fromM: number; toM: number }>): string {
  if (!gaps.length) return 'brak'
  return gaps.map((g) => `${trim(g.fromM)}-${trim(g.toM)} m`).join(', ')
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
