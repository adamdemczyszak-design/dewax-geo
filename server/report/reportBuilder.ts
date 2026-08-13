import { AuditLog } from '../core/auditLog'
import { CbdgClient } from '../cbdg/cbdgClient'
import {
  loadBoreholeDetail,
  loadHydroContext,
  searchBoreholes,
  searchCbdhObjects,
  searchGroundwaterPoints,
} from '../cbdg/boreholeSearch'
import { runOodaLoop } from '../core/oodaLoop'
import { buildSyntheticProfile } from './profileBuilder'
import { detectRisks } from './riskDetector'
import { assessCredibility } from './credibility'
import { loadMpgn } from '../cbdg/mpgnClient'
import { fetchTerrainElevation } from '../gis/terrainElevation'
import { describeMpgn, sizeBoreholeField } from './sizing'
import { DEFAULT_TARGET_DEPTH_M, ENDPOINTS, type SourceId } from '../endpoints'
import type {
  BoreholeDetail,
  BoreholeSizing,
  GroundwaterPoint,
  GshpReport,
  HydroContextArea,
  LatLon,
  MpgnData,
  ResolvedLocation,
  VerificationSummary,
} from '../types'

export interface BuildReportOptions {
  location: ResolvedLocation
  targetDepthM?: number
  client?: CbdgClient
  audit?: AuditLog
  fetchImpl?: typeof fetch
  /** Limit otworow, dla ktorych pobieramy pelne profile (ochrona przed timeoutem). */
  maxDetailedBoreholes?: number
  /** Budzet czasu na pobieranie profili [ms]. Po jego przekroczeniu analiza konczy sie
   *  tym, co udalo sie zebrac - braki sa raportowane jako brak danych, nie zgadywane. */
  timeBudgetMs?: number
  /** Maksymalna liczba otworow wypisanych w raporcie (payload). */
  maxListedBoreholes?: number
  /** Limit profili pobieranych w jednym cyklu OODA. */
  perCycleDetailBudget?: number
  /** Moc grzewcza pompy ciepła [kW] — włącza wstępny dobór długości odwiertów. */
  heatPumpKw?: number | null
  /** Sezonowy współczynnik efektywności przyjęty do doboru (domyślnie 4,0). */
  scop?: number | null
  /** Roczny czas pracy sprężarki [h] — 1800 (dom) lub 2100 (dom + c.w.u.). */
  annualHours?: 1800 | 2100 | null
}

/** Rownolegle pobieranie profili - liczba jednoczesnych zapytan do API CBDG. */
const DETAIL_CONCURRENCY = 5

export const NO_DATA_TEXT = 'brak danych w sprawdzonym zakresie'

/** Formatuje liczbę po polsku (przecinek dziesiętny), null → „b.d.". */
function pl(n: number | null): string {
  if (n === null) return 'b.d.'
  return String(n).replace('.', ',')
}

/**
 * Polska odmiana liczebników: 1 otwór, 2–4 otwory, 5+ otworów.
 * @param forms [pojedyncza, mnoga 2-4, mnoga 5+]
 */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n)
  if (abs === 1) return forms[0]
  const last = abs % 10
  const lastTwo = abs % 100
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return forms[1]
  return forms[2]
}

/**
 * Odmiana czasownika przy liczebniku: „znajduje się 1 punkt", „znajdują się 2 punkty",
 * „znajduje się 7 punktów" — forma mnoga tylko dla 2–4.
 */
export function verbForCount(n: number, singular: string, plural2to4: string): string {
  const last = Math.abs(n) % 10
  const lastTwo = Math.abs(n) % 100
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? plural2to4 : singular
}

/** Dokleja kropkę tylko wtedy, gdy zdanie jeszcze się nią nie kończy („…p.p.t."). */
function endSentence(s: string): string {
  return s.endsWith('.') ? s : `${s}.`
}

type PluralForms = [string, string, string]
const OTWOR: PluralForms = ['otwór', 'otwory', 'otworów']
const PUNKT: PluralForms = ['punkt', 'punkty', 'punktów']
const OBIEKT: PluralForms = ['obiekt', 'obiekty', 'obiektów']

/**
 * Zlozenie pelnego raportu geologicznego dla otworu GSHP.
 * Zadna wartosc w raporcie nie jest szacowana - kazda warstwa i kazde ryzyko
 * ma przypisany otwor CBDG, odleglosc, zakres glebokosci i adres uslugi zrodlowej.
 */
