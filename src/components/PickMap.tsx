import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface PickMapProps {
  lat: number
  lon: number
  /** Obrys dzialki ewidencyjnej (WGS84), gdy punkt pochodzi z ULDK. */
  outline?: Array<[number, number]> | null
  /** Promien niepewnosci punktu wyjsciowego - pokazuje, jak zgrubny jest wynik geokodera. */
  accuracyM?: number | null
  busy: boolean
  onConfirm: (lat: number, lon: number, moved: boolean) => void
}

/**
 * Mapa wyboru dokladnego miejsca odwiertu.
 *
 * Geokoder - nawet trafiajac w punkt adresowy - wskazuje budynek, a odwiert
 * wykonuje sie obok niego. Zamiast scigac sie o metry w wyszukiwarce, dajemy
 * wiertaczowi przesunac znacznik tam, gdzie faktycznie stanie wiertnica.
 * Domyslnym podkladem jest ortofotomapa GUGiK, bo na zdjeciu lotniczym widac
 * budynki, podjazdy i granice dzialki.
 */
export default function PickMap({
  lat,
  lon,
  outline,
  accuracyM,
  busy,
  onConfirm,
}: PickMapProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const originRef = useRef<{ lat: number; lon: number }>({ lat, lon })
  const [pos, setPos] = useState({ lat, lon })

  useEffect(() => {
    if (!ref.current || mapRef.current) return

    const start: L.LatLngExpression = [lat, lon]
    const map = L.map(ref.current, { scrollWheelZoom: true }).setView(start, zoomFor(accuracyM))
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
    orto.addTo(map)
    L.control
      .layers({ 'Ortofotomapa GUGiK': orto, OpenStreetMap: osm }, undefined, { collapsed: false })
      .addTo(map)

    // Krag niepewnosci punktu z geokodera - uczciwie pokazuje, ile trzeba poprawic.
    if (accuracyM && accuracyM > 25) {
      L.circle(start, {
        radius: accuracyM,
        color: '#f4a825',
        weight: 1,
        dashArray: '4 4',
        fill: false,
      }).addTo(map)
    }

    if (outline && outline.length >= 3) {
      const poly = L.polygon(outline, {
        color: '#7fd4ff',
        weight: 2,
        fillColor: '#7fd4ff',
        fillOpacity: 0.08,
      }).addTo(map)
      map.fitBounds(poly.getBounds().pad(0.25), { maxZoom: 19 })
    }

    const marker = L.marker(start, {
      draggable: true,
      autoPan: true,
      icon: L.divIcon({
        className: '',
        html:
          '<div style="width:20px;height:20px;border-radius:50%;background:#f4a825;' +
          'border:3px solid #16130a;box-shadow:0 0 0 3px rgba(244,168,37,.35)"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      zIndexOffset: 1000,
    }).addTo(map)
    markerRef.current = marker

    marker.on('drag', () => {
      const p = marker.getLatLng()
      setPos({ lat: p.lat, lon: p.lng })
    })
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng)
      setPos({ lat: e.latlng.lat, lon: e.latlng.lng })
    })

    // Kontener bywa mierzony przed ulozeniem layoutu - wymuszamy przeliczenie.
    setTimeout(() => map.invalidateSize(), 120)

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Mapa tworzona jest raz; zmiane punktu wejsciowego obsluguje osobny efekt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Nowy wynik wyszukiwania przy zywej mapie - przestawiamy znacznik i widok.
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker) return
    originRef.current = { lat, lon }
    marker.setLatLng([lat, lon])
    map.setView([lat, lon], zoomFor(accuracyM))
    setPos({ lat, lon })
  }, [lat, lon, accuracyM])

  const moved = distanceM(originRef.current, pos) > 1

  return (
    <div>
      <div
        ref={ref}
        style={{
          height: 380,
          borderRadius: 10,
          border: '1px solid var(--line)',
          overflow: 'hidden',
        }}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          Punkt odwiertu: <strong>{pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}</strong>
          {moved && (
            <span style={{ color: 'var(--accent)' }}>
              {' '}
              — przesunięty o {Math.round(distanceM(originRef.current, pos))} m
            </span>
          )}
        </span>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() => onConfirm(pos.lat, pos.lon, moved)}
        >
          {busy && <span className="spinner" />}
          {busy ? 'Analizuję…' : 'Analizuj ten punkt'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
        Przeciągnij znacznik albo kliknij mapę, aby wskazać planowane miejsce odwiertu. Ortofotomapa
        GUGiK pozwala rozpoznać budynki i granice działki. Podkład mapowy nie jest źródłem danych
        geologicznych.
      </p>
    </div>
  )
}

/** Przyblizenie dobrane do niepewnosci punktu - nie ma sensu pokazywac dachu, gdy blad to 2 km. */
function zoomFor(accuracyM: number | null | undefined): number {
  if (!accuracyM) return 18
  if (accuracyM <= 30) return 19
  if (accuracyM <= 60) return 18
  if (accuracyM <= 300) return 16
  if (accuracyM <= 1000) return 14
  return 12
}

/** Odleglosc w metrach (przyblizenie plaskie - wystarczajace dla dziesiatek metrow). */
function distanceM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = (b.lat - a.lat) * 111_320
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}
