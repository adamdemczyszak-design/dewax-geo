/**
 * Rejestr oficjalnych punktow dostepowych PGI-PIB / CBDG.
 *
 * ZASADA: dane geologiczne pochodza WYLACZNIE z uslug PGI-PIB wymienionych ponizej.
 * Kazdy rekord w raporcie musi wskazywac na jeden z tych identyfikatorow (`SourceId`).
 * Nie wolno dopisywac tu serwisow nieoficjalnych ani danych wpisanych recznie.
 *
 * Wszystkie adresy zostaly zweryfikowane odpytaniem uslugi (patrz README.md).
 */

export const CBDG_ARCGIS_ROOT = 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services'
export const CBDG_OTWORY_API_ROOT = 'https://otworywiertnicze.pgi.gov.pl'

export type SourceId =
  | 'CBDG_OTWORY_MAPSERVER'
  | 'CBDG_OTWORY_REST'
  | 'CBDG_PUNKTY_BADAWCZE'
  | 'CBDH_OBIEKTY_HYDRO'
  | 'PSH_MONITORING_WOD'
  | 'CBDG_GZWP'
  | 'CBDG_JCWPD'
  | 'MPGN_GEOTERMIA'
  | 'GUGIK_NMT'

export interface EndpointDescriptor {
  id: SourceId
  /** Nazwa uslugi wg wykazu "CBDG Usugi GIS" PGI-PIB. */
  name: string
  /** Adres wykorzystywany przez aplikacje. */
  url: string
  /** Typ protokolu. */
  kind:
    | 'ArcGIS REST (MapServer/Query)'
    | 'REST JSON (CBDG Otwory wiertnicze)'
    | 'REST (GUGiK NMT)'
  /** Co dokladnie pobieramy z tej uslugi. */
  role: string
  /** Wlasciciel danych. */
  owner: string
}

export const ENDPOINTS: Record<SourceId, EndpointDescriptor> = {
  CBDG_OTWORY_MAPSERVER: {
    id: 'CBDG_OTWORY_MAPSERVER',
    name: 'Otwory wiertnicze CBDG',
    url: `${CBDG_ARCGIS_ROOT}/cbdg_otwory/MapServer/0`,
    kind: 'ArcGIS REST (MapServer/Query)',
    role: 'Wyszukiwanie przestrzenne otworów wiertniczych w promieniu od punktu inwestycji (ID CBDG, nazwa, głębokość, rzędna, stratygrafia, cel wiercenia, rok, lokalizacja).',
    owner: 'PIG-PIB',
  },
  CBDG_OTWORY_REST: {
    id: 'CBDG_OTWORY_REST',
    name: 'CBDG Otwory wiertnicze — API aplikacji (profile otworu)',
    url: `${CBDG_OTWORY_API_ROOT}/boreholes/{id}`,
    kind: 'REST JSON (CBDG Otwory wiertnicze)',
    role: 'Metryka otworu oraz profil litologiczny (warstwy od–do z opisem) i profil stratygraficzny konkretnego otworu CBDG.',
    owner: 'PIG-PIB',
  },
  CBDG_PUNKTY_BADAWCZE: {
    id: 'CBDG_PUNKTY_BADAWCZE',
    name: 'Punkty badawcze CBDG (analizy)',
    url: `${CBDG_ARCGIS_ROOT}/analizy_pkt_bad/MapServer/0`,
    kind: 'ArcGIS REST (MapServer/Query)',
    role: 'Kontrola pokrycia obszaru punktami badawczymi i dokumentacyjnymi CBDG — informacja o dostępności dodatkowych analiz.',
    owner: 'PIG-PIB',
  },
  CBDH_OBIEKTY_HYDRO: {
    id: 'CBDH_OBIEKTY_HYDRO',
    name: 'Hydrogeologia — obiekty hydrogeologiczne (CBDH)',
    url: `${CBDG_ARCGIS_ROOT}/hydrogeologia/cbdh_otwory/MapServer/0`,
    kind: 'ArcGIS REST (MapServer/Query)',
    role: 'Otwory hydrogeologiczne CBDH w otoczeniu inwestycji (głębokość, stratygrafia na dnie, typ i przeznaczenie otworu).',
    owner: 'PIG-PIB',
  },
  PSH_MONITORING_WOD: {
    id: 'PSH_MONITORING_WOD',
    name: 'Hydrogeologia — monitoring wód podziemnych (PSH)',
    url: `${CBDG_ARCGIS_ROOT}/hydrogeologia/mwp/MapServer/0`,
    kind: 'ArcGIS REST (MapServer/Query)',
    role: 'Pomierzone zwierciadło wody: nawiercone i ustalone, strop i spąg warstwy wodonośnej, litologia i stratygrafia warstwy wodonośnej, wydajność.',
    owner: 'PIG-PIB / PSH',
  },
  CBDG_GZWP: {
    id: 'CBDG_GZWP',
    name: 'Hydrogeologia — Główne Zbiorniki Wód Podziemnych (GZWP)',
    url: `${CBDG_ARCGIS_ROOT}/hydrogeologia/gzwp/MapServer`,
    kind: 'ArcGIS REST (MapServer/Query)',
    role: 'Sprawdzenie, czy punkt inwestycji leży w granicach GZWP/LZWP (ograniczenia formalne dla wierceń).',
    owner: 'PIG-PIB',
  },
  CBDG_JCWPD: {
    id: 'CBDG_JCWPD',
    name: 'Hydrogeologia — Jednolite Części Wód Podziemnych (JCWPd)',
    url: `${CBDG_ARCGIS_ROOT}/hydrogeologia/jcwpd/MapServer`,
    kind: 'ArcGIS REST (MapServer/Query)',
    role: 'Przypisanie punktu inwestycji do JCWPd (podział obowiązujący — 174).',
    owner: 'PIG-PIB',
  },
  MPGN_GEOTERMIA: {
    id: 'MPGN_GEOTERMIA',
    name: 'Mapa Potencjału Geotermii Niskotemperaturowej (MPGN)',
    url: `${CBDG_ARCGIS_ROOT}/geotermia/mpgn/MapServer`,
    kind: 'ArcGIS REST (MapServer/Query)',
    role: 'Parametry projektowe dolnego źródła: przewodność termiczna gruntu λ [W/(m·K)] oraz jednostkowa wydajność termiczna otworu qᵥ [W/m] dla 1800 i 2100 h pracy pompy w roku.',
    owner: 'PIG-PIB',
  },
  GUGIK_NMT: {
    id: 'GUGIK_NMT',
    name: 'GUGiK — Numeryczny Model Terenu (wysokość punktu)',
    url: 'https://services.gugik.gov.pl/nmt/',
    kind: 'REST (GUGiK NMT)',
    role: 'Rzędna terenu w punkcie inwestycji [m n.p.m.] — niezbędna do korekty wysokościowej profilu. NIE jest źródłem danych geologicznych.',
    owner: 'GUGiK',
  },
}