export async function buildReport(opts: BuildReportOptions): Promise<GshpReport> {
  const audit = opts.audit ?? new AuditLog()
  const client = opts.client ?? new CbdgClient({ audit, fetchImpl: opts.fetchImpl })
  const targetDepthM = normalizeDepth(opts.targetDepthM)
  const center: LatLon = { lat: opts.location.lat, lon: opts.location.lon }
  const maxDetailed = opts.maxDetailedBoreholes ?? 48
  const maxListed = opts.maxListedBoreholes ?? 60
  const deadlineAt = Date.now() + (opts.timeBudgetMs ?? 9_000)
  /** Limit pobran w jednym cyklu - chroni przed zjedzeniem calego budzetu
   *  przez plytkie otwory z pierwszego, najciasniejszego promienia. */
  const perCycleBudget = opts.perCycleDetailBudget ?? 14

  audit.add({
    stage: 'start',
    message:
      `Analiza dla punktu ${center.lat.toFixed(6)}, ${center.lon.toFixed(6)} ` +
      `(${opts.location.label}); głębokość docelowa ${targetDepthM} m p.p.t.`,
  })

  // Rzędna terenu i parametry termiczne pobierane równolegle z wyszukiwaniem otworów —
  // to niezależne usługi, nie ma powodu czekać na nie po kolei.
  const terrainPromise = fetchTerrainElevation(center, { audit, fetchImpl: opts.fetchImpl })
  const mpgnPromise = loadMpgn(client, center, targetDepthM).catch((err) => {
    audit.add({
      stage: 'geotermia:mpgn',
      message: `Nie udało się pobrać danych MPGN: ${(err as Error).message}`,
      sourceId: 'MPGN_GEOTERMIA',
    })
    return null
  })

  // Rzędna musi być znana ZANIM zaczniemy budować profil — od niej zależy
  // przeliczenie głębokości warstw z układu otworu na układ działki.
  const terrain = await terrainPromise
  const siteElevationM = terrain?.elevationM ?? null

  const checked: VerificationSummary['checkedEndpoints'] = []
  const detailCache = new Map<number, BoreholeDetail>()
  let detailBudget = maxDetailed
  let totalFound = 0
  let budgetExhausted = false
  let deadlineHit = false

  const collect = async (c: LatLon, radiusM: number): Promise<BoreholeDetail[]> => {
    const summaries = await searchBoreholes(client, c, radiusM)
    totalFound = summaries.length
    audit.add({
      stage: 'wyszukiwanie:otwory',
      message:
        `Promień ${radiusM} m: znaleziono ${summaries.length} ${plural(summaries.length, OTWOR)} CBDG` +
        (summaries.length >= 1000
          ? ' (osiągnięto limit transferu usługi ArcGIS = 1000 rekordów).'
          : '.'),
      radiusM,
      endpoint: ENDPOINTS.CBDG_OTWORY_MAPSERVER.url,
      sourceId: 'CBDG_OTWORY_MAPSERVER',
      found: summaries.length,
    })

    const collected: BoreholeDetail[] = []
    const pending: typeof summaries = []
    for (const s of summaries) {
      const cached = detailCache.get(s.cbdgId)
      if (cached) collected.push({ ...cached, foundInRadiusM: Math.min(cached.foundInRadiusM, radiusM) })
      else pending.push(s)
    }

    const queue = rankForDetailFetch(pending, targetDepthM)
    const deepCount = queue.filter((s) => (s.finalDepthM ?? 0) >= targetDepthM).length
    let cycleBudget = Math.min(perCycleBudget, detailBudget)
    audit.add({
      stage: 'wyszukiwanie:priorytet',
      message:
        `Kolejność pobierania profili: ${Math.min(NEAR_FIRST, queue.length)} najbliższych, ` +
        `następnie ${deepCount} ${plural(deepCount, OTWOR)} o głębokości ≥ ${targetDepthM} m wg odległości, na końcu pozostałe. ` +
        `Budżet w tym cyklu: ${cycleBudget}, budżet globalny: ${detailBudget}.`,
      radiusM,
    })

    let i = 0
    while (i < queue.length && cycleBudget > 0) {
      if (buildSyntheticProfile(collected, targetDepthM, { siteElevationM }).coveragePct >= 100) break
      if (Date.now() > deadlineAt) {
        deadlineHit = true
        audit.add({
          stage: 'wyszukiwanie:limit-czasu',
          message:
            'Przekroczono budżet czasu na pobieranie profili. Analiza kończy się na danych zebranych ' +
            'do tej pory; brakujące zakresy pozostają oznaczone jako brak danych.',
          radiusM,
        })
        break
      }
      const take = Math.min(DETAIL_CONCURRENCY, cycleBudget, queue.length - i)
      const batch = queue.slice(i, i + take)
      i += take
      cycleBudget -= take
      detailBudget -= take
      const got = await Promise.all(batch.map((s) => loadBoreholeDetail(client, s)))
      for (const d of got) {
        detailCache.set(d.cbdgId, d)
        collected.push(d)
      }
    }
    if (detailBudget <= 0) budgetExhausted = true

    // Otwory bez pobranego profilu pozostaja na liscie analizowanych, ale jawnie
    // oznaczone jako niesprawdzone - to nie jest to samo co "brak profilu w CBDG".
    const listedStubs = queue.slice(i, i + Math.max(0, maxListed - collected.length)).map((s) => ({
      ...s,
      lithology: [],
      stratigraphy: [],
      lithologyMaxDepthM: null,
      lithologyProfileName: null,
      lithologySourceNote: null,
      notes: [
        deadlineHit
          ? 'Profil nie był pobierany — przekroczono budżet czasu analizy.'
          : `Profil nie był pobierany — wyczerpany limit ${maxDetailed} otworów analizowanych szczegółowo.`,
      ],
      detailSourceUrl: ENDPOINTS.CBDG_OTWORY_REST.url.replace('{id}', String(s.cbdgId)),
    }))

    return [...collected, ...listedStubs].sort((a, b) => a.distanceM - b.distanceM)
  }

  let ooda
  let pgiReachable = true
  try {
    ooda = await runOodaLoop(
      {
        collect,
        audit,
        shouldStop: () =>
          Date.now() > deadlineAt
            ? 'Wyczerpano budżet czasu analizy.'
            : detailBudget <= 0
              ? `Wyczerpano limit ${maxDetailed} otworów pobieranych szczegółowo.`
              : null,
      },
      { center, targetDepthM, siteElevationM },
    )
    checked.push({
      sourceId: 'CBDG_OTWORY_MAPSERVER',
      name: ENDPOINTS.CBDG_OTWORY_MAPSERVER.name,
      url: ENDPOINTS.CBDG_OTWORY_MAPSERVER.url,
      status: totalFound ? 'ok' : 'brak-danych',
      detail: totalFound
        ? `Znaleziono ${totalFound} ${plural(totalFound, OTWOR)} w promieniu ${ooda.finalRadiusM} m` +
          (ooda.boreholes.length < totalFound
            ? ` (w raporcie wypisano ${ooda.boreholes.length} najbliższych).`
            : '.')
        : `Brak otworów CBDG w promieniu do ${ooda.finalRadiusM} m.`,
    })
    checked.push({
      sourceId: 'CBDG_OTWORY_REST',
      name: ENDPOINTS.CBDG_OTWORY_REST.name,
      url: ENDPOINTS.CBDG_OTWORY_REST.url,
      status: ooda.boreholes.some((b) => b.lithology.length) ? 'ok' : 'brak-danych',
      detail:
        `Profile litologiczne pobrane dla ${ooda.boreholes.filter((b) => b.lithology.length).length} ` +
        `z ${maxDetailed - detailBudget} ${plural(maxDetailed - detailBudget, OTWOR)} sprawdzonych szczegółowo.`,
    })
  } catch (err) {
    pgiReachable = false
    audit.add({ stage: 'blad', message: `Pętla OODA przerwana: ${(err as Error).message}` })
    checked.push({
      sourceId: 'CBDG_OTWORY_MAPSERVER',
      name: ENDPOINTS.CBDG_OTWORY_MAPSERVER.name,
      url: ENDPOINTS.CBDG_OTWORY_MAPSERVER.url,
      status: 'blad',
      detail: (err as Error).message,
    })
    ooda = {
      boreholes: [] as BoreholeDetail[],
      cycles: [],
      finalRadiusM: 0,
      radiiChecked: [],
      coveragePct: 0,
      gaps: [{ fromM: 0, toM: targetDepthM }],
      sufficient: false,
    }
  }

  const profile = buildSyntheticProfile(ooda.boreholes, targetDepthM, { siteElevationM })

  if (siteElevationM !== null && profile.boreholesWithoutElevation.length) {
    audit.add({
      stage: 'profil:korekta-wysokosciowa',
      message:
        `Korekta wysokościowa pominięta dla ${profile.boreholesWithoutElevation.length} ` +
        `${plural(profile.boreholesWithoutElevation.length, OTWOR)} bez rzędnej w CBDG ` +
        `(ID: ${profile.boreholesWithoutElevation.slice(0, 10).join(', ')}).`,
    })
  } else if (siteElevationM !== null) {
    audit.add({
      stage: 'profil:korekta-wysokosciowa',
      message:
        `Profil przeliczony na rzędną działki ${siteElevationM} m n.p.m. — głębokości warstw ` +
        'odniesione do terenu w punkcie inwestycji, nie do terenu przy otworze źródłowym.',
    })
  }

  // --- Hydrogeologia ---
  const hydroRadius = Math.max(ooda.finalRadiusM || 1000, 2000)
  let groundwaterPoints: GroundwaterPoint[] = []
  let contextAreas: HydroContextArea[] = []

  try {
    groundwaterPoints = await searchGroundwaterPoints(client, center, hydroRadius)
    checked.push({
      sourceId: 'PSH_MONITORING_WOD',
      name: ENDPOINTS.PSH_MONITORING_WOD.name,
      url: ENDPOINTS.PSH_MONITORING_WOD.url,
      status: groundwaterPoints.length ? 'ok' : 'brak-danych',
      detail: groundwaterPoints.length
        ? `${groundwaterPoints.length} ${plural(groundwaterPoints.length, PUNKT)} monitoringu w promieniu ${hydroRadius} m.`
        : `Brak punktów monitoringu wód podziemnych w promieniu ${hydroRadius} m.`,
    })
  } catch (err) {
    checked.push({
      sourceId: 'PSH_MONITORING_WOD',
      name: ENDPOINTS.PSH_MONITORING_WOD.name,
      url: ENDPOINTS.PSH_MONITORING_WOD.url,
      status: 'blad',
      detail: (err as Error).message,
    })
  }

  try {
    const cbdh = await searchCbdhObjects(client, center, hydroRadius)
    contextAreas.push(...cbdh)
    checked.push({
      sourceId: 'CBDH_OBIEKTY_HYDRO',
      name: ENDPOINTS.CBDH_OBIEKTY_HYDRO.name,
      url: ENDPOINTS.CBDH_OBIEKTY_HYDRO.url,
      status: cbdh.length ? 'ok' : 'brak-danych',
      detail: cbdh.length
        ? `${cbdh.length} ${plural(cbdh.length, OBIEKT)} hydrogeologicznych CBDH w promieniu ${hydroRadius} m.`
        : `Brak obiektów CBDH w promieniu ${hydroRadius} m.`,
    })
  } catch (err) {
    checked.push({
      sourceId: 'CBDH_OBIEKTY_HYDRO',
      name: ENDPOINTS.CBDH_OBIEKTY_HYDRO.name,
      url: ENDPOINTS.CBDH_OBIEKTY_HYDRO.url,
      status: 'blad',
      detail: (err as Error).message,
    })
  }

  try {
    const areas = await loadHydroContext(client, center, audit)
    contextAreas = [...areas, ...contextAreas]
    for (const sid of ['CBDG_GZWP', 'CBDG_JCWPD'] as SourceId[]) {
      const hits = areas.filter((a) => a.sourceId === sid)
      checked.push({
        sourceId: sid,
        name: ENDPOINTS[sid].name,
        url: ENDPOINTS[sid].url,
        status: hits.length ? 'ok' : 'brak-danych',
        detail: hits.length
          ? hits.map((h) => h.layerLabel).join(', ')
          : 'Punkt inwestycji nie leży w granicach warstw tej usługi.',
      })
    }
  } catch (err) {
    audit.add({ stage: 'kontekst', message: `Błąd kontekstu hydrogeologicznego: ${(err as Error).message}` })
  }

  const hydroStatements = buildHydroStatements(groundwaterPoints, contextAreas, ooda.boreholes, hydroRadius)

  // --- Parametry termiczne gruntu (MPGN) i wstępny dobór odwiertów ---
  const mpgn: MpgnData | null = await mpgnPromise
  const thermalStatements = mpgn ? describeMpgn(mpgn) : []
  const hasMpgnValues = !!(mpgn && (mpgn.lambdaWmK || mpgn.qv1800Wm || mpgn.qv2100Wm))

  checked.push({
    sourceId: 'MPGN_GEOTERMIA',
    name: ENDPOINTS.MPGN_GEOTERMIA.name,
    url: ENDPOINTS.MPGN_GEOTERMIA.url,
    status: hasMpgnValues ? 'ok' : 'brak-danych',
    detail: hasMpgnValues
      ? `λ = ${mpgn!.lambdaWmK?.label ?? 'b.d.'} W/(m·K), qᵥ = ${mpgn!.qv1800Wm?.label ?? 'b.d.'} W/m (1800 h) dla przedziału 0–${mpgn!.bracketDepthM} m.`
      : 'Punkt inwestycji poza zasięgiem arkuszy MPGN — brak parametrów termicznych.',
  })

  checked.push({
    sourceId: 'GUGIK_NMT',
    name: ENDPOINTS.GUGIK_NMT.name,
    url: ENDPOINTS.GUGIK_NMT.url,
    status: siteElevationM !== null ? 'ok' : 'brak-danych',
    detail:
      siteElevationM !== null
        ? `Rzędna terenu ${siteElevationM} m n.p.m. — profil skorygowany wysokościowo.`
        : 'Nie ustalono rzędnej terenu — profil bez korekty wysokościowej.',
  })

  let sizing: BoreholeSizing | null = null
  const heatPumpKw = Number(opts.heatPumpKw)
  if (mpgn && Number.isFinite(heatPumpKw) && heatPumpKw > 0) {
    sizing = sizeBoreholeField({
      mpgn,
      heatPumpKw,
      scop: opts.scop ?? undefined,
      annualHours: opts.annualHours ?? undefined,
      singleBoreholeDepthM: targetDepthM,
    })
    if (sizing) {
      audit.add({
        stage: 'geotermia:dobor',
        message:
          `Wstępny dobór: moc z gruntu ${sizing.groundLoadKw} kW przy qᵥ = ${sizing.qvWm.label} W/m → ` +
          `${sizing.totalMetresRange.min}–${sizing.totalMetresRange.max} m odwiertów ` +
          `(${sizing.boreholeCountRange.min}–${sizing.boreholeCountRange.max} × ${targetDepthM} m).`,
        sourceId: 'MPGN_GEOTERMIA',
      })
    } else {
      audit.add({
        stage: 'geotermia:dobor',
        message: 'Dobór długości odwiertów niemożliwy — brak qᵥ w MPGN dla tego punktu.',
        sourceId: 'MPGN_GEOTERMIA',
      })
    }
  }

  // --- Ryzyka ---
  const risks = detectRisks({
    boreholes: ooda.boreholes,
    groundwater: groundwaterPoints,
    targetDepthM,
  })
  audit.add({
    stage: 'ryzyka',
    message: `Wykryto ${risks.found.length} kategorii ryzyka; ${risks.notFound.length} kategorii sprawdzono bez potwierdzenia w danych.`,
  })

  // --- Podsumowanie dowodowe ---
  const usedIds = new Set(
    profile.layers.filter((l) => l.evidence).map((l) => l.evidence!.cbdgId),
  )
  const usedDistances = profile.layers
    .filter((l) => l.evidence)
    .map((l) => l.evidence!.distanceM)

  const endpointsUsed = [...new Set(checked.filter((c) => c.status === 'ok').map((c) => c.sourceId))].map(
    (sid) => ({ sourceId: sid, name: ENDPOINTS[sid].name, url: ENDPOINTS[sid].url }),
  )

  const verification: VerificationSummary = {
    pgiReachable,
    checkedEndpoints: checked,
    finalRadiusM: ooda.finalRadiusM,
    radiiChecked: ooda.radiiChecked,
    boreholesFound: totalFound,
    boreholesListed: ooda.boreholes.length,
    boreholesWithLithology: ooda.boreholes.filter((b) => b.lithology.length).length,
    targetDepthM,
    profileCoveragePct: profile.coveragePct,
    dataSufficient: ooda.sufficient,
    transferLimitReached: totalFound >= 1000,
    detailLimitReached: budgetExhausted,
    timeBudgetExceeded: deadlineHit,
  }

  const credibility = assessCredibility({
    coveragePct: profile.coveragePct,
    layers: profile.layers,
    boreholes: ooda.boreholes,
    targetDepthM,
    elevationCorrected: profile.elevationCorrected,
  })

  audit.add({
    stage: 'wiarygodnosc',
    message:
      `Ocena wiarygodności raportu: ${credibility.grade} (${credibility.score}/100). ` +
      credibility.reasons.join(' '),
  })

  audit.add({
    stage: 'koniec',
    message:
      `Raport zbudowany. Pokrycie profilu ${profile.coveragePct}%, ` +
      `warstw z dowodem: ${profile.layers.filter((l) => !l.noData).length}, ` +
      `warstw bez danych: ${profile.layers.filter((l) => l.noData).length}.`,
  })

  return {
    generatedAt: new Date().toISOString(),
    location: opts.location,
    targetDepthM,
    siteElevationM,
    siteElevationSource: terrain?.source ?? null,
    credibility,
    mpgn,
    sizing,
    thermalStatements,
    verification,
    boreholes: ooda.boreholes,
    syntheticProfile: profile.layers,
    hydrogeology: {
      groundwaterPoints,
      contextAreas,
      statements: hydroStatements,
      noDataNote:
        groundwaterPoints.length === 0 && !hydroStatements.length
          ? `Warunki hydrogeologiczne: ${NO_DATA_TEXT} (promień ${hydroRadius} m).`
          : null,
    },
    risks: risks.found,
    risksNotFound: risks.notFound,
    evidenceSummary: {
      totalLayers: profile.layers.length,
      layersWithEvidence: profile.layers.filter((l) => !l.noData).length,
      layersWithoutData: profile.layers.filter((l) => l.noData).length,
      distinctBoreholesUsed: usedIds.size,
      nearestBoreholeM: usedDistances.length ? Math.min(...usedDistances) : null,
      farthestUsedBoreholeM: usedDistances.length ? Math.max(...usedDistances) : null,
      endpointsUsed,
    },
    ooda: ooda.cycles,
    audit: audit.all(),
  }
}

