import { useState } from 'react'
import { geocode } from '../api'
import type { GeocodeCandidate } from '../../server/geocoder'

export interface LocationPick {
  lat: number
  lon: number
  method: 'gps' | 'address'
  label: string
  accuracyM: number | null
}

export interface DesignInput {
  targetDepthM: number
  heatPumpKw: number | null
  annualHours: 1800 | 2100
}

interface Props {
  busy: boolean
  onSubmit: (pick: LocationPick, design: DesignInput) => void
}

export default function LocationForm({ busy, onSubmit }: Props) {
  const [street, setStreet] = useState('')
  const [houseNumber, setHouseNumber] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  const [depth, setDepth] = useState('100')
  const [power, setPower] = useState('')
  const [hours, setHours] = useState<'1800' | '2100'>('1800')

  const [gpsBusy, setGpsBusy] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([])

  const design = (): DesignInput => {
    const d = Number(depth)
    const p = Number(power.replace(',', '.'))
    return {
      targetDepthM: Number.isFinite(d) ? Math.min(500, Math.max(10, Math.round(d))) : 100,
      heatPumpKw: Number.isFinite(p) && p > 0 ? p : null,
      annualHours: hours === '2100' ? 2100 : 1800,
    }
  }

  const useGps = () => {
    setError(null)
    setNote(null)
    setCandidates([])
    if (!('geolocation' in navigator)) {
      setError('Ta przeglądarka nie udostępnia lokalizacji GPS (navigator.geolocation).')
      return
    }
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false)
        const acc = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
        onSubmit(
          {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            method: 'gps',
            label: `Lokalizacja GPS przeglądarki${acc !== null ? ` (dokładność ±${acc} m)` : ''}`,
            accuracyM: acc,
          },
          design(),
        )
      },
      (err) => {
        setGpsBusy(false)
        const map: Record<number, string> = {
          1: 'Odmówiono dostępu do lokalizacji. Zezwól na lokalizację w ustawieniach przeglądarki lub podaj adres ręcznie.',
          2: 'Nie udało się ustalić pozycji (brak sygnału). Podaj adres ręcznie.',
          3: 'Przekroczono czas oczekiwania na pozycję GPS. Spróbuj ponownie lub podaj adres.',
        }
        setError(map[err.code] ?? `Błąd geolokalizacji: ${err.message}`)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const findAddress = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNote(null)
    setCandidates([])
    if (!city.trim()) {
      setError('Podaj co najmniej miejscowość.')
      return
    }
    setGeoBusy(true)
    try {
      const out = await geocode({ street, houseNumber, postalCode, city })
      setNote(out.note)
      if (!out.candidates.length) {
        setError(
          out.note ??
            'Nie znaleziono adresu w oficjalnej usłudze GUGiK. Użyj lokalizacji GPS na działce.',
        )
        return
      }
      if (out.candidates.length === 1) {
        pick(out.candidates[0])
      } else {
        setCandidates(out.candidates)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGeoBusy(false)
    }
  }

  const pick = (c: GeocodeCandidate) => {
    onSubmit(
      {
        lat: c.lat,
        lon: c.lon,
        method: 'address',
        label: `${c.formatted} — ${c.label} [${c.provider}]`,
        accuracyM: c.accuracyM,
      },
      design(),
    )
  }

  const disabled = busy || gpsBusy || geoBusy

  return (
    <section className="card no-print">
      <h2>1. Lokalizacja inwestycji</h2>
      <p className="hint">
        Wskaż punkt planowanego otworu. GPS na działce daje najdokładniejszy wynik — geokodowanie
        adresu jest zawsze obarczone niepewnością i zostanie to odnotowane w raporcie.
      </p>

      <div className="row">
        <button className="btn gps" onClick={useGps} disabled={disabled} type="button">
          {gpsBusy && <span className="spinner" />}
          {gpsBusy ? 'Ustalanie pozycji…' : '📍 Użyj mojej lokalizacji GPS'}
        </button>
        <span style={{ color: 'var(--text-mute)', fontSize: 12.5 }}>
          wymaga zgody przeglądarki
        </span>
      </div>

      <div className="sep">albo podaj adres</div>

      <form onSubmit={findAddress}>
        <div className="grid c3">
          <div>
            <label htmlFor="street">Ulica</label>
            <input
              id="street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="np. Marszałkowska"
              autoComplete="address-line1"
            />
          </div>
          <div>
            <label htmlFor="hn">Nr domu / działki</label>
            <input
              id="hn"
              value={houseNumber}
              onChange={(e) => setHouseNumber(e.target.value)}
              placeholder="np. 12A"
            />
          </div>
          <div>
            <label htmlFor="zip">Kod pocztowy</label>
            <input
              id="zip"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="00-000"
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </div>
        </div>

        <div className="grid c2" style={{ marginTop: 14 }}>
          <div>
            <label htmlFor="city">Miejscowość *</label>
            <input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="np. Warszawa"
              autoComplete="address-level2"
              required
            />
          </div>
          <div>
            <label htmlFor="depth">Docelowa głębokość otworu [m p.p.t.]</label>
            <input
              id="depth"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              inputMode="numeric"
              placeholder="100"
            />
          </div>
        </div>

        <div className="sep">dobór dolnego źródła — opcjonalnie</div>

        <div className="grid c2">
          <div>
            <label htmlFor="power">Moc grzewcza pompy ciepła [kW]</label>
            <input
              id="power"
              value={power}
              onChange={(e) => setPower(e.target.value)}
              inputMode="decimal"
              placeholder="np. 12"
            />
          </div>
          <div>
            <label htmlFor="hours">Roczny czas pracy sprężarki</label>
            <select
              id="hours"
              value={hours}
              onChange={(e) => setHours(e.target.value === '2100' ? '2100' : '1800')}
            >
              <option value="1800">1800 h — samo ogrzewanie</option>
              <option value="2100">2100 h — ogrzewanie + c.w.u.</option>
            </select>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          Podanie mocy włącza wstępny dobór łącznej długości odwiertów na podstawie jednostkowej
          wydajności termicznej q<sub>v</sub> z Mapy Potencjału Geotermii Niskotemperaturowej
          PIG-PIB. Bez mocy raport ograniczy się do samych parametrów gruntu.
        </p>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" type="submit" disabled={disabled}>
            {geoBusy && <span className="spinner" />}
            {geoBusy ? 'Szukam adresu…' : 'Znajdź adres i analizuj'}
          </button>
        </div>
      </form>

      {error && <div className="notice err">{error}</div>}
      {note && !error && <div className="notice warn">{note}</div>}

      {candidates.length > 0 && (
        <div className="notice info" style={{ marginTop: 14 }}>
          <strong>Znaleziono {candidates.length} pasujących lokalizacji — wybierz właściwą:</strong>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {candidates.map((c, i) => (
              <button
                key={i}
                type="button"
                className="btn ghost"
                style={{ textAlign: 'left', fontWeight: 500 }}
                onClick={() => pick(c)}
                disabled={disabled}
              >
                {c.formatted}
                <br />
                <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
                  {c.lat.toFixed(5)}, {c.lon.toFixed(5)} — {c.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
