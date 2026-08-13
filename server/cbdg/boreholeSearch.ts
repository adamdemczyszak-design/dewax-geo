import type { CbdgClient, ArcGisFeature } from './cbdgClient'
import { ENDPOINTS } from '../endpoints'
import { haversineDistanceM, toPl1992 } from '../geo/distance'
import type {
  BoreholeDetail,
  BoreholeSummary,
  GroundwaterPoint,
  LatLon,
  LithologyLayer,
  StratigraphyLayer,
  HydroContextArea,
} from '../types'
import { GZWP_LAYERS, JCWPD_LAYER } from '../endpoints'
import { AuditLog } from '../core/auditLog'
import { assessLocationQuality } from '../report/locationQuality'

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length ? s : null
}

/**
 * Daty w usługach ArcGIS przychodzą jako epoch (ms, czasem s) albo jako tekst.
 * Zwracamy zawsze ISO `RRRR-MM-DD` albo null — nigdy surowej liczby.
 */
export const parseArcGisDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null

  // Tekst juz w formacie ISO - bierzemy sama date, bez udzialu stref czasowych.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    return v.trim().slice(0, 10)
  }

  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (Number.isFinite(n) && Math.abs(n) > 1e8) {
    // < 1e12 => sekundy, >= 1e12 => milisekundy
    const ms = Math.abs(n) < 1e12 ? n * 1000 : n
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    // Uslugi PGI koduja daty wzgledem czasu polskiego - formatujemy w tej samej
    // strefie, zeby wynik nie zalezal od strefy serwera (Netlify pracuje w UTC).
    return WARSAW_DATE.format(d)
  }

  const s = String(v).trim()
  return s.length ? s : null
}

const WARSAW_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Wyszukanie otworow wiertniczych CBDG w zadanym promieniu od punktu inwestycji.
 *
 * Bufor liczony jest po stronie uslugi w ukladzie PL-1992 (metry), a nastepnie
 * odleglosc kazdego otworu jest przeliczana lokalnie wzorem haversine i twardo
 * filtrowana - dzieki temu wynik nie zalezy od sposobu buforowania po stronie serwera.
 */