/** Liczba najblizszych otworow pobieranych bezwarunkowo, przed otworami glebokimi. */
export const NEAR_FIRST = 3

/**
 * Kolejnosc pobierania profili przy ograniczonym budzecie.
 *
 * 1) Trzy najblizsze otwory - najwyzsza wartosc dowodowa dla stropu profilu.
 * 2) Otwory siegajace glebokosci docelowej, wg odleglosci - tylko one moga domknac
 *    profil do zadanej glebokosci; w rejonach miejskich stanowia ulamek zbioru.
 * 3) Pozostale wg odleglosci.
 *
 * To wybor KOLEJNOSCI POBIERANIA, a nie regula doboru warstw do raportu -
 * w profilu i tak zawsze wygrywa otwor najblizszy sposrod tych, ktore maja dane.
 */
export function rankForDetailFetch<T extends { distanceM: number; finalDepthM: number | null }>(
  summaries: T[],
  targetDepthM: number,
): T[] {
  const byDistance = [...summaries].sort((a, b) => a.distanceM - b.distanceM)
  const near = byDistance.slice(0, NEAR_FIRST)
  const rest = byDistance.slice(NEAR_FIRST)
  const deep = rest.filter((s) => (s.finalDepthM ?? 0) >= targetDepthM)
  const shallow = rest.filter((s) => (s.finalDepthM ?? 0) < targetDepthM)
  return [...near, ...deep, ...shallow]
}

