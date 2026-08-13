import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GshpReport } from '../../server/types'

/**
 * Mapa sytuacyjna: punkt inwestycji, promienie wyszukiwania, otwory CBDG
 * i punkty monitoringu wód podziemnych.
 *
 * Podkłady: OpenStreetMap (orientacja) oraz ortofotomapa GUGiK (weryfikacja działki).
 * Podkład NIE jest źródłem danych geologicznych — służy wyłącznie do pokazania,
 * gdzie leżą otwory względem punktu inwestycji.
 *
 * Kolor sygnalizatora otworu niesie informację dowodową:
 *   zielony  — otwór użyty w profilu,
 *   pomarańcz — ma profil litologiczny, ale nie trafił do raportu,
 *   szary    — brak profilu litologicznego w CBDG.
 * Czerwony przerywany okrąg = niepewność położenia otworu (lokalizacja przybliżona).
 */
export default function SiteMap({ report }: { report: GshpReport }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!ref.current || mapRef.current) return

    const site: L.LatLngExpression = [report.location.lat, report.location.lon]
    const map = L.map(ref.current, { scrollWheelZoom: false }).setView(site, 15)
    mapRef.current = map

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    })
    const orto = L.tileLayer(
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution' +
        '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default' +
        '&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}',
      { maxZoom: 19, attribution: '© GUGiK — ortofotomapa' },
    )
    osm.addTo(map)
    L.control.layers({ 'OpenStreetMap': osm, 'Ortofotomapa GUGiK': orto }, undefined, {
      collapsed: false,
    }).addTo(map)

    const bounds = L.latLngBounds([site])

    // --- Promienie wyszukiwania ---
    for (const r of report.verification.radiiChecked) {
      L.circle(site, {
        radius: r,
        color: r === report.verification.finalRadiusM ? '#f4a825' : '#5a6673',
        weight: r === report.verification.finalRadiusM ? 2 : 1,
        dashArray: '5,6',
        fill: false,
        interactive: false,
      })
        .addTo(map)
        .bindTooltip(`promień ${r} m`, { permanent: false })
      bounds.extend(L.latLng(site).toBounds(r * 2))
    }

    // --- Niepewność pozycji punktu inwestycji ---
    if (report.location.accuracyM) {
      L.circle(site, {
        radius: report.location.accuracyM,
        color: '#58a6ff',
        weight: 1,
        fillColor: '#58a6ff',
        fillOpacity: 0.12,
        interactive: false,
      })
        .addTo(map)
        .bindTooltip(`niepewność pozycji ±${report.location.accuracyM} m`)
    }

    // --- Otwory CBDG ---
    const usedIds = new Set(
      report.syntheticProfile.filter((l) => l.evidence).map((l) => l.evidence!.cbdgId),
    )
    for (const b of report.boreholes) {
      const used = usedIds.has(b.cbdgId)
      const hasLitho = b.lithology.length > 0
      const color = used ? '#3fb950' : hasLitho ? '#d29922' : '#8b949e'

      if (b.locationQuality.uncertaintyM >= 1000) {
        L.circle([b.lat, b.lon], {
          radius: b.locationQuality.uncertaintyM,
          color: '#f85149',
          weight: 1,
          dashArray: '3,5',
          fill: false,
          interactive: false,
        }).addTo(map)
      }

      L.circleMarker([b.lat, b.lon], {
        radius: used ? 8 : 6,
        color: '#0d1117',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.95,
      })
        .addTo(map)
        .bindPopup(
          `<strong>${esc(b.name)}</strong><br>` +
            `ID CBDG: <a href="https://otworywiertnicze.pgi.gov.pl/details/${b.cbdgId}" target="_blank" rel="noreferrer">${b.cbdgId}</a><br>` +
            `Odległość: ${b.distanceM} m${b.locationQuality.uncertaintyM >= 1000 ? ' <span style="color:#c93c37">(±~1 km)</span>' : ''}<br>` +
            `Głębokość: ${b.finalDepthM ?? '—'} m · rzędna: ${b.elevationM ?? '—'} m n.p.m.<br>` +
            `Rok: ${b.drillingYear ?? '—'} · cel: ${esc(b.drillingPurpose ?? '—')}<br>` +
            `Profil litologiczny: ${hasLitho ? `${b.lithology.length} warstw` : '<em>brak w CBDG</em>'}<br>` +
            `Lokalizacja: ${esc(b.locationQuality.cls)} (±${b.locationQuality.uncertaintyM} m)` +
            (used ? '<br><strong style="color:#2c8a3c">Użyty w profilu</strong>' : ''),
        )
      bounds.extend([b.lat, b.lon])
    }

    // --- Punkty monitoringu wód podziemnych ---
    for (const g of report.hydrogeology.groundwaterPoints) {
      L.circleMarker([g.lat, g.lon], {
        radius: 5,
        color: '#0d1117',
        weight: 1.5,
        fillColor: '#58a6ff',
        fillOpacity: 0.95,
      })
        .addTo(map)
        .bindPopup(
          `<strong>Monitoring wód podziemnych PSH</strong><br>` +
            `Punkt: ${esc(String(g.name ?? g.id ?? '—'))}<br>` +
            `Odległość: ${g.distanceM} m<br>` +
            `Zwierciadło nawiercone: ${num(g.drilledLevelM)} m p.p.t.<br>` +
            `Zwierciadło ustalone: ${num(g.stabilisedLevelM)} m p.p.t.<br>` +
            `Warstwa wodonośna: ${num(g.aquiferTopM)}–${num(g.aquiferBottomM)} m<br>` +
            `Litologia: ${esc(g.lithology ?? '—')}`,
        )
      bounds.extend([g.lat, g.lon])
    }

    // --- Punkt inwestycji na wierzchu ---
    L.marker(site, {
      icon: L.divIcon({
        className: '',
        html:
          '<div style="width:20px;height:20px;border-radius:50%;background:#f4a825;' +
          'border:3px solid #16130a;box-shadow:0 0 0 3px rgba(244,168,37,.35)"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      zIndexOffset: 1000,
    })
      .addTo(map)
      .bindPopup(
        `<strong>Punkt inwestycji</strong><br>${report.location.lat.toFixed(6)}, ${report.location.lon.toFixed(6)}<br>` +
          `${esc(report.location.label)}` +
          (report.siteElevationM !== null
            ? `<br>Rzędna terenu: ${report.siteElevationM} m n.p.m.`
            : ''),
      )

    map.fitBounds(bounds.pad(0.1), { maxZoom: 16 })
    // Kontener bywa mierzony przed ułożeniem layoutu — wymuszamy przeliczenie.
    setTimeout(() => map.invalidateSize(), 120)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [report])

  return (
    <div>
      <div ref={ref} className="map" />
      <div className="map-legend">
        <span>
          <i style={{ background: '#f4a825' }} /> punkt inwestycji
        </span>
        <span>
          <i style={{ background: '#3fb950' }} /> otwór użyty w profilu
        </span>
        <span>
          <i style={{ background: '#d29922' }} /> otwór z litologią, nieużyty
        </span>
        <span>
          <i style={{ background: '#8b949e' }} /> otwór bez profilu
        </span>
        <span>
          <i style={{ background: '#58a6ff' }} /> monitoring wód (PSH)
        </span>
        <span>
          <i style={{ background: 'transparent', border: '1px dashed #f85149' }} /> niepewność
          położenia otworu
        </span>
      </div>
    </div>
  )
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  )
}

function num(n: number | null): string {
  return n === null ? 'b.d.' : String(n).replace('.', ',')
}