export async function searchBoreholes(
  client: CbdgClient,
  center: LatLon,
  radiusM: number,
): Promise<BoreholeSummary[]> {
  const p = toPl1992(center)
  const ep = ENDPOINTS.CBDG_OTWORY_MAPSERVER

  const res = await client.queryLayer(
    ep.url,
    {
      geometry: `${p.x},${p.y}`,
      geometryType: 'esriGeometryPoint',
      inSR: 2180,
      distance: radiusM,
      units: 'esriSRUnit_Meter',
      spatialRel: 'esriSpatialRelIntersects',
      outFields:
        'ID_CBDG,NAZWA,GLEBOKOSC,RZEDNA,STRAT,CEL_WIERC,ROK,MIEJSCOWOSC,GMINA,POWIAT,WOJEWODZTWO,PODS_LOKA',
      returnGeometry: true,
      outSR: 4326,
    },
    { sourceId: ep.id, stage: 'wyszukiwanie:otwory', radiusM },
  )

  return res.features
    .map((f) => toBoreholeSummary(f, center, radiusM, ep.url))
    .filter((b): b is BoreholeSummary => b !== null)
    .filter((b) => b.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
}

function toBoreholeSummary(
  f: ArcGisFeature,
  center: LatLon,
  radiusM: number,
  sourceUrl: string,
): BoreholeSummary | null {
  const a = f.attributes
  const cbdgId = num(a.ID_CBDG)
  if (cbdgId === null || !f.geometry) return null
  const lat = f.geometry.y
  const lon = f.geometry.x
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  return {
    cbdgId,
    name: str(a.NAZWA) ?? `Otwór CBDG ${cbdgId}`,
    lat,
    lon,
    distanceM: Math.round(haversineDistanceM(center, { lat, lon })),
    finalDepthM: num(a.GLEBOKOSC),
    elevationM: num(a.RZEDNA),
    drillingYear: num(a.ROK),
    drillingPurpose: str(a.CEL_WIERC),
    stratigraphyAtBottom: str(a.STRAT),
    locality: str(a.MIEJSCOWOSC),
    commune: str(a.GMINA),
    county: str(a.POWIAT),
    voivodeship: str(a.WOJEWODZTWO),
    locationBasis: str(a.PODS_LOKA),
    locationQuality: assessLocationQuality(str(a.PODS_LOKA)),
    foundInRadiusM: radiusM,
    sourceId: 'CBDG_OTWORY_MAPSERVER',
    sourceUrl,
  }
}

/**
 * Pobranie profilu litologicznego i stratygraficznego otworu z API CBDG.
 * Brak profilu w bazie NIE jest bledem - zostaje odnotowany jako brak danych.
 */
export interface LoadDetailOptions {
  /**
   * Czy pobierac osobny profil stratygraficzny (2 dodatkowe zapytania na otwor).
   * Domyslnie WYLACZONE: chronostratygrafia kazdej warstwy jest juz zwracana razem
   * z profilem litologicznym, a stratygrafia na dnie otworu - przez usluge mapowa.
   * Wlaczanie tego ma sens tylko przy analizie pojedynczego otworu.
   */
  includeStratigraphy?: boolean
}

export async function loadBoreholeDetail(
  client: CbdgClient,
  summary: BoreholeSummary,
  options: LoadDetailOptions = {},
): Promise<BoreholeDetail> {
  const notes: string[] = []
  let lithology: LithologyLayer[] = []
  let stratigraphy: StratigraphyLayer[] = []
  let lithologyProfileName: string | null = null
  let lithologySourceNote: string | null = null

  const detailSourceUrl = `${ENDPOINTS.CBDG_OTWORY_REST.url.replace('{id}', String(summary.cbdgId))}`

  try {
    const details = await client.boreholeDetails(summary.cbdgId)

    if (details.features?.lithology) {
      const profiles = await client.lithologicalProfiles(summary.cbdgId)
      const profile = pickPrimaryProfile(profiles)
      if (profile) {
        lithologyProfileName = profile.name
        lithologySourceNote = profile.informationSource
        const units = await client.lithologicalUnits(summary.cbdgId, profile.id)
        lithology = units
          .filter((u) => num(u.from) !== null && num(u.to) !== null)
          .map((u) => ({
            fromM: Number(u.from),
            toM: Number(u.to),
            description: str(u.description) ?? '(brak opisu w rekordzie CBDG)',
            descriptionBasis: str(u.descriptionBasis),
            chronostratigraphy: str(u.chronostratigraphy),
            lithostratigraphy: str(u.lithostratigraphy),
          }))
          .filter((u) => u.toM > u.fromM)
          .sort((a, b) => a.fromM - b.fromM)
        if (!lithology.length) {
          notes.push('CBDG deklaruje profil litologiczny, ale zwrócił pustą listę warstw.')
        }
      } else {
        notes.push('Brak profilu litologicznego oznaczonego jako podstawowy.')
      }
    } else {
      notes.push('Brak profilu litologicznego w CBDG dla tego otworu.')
    }

    if (!details.features?.stratigraphy) {
      notes.push('Brak profilu stratygraficznego w CBDG dla tego otworu.')
    } else if (options.includeStratigraphy) {
      const sProfiles = await client.stratigraphicProfiles(summary.cbdgId)
      const sProfile = pickPrimaryProfile(sProfiles)
      if (sProfile) {
        const layers = await client.stratigraphicLayers(sProfile.id, 'C')
        stratigraphy = layers
          .filter((l) => num(l.from) !== null && num(l.to) !== null)
          .map((l) => ({
            fromM: Number(l.from),
            toM: Number(l.to),
            description: str(l.description) ?? '(brak opisu)',
            author: str(l.author),
          }))
          .sort((a, b) => a.fromM - b.fromM)
      }
    }
  } catch (err) {
    notes.push(`Nie udało się pobrać profilu z API CBDG: ${(err as Error).message}`)
  }

  const lithologyMaxDepthM = lithology.length
    ? Math.max(...lithology.map((l) => l.toM))
    : null

  return {
    ...summary,
    lithology,
    stratigraphy,
    lithologyMaxDepthM,
    lithologyProfileName,
    lithologySourceNote,
    notes,
    detailSourceUrl,
  }
}

function pickPrimaryProfile<T extends { category: string | null; id: number }>(
  profiles: T[] | null | undefined,
): T | null {
  if (!profiles?.length) return null
  return (
    profiles.find((p) => (p.category ?? '').toLowerCase().includes('podstawow')) ??
    profiles[0]
  )
}

/**
 * Punkty monitoringu wod podziemnych PSH - jedyne w CBDG zrodlo z pomierzonym
 * zwierciadlem wody (nawierconym i ustalonym).
 */
export async function searchGroundwaterPoints(
  client: CbdgClient,
  center: LatLon,
  radiusM: number,
): Promise<GroundwaterPoint[]> {
  const p = toPl1992(center)
  const ep = ENDPOINTS.PSH_MONITORING_WOD

  const res = await client.queryLayer(
    ep.url,
    {
      geometry: `${p.x},${p.y}`,
      geometryType: 'esriGeometryPoint',
      inSR: 2180,
      distance: radiusM,
      units: 'esriSRUnit_Meter',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: true,
      outSR: 4326,
    },
    { sourceId: ep.id, stage: 'wyszukiwanie:monitoring-wod', radiusM },
  )

  return res.features
    .map((f): GroundwaterPoint | null => {
      if (!f.geometry) return null
      const a = f.attributes
      const lat = f.geometry.y
      const lon = f.geometry.x
      return {
        id: num(a.ID),
        name: str(a.NR_PKT_MONIT_ILOSC) ?? str(a.NUMER_CBDH) ?? str(a.NR_MONIT_BAD),
        lat,
        lon,
        distanceM: Math.round(haversineDistanceM(center, { lat, lon })),
        drilledLevelM: num(a.ZWIERCIADLO_NAW),
        stabilisedLevelM: num(a.ZWIERCIADLO_SWOBODNE),
        measuredLevelM: num(a.GLEBOKOSC_ZWIERCIADLA),
        measurementDate: parseArcGisDate(a.DATA_POMIARU),
        aquiferTopM: num(a.GLEBOKOSC_W_OD),
        aquiferBottomM: num(a.GLEBOKOSC_W_DO),
        lithology: str(a.LITOLOGIA),
        chronostratigraphy: str(a.CHRONO),
        mediumType: str(a.TYP_OSRODKA),
        yieldLps: num(a.WYDAJNOSC),
        boreholeDepthM: num(a.GLEBOKOSC_OTWORU) ?? num(a.GLEB_OST_OTWORU),
        sourceId: ep.id,
        sourceUrl: ep.url,
      }
    })
    .filter((g): g is GroundwaterPoint => g !== null && g.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
}

/** Otwory hydrogeologiczne CBDH w otoczeniu - kontekst uzupelniajacy. */
export async function searchCbdhObjects(
  client: CbdgClient,
  center: LatLon,
  radiusM: number,
): Promise<HydroContextArea[]> {
  const p = toPl1992(center)
  const ep = ENDPOINTS.CBDH_OBIEKTY_HYDRO
  const res = await client.queryLayer(
    ep.url,
    {
      geometry: `${p.x},${p.y}`,
      geometryType: 'esriGeometryPoint',
      inSR: 2180,
      distance: radiusM,
      units: 'esriSRUnit_Meter',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'NAZWA,GLEBOKOSC,RZEDNA,DATA_WYKONANIA,STRATYGRAFIA_NA_DNIE,TYP_OTWORU,PRZEZNACZENIE_OTWORU,MIEJSCOWOSC',
      returnGeometry: false,
      resultRecordCount: 25,
    },
    { sourceId: ep.id, stage: 'wyszukiwanie:cbdh', radiusM },
  )
  return res.features.map((f) => ({
    layerLabel: 'Obiekt hydrogeologiczny CBDH',
    attributes: f.attributes,
    sourceId: ep.id,
    sourceUrl: ep.url,
  }))
}

/** Konteksty obszarowe: GZWP/LZWP oraz JCWPd, w ktorych lezy punkt inwestycji. */
export async function loadHydroContext(
  client: CbdgClient,
  center: LatLon,
  audit: AuditLog,
): Promise<HydroContextArea[]> {
  const p = toPl1992(center)
  const out: HydroContextArea[] = []

  for (const { layer, label } of GZWP_LAYERS) {
    const url = `${ENDPOINTS.CBDG_GZWP.url}/${layer}`
    try {
      const res = await client.queryPointInPolygon(url, p.x, p.y, {
        sourceId: 'CBDG_GZWP',
        stage: 'kontekst:gzwp',
      })
      for (const f of res.features) {
        out.push({ layerLabel: label, attributes: f.attributes, sourceId: 'CBDG_GZWP', sourceUrl: url })
      }
    } catch (err) {
      audit.add({
        stage: 'kontekst:gzwp',
        message: `Warstwa „${label}" niedostępna: ${(err as Error).message}`,
        endpoint: url,
        sourceId: 'CBDG_GZWP',
      })
    }
  }

  const jcwpdUrl = `${ENDPOINTS.CBDG_JCWPD.url}/${JCWPD_LAYER.layer}`
  try {
    const res = await client.queryPointInPolygon(jcwpdUrl, p.x, p.y, {
      sourceId: 'CBDG_JCWPD',
      stage: 'kontekst:jcwpd',
    })
    for (const f of res.features) {
      out.push({
        layerLabel: JCWPD_LAYER.label,
        attributes: f.attributes,
        sourceId: 'CBDG_JCWPD',
        sourceUrl: jcwpdUrl,
      })
    }
  } catch (err) {
    audit.add({
      stage: 'kontekst:jcwpd',
      message: `Warstwa JCWPd niedostępna: ${(err as Error).message}`,
      endpoint: jcwpdUrl,
      sourceId: 'CBDG_JCWPD',
    })
  }

  return out
}
