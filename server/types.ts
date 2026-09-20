import type { SourceId } from './endpoints'
import type { CredibilityAssessment } from './report/credibility'

export type { CredibilityAssessment }

export interface LatLon {
  lat: number
  lon: number
}

export type LocationMethod = 'gps' | 'address' | 'map' | 'parcel'

export interface ResolvedLocation extends LatLon {
  method: LocationMethod
  /** Slowny opis zrodla wspolrzednych - trafia do raportu. */
  label: string
  /** Deklarowana/oszacowana dokladnosc pozycji w metrach; null gdy nieznana. */
  accuracyM: number | null
  provider: string
  /** Poziom dopasowania geokodera. */
  matchLevel?: 'address' | 'street' | 'city' | 'gps' | 'parcel' | 'map'
}

/** Pojedyncza warstwa litologiczna z profilu otworu CBDG. */
export interface LithologyLayer {
  fromM: number
  toM: number
  description: string
  descriptionBasis: string | null
  chronostratigraphy: string | null
  lithostratigraphy: string | null
}

/** Warstwa stratygraficzna (chronostratygrafia) z profilu otworu CBDG. */
export interface StratigraphyLayer {
  fromM: number
  toM: number
  description: string
  author: string | null
}

/** Zakres wartości publikowany przez usługę (MPGN podaje przedziały, nie liczby). */
export interface ValueRange {
  min: number
  max: number
  /** Etykieta do wyświetlenia, np. „40–45". */
  label: string
}

/** Parametry projektowe dolnego źródła z Mapy Potencjału Geotermii Niskotemperaturowej. */
export interface MpgnData {
  /** Przedział głębokości, dla którego MPGN publikuje wartości (40/70/100/130 m). */
  bracketDepthM: number
  targetDepthM: number
  /** Przewodność termiczna gruntu λ [W/(m·K)] w zakresie 0..bracketDepthM. */
  lambdaWmK: ValueRange | null
  /** Jednostkowa wydajność termiczna qᵥ [W/m] dla 1800 h pracy pompy w roku. */
  qv1800Wm: ValueRange | null
  /** Jednostkowa wydajność termiczna qᵥ [W/m] dla 2100 h pracy pompy w roku. */
  qv2100Wm: ValueRange | null
  sourceId: SourceId
  sourceUrl: string
}

/** Wstępny dobór długości odwiertów na podstawie qᵥ z MPGN. */
export interface BoreholeSizing {
  /** Moc grzewcza pompy ciepła podana przez użytkownika [kW]. */
  heatPumpKw: number
  /** Przyjęty SCOP (sezonowy współczynnik efektywności). */
  scop: number
  /** Moc pobierana z gruntu = P × (1 − 1/SCOP) [kW]. */
  groundLoadKw: number
  /** Roczny czas pracy przyjęty do doboru qᵥ [h]. */
  annualHours: 1800 | 2100
  qvWm: ValueRange
  /** Wymagana łączna długość odwiertów [m] — zakres wynikający z przedziału qᵥ. */
  totalMetresRange: { min: number; max: number }
  /** Liczba odwiertów przy zadanej głębokości pojedynczego otworu. */
  boreholeCountRange: { min: number; max: number }
  singleBoreholeDepthM: number
  assumptions: string[]
}

/** Klasa niepewności lokalizacji otworu wynikająca z pola PODS_LOKA w CBDG. */
export type LocationQualityClass = 'geodezyjna' | 'mapowa' | 'przybliżona' | 'nieznana'

export interface LocationQuality {
  cls: LocationQualityClass
  /** Szacunkowa niepewność położenia otworu [m]. */
  uncertaintyM: number
  /** Oryginalny opis z CBDG. */
  basis: string | null
  note: string
}