/**
 * Warstwy MPGN dobierane wg głębokości docelowej otworu.
 * Serwis publikuje wartości w przedziałach 40 / 70 / 100 / 130 m p.p.t.
 * Zweryfikowane odpytaniem usługi.
 */
export const MPGN_BRACKETS = [
  { depthM: 40, lambdaLayer: 25, qv1800Layer: 15, qv2100Layer: 20 },
  { depthM: 70, lambdaLayer: 26, qv1800Layer: 16, qv2100Layer: 21 },
  { depthM: 100, lambdaLayer: 27, qv1800Layer: 17, qv2100Layer: 22 },
  { depthM: 130, lambdaLayer: 28, qv1800Layer: 18, qv2100Layer: 23 },
] as const

/** Dobiera przedział MPGN najbliższy zadanej głębokości docelowej. */
export function pickMpgnBracket(targetDepthM: number) {
  return MPGN_BRACKETS.reduce((best, b) =>
    Math.abs(b.depthM - targetDepthM) < Math.abs(best.depthM - targetDepthM) ? b : best,
  )
}

/** Warstwy w serwisie GZWP: 0 - udokumentowane, 1 - nieudokumentowane, 2 - LZWP. */
export const GZWP_LAYERS = [
  { layer: 0, label: 'GZWP udokumentowane' },
  { layer: 1, label: 'GZWP nieudokumentowane' },
  { layer: 2, label: 'LZWP' },
] as const

/** Warstwa 2 = podzial na 174 JCWPd (obowiazujacy). */
export const JCWPD_LAYER = { layer: 2, label: 'JCWPd (174)' } as const

/** Drabina promieni wyszukiwania wymagana przez procedure [m]. */
export const RADIUS_LADDER = [200, 500, 1000, 2000, 5000] as const

/** Domyslna glebokosc docelowa otworu GSHP [m p.p.t.]. */
export const DEFAULT_TARGET_DEPTH_M = 100