function normalizeDepth(v: number | undefined): number {
  if (!Number.isFinite(v as number)) return DEFAULT_TARGET_DEPTH_M
  const n = Math.round(Number(v))
  return Math.min(500, Math.max(10, n))
}

/**
 * Zdania opisujace warunki hydrogeologiczne. Kazde zdanie odwoluje sie do
 * konkretnego pomiaru lub obiektu z uslug PGI. Brak danych = jawny komunikat.
 */
export function buildHydroStatements(
  points: GroundwaterPoint[],
  areas: HydroContextArea[],
  boreholes: BoreholeDetail[],
  radiusM: number,
): string[] {
  const out: string[] = []

  const withLevels = points.filter(
    (p) => p.stabilisedLevelM !== null || p.drilledLevelM !== null || p.measuredLevelM !== null,
  )
  if (withLevels.length) {
    const nearest = withLevels[0]
    const parts: string[] = []
    if (nearest.drilledLevelM !== null)
      parts.push(`zwierciadło nawiercone ${pl(nearest.drilledLevelM)} m p.p.t.`)
    if (nearest.stabilisedLevelM !== null)
      parts.push(`zwierciadło ustalone ${pl(nearest.stabilisedLevelM)} m p.p.t.`)
    if (nearest.measuredLevelM !== null)
      parts.push(
        `ostatni pomiar ${pl(nearest.measuredLevelM)} m p.p.t.${nearest.measurementDate ? ` (${nearest.measurementDate.slice(0, 10)})` : ''}`,
      )
    out.push(
      endSentence(
        `Najbliższy punkt monitoringu wód podziemnych PSH (${nearest.name ?? 'bez numeru'}), ` +
          `odległość ${nearest.distanceM} m: ${parts.join(', ')}`,
      ),
    )
    if (nearest.aquiferTopM !== null || nearest.aquiferBottomM !== null) {
      out.push(
        endSentence(
          `Warstwa wodonośna w tym punkcie: strop ${pl(nearest.aquiferTopM)} m, spąg ${pl(nearest.aquiferBottomM)} m p.p.t.` +
            (nearest.lithology ? `, litologia: ${nearest.lithology}` : '') +
            (nearest.chronostratigraphy ? `, stratygrafia: ${nearest.chronostratigraphy}` : ''),
        ),
      )
    }
    if (withLevels.length > 1) {
      out.push(
        `W promieniu ${radiusM} m ${verbForCount(withLevels.length, 'znajduje się', 'znajdują się')} ` +
          `${withLevels.length} ${plural(withLevels.length, PUNKT)} monitoringu z pomiarem zwierciadła.`,
      )
    }
  } else {
    out.push(
      `Brak punktów monitoringu wód podziemnych PSH z pomiarem zwierciadła w promieniu ${radiusM} m — ` +
        `poziom wody: ${NO_DATA_TEXT}.`,
    )
  }

  const gzwp = areas.filter((a) => a.sourceId === 'CBDG_GZWP')
  if (gzwp.length) {
    for (const a of gzwp) {
      out.push(`Punkt inwestycji leży w granicach: ${a.layerLabel}${describeArea(a)}.`)
    }
  } else {
    out.push('Punkt inwestycji nie leży w granicach GZWP/LZWP wg warstw CBDG.')
  }

  const jcwpd = areas.filter((a) => a.sourceId === 'CBDG_JCWPD')
  for (const a of jcwpd) {
    out.push(`Jednolita Część Wód Podziemnych: ${a.layerLabel}${describeArea(a)}.`)
  }

  // Slady wody w opisach litologicznych - to dowod z profilu, nie interpretacja.
  const wet = boreholes
    .flatMap((b) =>
      b.lithology
        .filter((l) => /nawodni|wodonosn|saczen|zawodni|woda/i.test(l.description))
        .map((l) => ({ b, l })),
    )
    .sort((x, y) => x.l.fromM - y.l.fromM)
  if (wet.length) {
    const first = wet[0]
    out.push(
      `Najpłytsza wzmianka o nawodnieniu w profilach CBDG: ${pl(first.l.fromM)}–${pl(first.l.toM)} m p.p.t. ` +
        `(„${first.l.description}") — otwór ID CBDG ${first.b.cbdgId}, odległość ${first.b.distanceM} m.`,
    )
  }

  return out
}

function describeArea(a: HydroContextArea): string {
  const name =
    firstString(a.attributes, ['NAZWA', 'NAZWA_GZWP', 'NAZWA_JCWPD', 'NAZWA_ZBIORNIKA', 'NAZWA_OBSZARU'])
  const nr = firstString(a.attributes, ['NR', 'NR_GZWP', 'NUMER', 'KOD', 'IDENT_EU', 'JCWPD'])
  const bits = [nr ? `nr ${nr}` : null, name ? `"${name}"` : null].filter(Boolean)
  return bits.length ? ` (${bits.join(', ')})` : ''
}

function firstString(attrs: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = attrs[k]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