export interface BoreholeSummary {
  /** ID CBDG - identyfikator otworu w Centralnej Bazie Danych Geologicznych. */
  cbdgId: number
  name: string
  lat: number
  lon: number
  /** Odleglosc od punktu inwestycji [m], liczona wzorem haversine. */
  distanceM: number
  /** Glebokosc koncowa otworu [m]. */
  finalDepthM: number | null
  /** Rzedna terenu [m n.p.m.]. */
  elevationM: number | null
  drillingYear: number | null
  drillingPurpose: string | null
  stratigraphyAtBottom: string | null
  locality: string | null
  commune: string | null
  county: string | null
  voivodeship: string | null
  locationBasis: string | null
  /** Ocena wiarygodności położenia otworu wg pola „podstawa lokalizacji" w CBDG. */
  locationQuality: LocationQuality
  /** Promien, w ktorym otwor zostal znaleziony [m]. */
  foundInRadiusM: number
  sourceId: SourceId
  sourceUrl: string
}

export interface BoreholeDetail extends BoreholeSummary {
  /** Profil litologiczny (moze byc pusty - wtedy brak danych). */
  lithology: LithologyLayer[]
  /** Profil stratygraficzny (moze byc pusty). */
  stratigraphy: StratigraphyLayer[]
  /** Najglebszy punkt profilu litologicznego [m]. */
  lithologyMaxDepthM: number | null
  /** Nazwa profilu litologicznego i jego zrodlo informacji w CBDG. */
  lithologyProfileName: string | null
  lithologySourceNote: string | null
  /** Uwagi diagnostyczne (np. brak profilu w bazie, blad pobrania). */
  notes: string[]
  detailSourceUrl: string
}

/** Punkt monitoringu wod podziemnych PSH z pomierzonym zwierciadlem. */
export interface GroundwaterPoint {
  id: number | null
  name: string | null
  lat: number
  lon: number
  distanceM: number
  /** Glebokosc zwierciadla nawierconego [m p.p.t.]. */
  drilledLevelM: number | null
  /** Glebokosc zwierciadla ustalonego [m p.p.t.]; wartosc ujemna = wyplyw na powierzchnie (artezyjskie). */
  stabilisedLevelM: number | null
  /** Ostatni pomiar glebokosci zwierciadla [m p.p.t.]. */
  measuredLevelM: number | null
  measurementDate: string | null
  aquiferTopM: number | null
  aquiferBottomM: number | null
  lithology: string | null
  chronostratigraphy: string | null
  mediumType: string | null
  yieldLps: number | null
  boreholeDepthM: number | null
  sourceId: SourceId
  sourceUrl: string
}

export interface HydroContextArea {
  layerLabel: string
  attributes: Record<string, unknown>
  sourceId: SourceId
  sourceUrl: string
}

/** Odwolanie do dowodu - kazda warstwa raportu musi je posiadac. */
export interface EvidenceRef {
  cbdgId: number
  boreholeName: string
  distanceM: number
  /** Niepewność położenia otworu źródłowego [m] — z pola „podstawa lokalizacji". */
  locationUncertaintyM?: number
  /** Zakres głębokości ODNIESIONY DO PUNKTU INWESTYCJI [m p.p.t.]. */
  fromM: number
  toM: number
  /** Oryginalny zakres głębokości w otworze źródłowym [m p.p.t. otworu]. */
  sourceFromM?: number
  sourceToM?: number
  /** Korekta wysokościowa zastosowana do tej warstwy [m]; 0 = brak korekty. */
  elevationShiftM?: number
  sourceId: SourceId
  sourceUrl: string
}

export interface SyntheticLayer {
  fromM: number
  toM: number
  /** Opis litologiczny przepisany z profilu CBDG (bez interpretacji). */
  description: string | null
  chronostratigraphy: string | null
  /** true = brak jakichkolwiek danych CBDG w tym przedziale glebokosci. */
  noData: boolean
  evidence: EvidenceRef | null
}

export type RiskCode =
  | 'KURZAWKA'
  | 'PIASKI_NAWODNIONE'
  | 'ARTEZYJSKIE'
  | 'ILY_POZNANSKIE'
  | 'KRAS'
  | 'ANHYDRYT_GIPS'
  | 'SKALY_TWARDE'
  | 'GLAZY_OTOCZAKI'
  | 'TORF_GRUNT_ORGANICZNY'

export type RiskSeverity = 'wysokie' | 'srednie' | 'informacyjne'

