import type { BoreholeSizing, MpgnData, ValueRange } from '../types'

export interface SizingInput {
  mpgn: MpgnData
  /** Moc grzewcza pompy ciepła [kW]. */
  heatPumpKw: number
  /** Sezonowy współczynnik efektywności; domyślnie 4,0. */
  scop?: number
  /** Roczny czas pracy sprężarki [h] — decyduje, który zestaw qᵥ z MPGN zastosować. */
  annualHours?: 1800 | 2100
  /** Głębokość pojedynczego odwiertu [m]. */
  singleBoreholeDepthM: number
}

/**
 * Wstępny dobór łącznej długości odwiertów pionowych.
 *
 *   moc pobierana z gruntu:  Q = P × (1 − 1/SCOP)
 *   długość odwiertów:       L = Q / qᵥ
 *
 * qᵥ pochodzi WYŁĄCZNIE z Mapy Potencjału Geotermii Niskotemperaturowej PIG-PIB
 * i jest podawane w przedziale, dlatego wynik też jest przedziałem. Nic nie jest
 * uśredniane „dla wygody" — węższy wynik oznaczałby precyzję, której dane nie mają.
 *
 * To NIE jest projekt dolnego źródła: nie uwzględnia bilansu rocznego, regeneracji
 * gruntu, wpływu sąsiednich odwiertów ani wody użytkowej. Dla instalacji większych
 * i dla gruntów o zmiennej litologii podstawą doboru powinien być test reakcji
 * termicznej (TRT).
 */
export function sizeBoreholeField(input: SizingInput): BoreholeSizing | null {
  const scop = input.scop && input.scop > 1 ? input.scop : 4.0
  const annualHours = input.annualHours ?? 1800
  const qv = annualHours === 2100 ? input.mpgn.qv2100Wm : input.mpgn.qv1800Wm
  if (!qv || !(input.heatPumpKw > 0) || !(input.singleBoreholeDepthM > 0)) return null

  const groundLoadKw = input.heatPumpKw * (1 - 1 / scop)
  const groundLoadW = groundLoadKw * 1000

  // Większe qᵥ → mniej metrów, dlatego min/max się odwracają.
  const minMetres = groundLoadW / qv.max
  const maxMetres = groundLoadW / qv.min

  const totalMetresRange = { min: roundTo(minMetres, 5), max: roundTo(maxMetres, 5) }
  const boreholeCountRange = {
    min: Math.ceil(totalMetresRange.min / input.singleBoreholeDepthM),
    max: Math.ceil(totalMetresRange.max / input.singleBoreholeDepthM),
  }

  const assumptions = [
    `Moc pobierana z gruntu = ${fmt(input.heatPumpKw)} kW × (1 − 1/${fmt(scop)}) = ${fmt(round1(groundLoadKw))} kW.`,
    `qᵥ = ${qv.label} W/m wg MPGN PIG-PIB dla ${annualHours} h pracy w roku, przedział głębokości 0–${input.mpgn.bracketDepthM} m p.p.t.`,
    `Długość odwiertów = moc z gruntu / qᵥ; wynik podany jako przedział, bo MPGN publikuje qᵥ w przedziale.`,
    `Przyjęta głębokość pojedynczego odwiertu: ${fmt(input.singleBoreholeDepthM)} m.`,
    'Szacunek wstępny — nie zastępuje projektu dolnego źródła ani testu reakcji termicznej (TRT).',
  ]

  if (input.mpgn.bracketDepthM !== input.singleBoreholeDepthM) {
    assumptions.push(
      `UWAGA: MPGN publikuje qᵥ w przedziałach 40/70/100/130 m. Dla głębokości ${fmt(input.singleBoreholeDepthM)} m ` +
        `zastosowano najbliższy dostępny przedział ${input.mpgn.bracketDepthM} m.`,
    )
  }

  return {
    heatPumpKw: input.heatPumpKw,
    scop,
    groundLoadKw: round1(groundLoadKw),
    annualHours,
    qvWm: qv,
    totalMetresRange,
    boreholeCountRange,
    singleBoreholeDepthM: input.singleBoreholeDepthM,
    assumptions,
  }
}

/** Zdania opisujące parametry termiczne gruntu — wyłącznie fakty z MPGN. */
export function describeMpgn(mpgn: MpgnData): string[] {
  const out: string[] = []
  const range = (r: ValueRange | null, unit: string) => (r ? `${r.label} ${unit}` : null)

  const lambda = range(mpgn.lambdaWmK, 'W/(m·K)')
  if (lambda) {
    out.push(
      `Przewodność termiczna gruntu λ w przedziale 0–${mpgn.bracketDepthM} m p.p.t.: ${lambda} (MPGN PIG-PIB).`,
    )
  } else {
    out.push(
      `Przewodność termiczna λ: brak danych w sprawdzonym zakresie — punkt poza zasięgiem arkuszy MPGN.`,
    )
  }

  const qv18 = range(mpgn.qv1800Wm, 'W/m')
  const qv21 = range(mpgn.qv2100Wm, 'W/m')
  if (qv18 || qv21) {
    const parts = [
      qv18 ? `${qv18} przy 1800 h pracy w roku` : null,
      qv21 ? `${qv21} przy 2100 h` : null,
    ].filter(Boolean)
    out.push(
      `Jednostkowa wydajność termiczna otworu qᵥ na głębokości ${mpgn.bracketDepthM} m: ${parts.join(', ')} (MPGN PIG-PIB).`,
    )
  } else {
    out.push('Jednostkowa wydajność termiczna qᵥ: brak danych w sprawdzonym zakresie.')
  }

  return out
}

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function fmt(n: number): string {
  return String(n).replace('.', ',')
}