export interface RiskFinding {
  code: RiskCode
  label: string
  severity: RiskSeverity
  /** Dlaczego to ryzyko ma znaczenie przy wierceniu GSHP. */
  rationale: string
  /** Fragmenty opisow, ktore uruchomily detekcje. */
  matches: Array<{
    matchedText: string
    keyword: string
    evidence: EvidenceRef
  }>
}

export interface AuditEntry {
  ts: string
  stage: string
  message: string
  radiusM?: number
  endpoint?: string
  sourceId?: SourceId
  found?: number
  decision?: string
  durationMs?: number
  cache?: 'hit' | 'miss'
  httpStatus?: number
}

export interface OodaCycle {
  cycle: number
  radiusM: number
  observedBoreholes: number
  boreholesWithLithology: number
  maxLithologyDepthM: number | null
  coveragePct: number
  gaps: Array<{ fromM: number; toM: number }>
  decision: 'wystarczajace' | 'rozszerz-promien' | 'wyczerpano-promienie'
  reason: string
}

export interface AnalyzeRequest {
  lat: number
  lon: number
  targetDepthM?: number
  method?: LocationMethod
  locationLabel?: string
  accuracyM?: number | null
}

export interface VerificationSummary {
  /** Czy udalo sie polaczyc z uslugami PGI. */
  pgiReachable: boolean
  checkedEndpoints: Array<{
    sourceId: SourceId
    name: string
    url: string
    status: 'ok' | 'blad' | 'brak-danych'
    detail: string
  }>
  finalRadiusM: number
  radiiChecked: number[]
  /** Liczba otworow zwrocona przez usluge w promieniu koncowym. */
  boreholesFound: number
  /** Liczba otworow wypisanych w raporcie (payload jest ograniczany). */
  boreholesListed: number
  boreholesWithLithology: number
  targetDepthM: number
  profileCoveragePct: number
  dataSufficient: boolean
  /** Usluga ArcGIS osiagnela limit 1000 rekordow - w promieniu moze byc wiecej otworow. */
  transferLimitReached: boolean
  /** Wyczerpano limit otworow pobieranych szczegolowo. */
  detailLimitReached: boolean
  /** Przerwano pobieranie profili z powodu budzetu czasu. */
  timeBudgetExceeded: boolean
}

export interface GshpReport {
  generatedAt: string
  location: ResolvedLocation
  targetDepthM: number
  /** Rzędna terenu w punkcie inwestycji [m n.p.m.] z NMT GUGiK; null = nie ustalono. */
  siteElevationM: number | null
  siteElevationSource: string | null
  /** Ocena wiarygodności całego raportu — zastępuje binarne „dane wystarczające". */
  credibility: CredibilityAssessment
  /** Parametry projektowe dolnego źródła z MPGN; null = poza zasięgiem mapy. */
  mpgn: MpgnData | null
  /** Wstępny dobór długości odwiertów; null gdy nie podano mocy pompy lub brak qᵥ. */
  sizing: BoreholeSizing | null
  /** Zdania opisujące parametry termiczne gruntu. */
  thermalStatements: string[]
  verification: VerificationSummary
  boreholes: BoreholeDetail[]
  syntheticProfile: SyntheticLayer[]
  hydrogeology: {
    groundwaterPoints: GroundwaterPoint[]
    contextAreas: HydroContextArea[]
    /** Krotkie, faktograficzne zdania - bez interpretacji ponad dane. */
    statements: string[]
    noDataNote: string | null
  }
  risks: RiskFinding[]
  /** Ryzyka jawnie sprawdzone i NIE potwierdzone w dostepnych danych. */
  risksNotFound: Array<{ code: RiskCode; label: string }>
  evidenceSummary: {
    totalLayers: number
    layersWithEvidence: number
    layersWithoutData: number
    distinctBoreholesUsed: number
    nearestBoreholeM: number | null
    farthestUsedBoreholeM: number | null
    endpointsUsed: Array<{ sourceId: SourceId; name: string; url: string }>
  }
  ooda: OodaCycle[]
  audit: AuditEntry[]
}
