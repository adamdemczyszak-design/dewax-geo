import { useState } from 'react'
import { geocode } from '../api'
import PickMap from './PickMap'
import Autocomplete from './Autocomplete'
import { parseCoords } from '../coords'
import type { GeocodeCandidate } from '../../server/geocoder'

export interface LocationPick {
  lat: number
  lon: number
  method: 'gps' | 'address' | 'map' | 'parcel'
  label: string
  accuracyM: number | null
  matchLevel?: 'address' | 'street' | 'city' | 'gps' | 'parcel' | 'map'
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

type Mode = 'address' | 'parcel' | 'coords'

/** Punkt czekajacy na potwierdzenie na mapie - jeszcze NIE uruchomil analizy. */
interface Staged extends LocationPick {
  outline?: Array<[number, number]> | null
}

export default function LocationForm({ busy, onSubmit }: Props) {
  const [mode, setMode] = useState<Mode>('address')

  const [street, setStreet] = useState('')
  const [houseNumber, setHouseNumber] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  // Punkt wybranej z listy miejscowosci. Sluzy WYLACZNIE do zawezenia
  // podpowiedzi ulic do jej okolicy - nie jest zrodlem wspolrzednych otworu.
  const [cityHint, setCityHint] = useState<{ lat: number; lon: number } | null>(null)
  const [parcelId, setParcelId] = useState('')
  const [coords, setCoords] = useState('')

  const [depth, setDepth] = useState('100')
  const [power, setPower] = useState('')
  const [hours, setHours] = useState<'1800' | '2100'>('1800')

  const [gpsBusy, setGpsBusy] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([])
  const [staged, setStaged] = useState<Staged | null>(null)

  const design = (): DesignInput => {
    const d = Number(depth)
    const p = Number(power.replace(',', '.'))
    return {
      targetDepthM: Number.isFinite(d) ? Math.min(500, Math.max(10, Math.round(d))) : 100,
      heatPumpKw: Number.isFinite(p) && p > 0 ? p : null,
      annualHours: hours === '2100' ? 2100 : 1800,
    }
  }

  const reset = () => {
    setError(null)
    setNote(null)
    setCandidates([])
    setStaged(null)
  }

  const useGps = () => {
    reset()
    if (!('geolocation' in navigator)) {
      setError('Ta przeglądarka nie udostępnia lokalizacji GPS (navigator.geolocation).')
      return
    }
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false)
        const acc = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
        setStaged({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          method: 'gps',
          matchLevel: 'gps',
          label: `Lokalizacja GPS przeglądarki${acc !== null ? ` (dokładność ±${acc} m)` : ''}`,
          accuracyM: acc,
        })
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

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    reset()

    if (mode === 'coords') {
      const parsed = parseCoords(coords)
      if (!parsed) {
        setError(
          'Nie rozpoznano współrzędnych. Wpisz je jako „52.186349, 21.543556” ' +
            'albo „52°11\'10.9"N 21°32\'36.8"E”.',
        )
        return
      }
      setStaged({
        ...parsed,
        method: 'map',
        matchLevel: 'map',
        label: `Współrzędne podane ręcznie (${parsed.lat.toFixed(6)}, ${parsed.lon.toFixed(6)})`,
        accuracyM: 10,
      })
      return
    }

    if (mode === 'address' && !city.trim()) {
      setError('Podaj co najmniej miejscowość.')
      return
    }
    if (mode === 'parcel' && !parcelId.trim()) {
      setError('Podaj identyfikator działki ewidencyjnej.')
      return
    }

    setGeoBusy(true)
    try {
      const out =
        mode === 'parcel'
          ? await geocode({ parcelId })
          : await geocode({ street, houseNumber, postalCode, city })
      setNote(out.note)
      if (!out.candidates.length) {
        setError(out.note ?? 'Nie znaleziono lokalizacji dla podanych danych.')
        return
      }
      // Nawet jeden wynik trafia najpierw na mape. Automatyczne uruchomienie
      // analizy dla punktu oddalonego o kilometr bylo zrodlem falszywych raportow.
      if (out.candidates.length === 1) {
        stage(out.candidates[0])
      } else {
        setCandidates(out.candidates)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGeoBusy(false)
    }
  }

  const stage = (c: GeocodeCandidate) => {
    setCandidates([])
    setStaged({
      lat: c.lat,
      lon: c.lon,
      method: c.matchLevel === 'parcel' ? 'parcel' : 'address',
      matchLevel: c.matchLevel,
      label: `${c.formatted} — ${c.label} [${c.provider}]`,
      accuracyM: c.accuracyM,
      outline: c.outline ?? null,
    })
  }

  const confirm = (lat: number, lon: number, moved: boolean) => {
    if (!staged) return
    onSubmit(
      moved
        ? {
            lat,
            lon,
            method: 'map',
            matchLevel: 'map',
            label: `${staged.label} → punkt skorygowany ręcznie na mapie`,
            // Punkt wskazany na ortofotomapie jest dokladniejszy niz wynik
            // geokodera, ale nie udajemy pomiaru geodezyjnego.
            accuracyM: 10,
          }
        : { lat, lon, method: staged.method, matchLevel: staged.matchLevel, label: staged.label, accuracyM: staged.accuracyM },
      design(),
    )
  }

  const disabled = busy || gpsBusy || geoBusy

  return (
    <section className="card no-print">
      <h2>1. Lokalizacja inwestycji</h2>
      <p className="hint">
        Wskaż punkt planowanego otworu. Wynik wyszukiwania zawsze pokazujemy najpierw na mapie —
        możesz go poprawić, zanim uruchomisz analizę. GPS na działce lub wskazanie punktu na
        ortofotomapie daje najdokładniejszy wynik.
      </p>

      <div className="row">
        <button className="btn gps" onClick={useGps} disabled={disabled} type="button">
          {gpsBusy && <span className="spinner" />}
          {gpsBusy ? 'Ustalanie pozycji…' : '📍 Użyj mojej lokalizacji GPS'}
        </button>
        <span style={{ color: 'var(--text-mute)', fontSize: 12.5 }}>wymaga zgody przeglądarki</span>
      </div>

      <div className="sep">albo wyszukaj</div>

      <div className="tabs">
        {(
          [
            ['address', 'Adres'],
            ['parcel', 'Numer działki'],
            ['coords', 'Współrzędne'],
          ] as Array<[Mode, string]>
        ).map(([m, labelText]) => (
          <button
            key={m}
            type="button"
            className={`tab${mode === m ? ' on' : ''}`}
            onClick={() => {
              setMode(m)
              reset()
            }}
            disabled={disabled}
          >
            {labelText}
          </button>
        ))}
      </div>

      <form onSubmit={search}>
        {mode === 'address' && (
          <>
            <div className="grid c3">
              <Autocomplete
                id="street"
                label="Ulica"
                kind="street"
                value={street}
                onChange={setStreet}
                near={cityHint}
                placeholder="np. Warszawska (puste dla wsi)"
                autoComplete="address-line1"
                disabled={disabled}
              />
              <div>
                <label htmlFor="hn">Nr domu / działki</label>
                <input
                  id="hn"
                  value={houseNumber}
                  onChange={(e) => setHouseNumber(e.target.value)}
                  placeholder="np. 10"
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
              <Autocomplete
                id="city"
                label="Miejscowość *"
                kind="city"
                value={city}
                onChange={(v) => {
                  setCity(v)
                  // Reczna zmiana nazwy uniewaznia punkt z wczesniejszego
                  // wyboru - inaczej ulice podpowiadalyby sie dla innej wsi.
                  setCityHint(null)
                }}
                onPick={(s) => setCityHint(s.hint ?? null)}
                placeholder="np. Wola Kiełpińska"
                autoComplete="address-level2"
                required
                disabled={disabled}
              />
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
            <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
              Dla wsi o zabudowie numerowanej zostaw ulicę pustą i podaj samą miejscowość z numerem
              — rejestr GUGiK zna takie adresy.
            </p>
          </>
        )}

        {mode === 'parcel' && (
          <div className="grid c2">
            <div>
              <label htmlFor="parcel">Identyfikator działki ewidencyjnej *</label>
              <input
                id="parcel"
                value={parcelId}
                onChange={(e) => setParcelId(e.target.value)}
                placeholder="np. 141201_1.0001.1867/2"
              />
            </div>
            <div>
              <label htmlFor="depth-p">Docelowa głębokość otworu [m p.p.t.]</label>
              <input
                id="depth-p"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                inputMode="numeric"
                placeholder="100"
              />
            </div>
            <p className="hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
              Numer znajdziesz w wypisie z ewidencji gruntów lub w księdze wieczystej. Działka
              niezabudowana zwykle nie ma adresu — ta droga jest wtedy jedyną pewną. Pokażemy jej
              granice na ortofotomapie.
            </p>
          </div>
        )}

        {mode === 'coords' && (
          <div className="grid c2">
            <div>
              <label htmlFor="coords">Współrzędne geograficzne *</label>
              <input
                id="coords"
                value={coords}
                onChange={(e) => setCoords(e.target.value)}
                placeholder="52.186349, 21.543556"
              />
            </div>
            <div>
              <label htmlFor="depth-c">Docelowa głębokość otworu [m p.p.t.]</label>
              <input
                id="depth-c"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                inputMode="numeric"
                placeholder="100"
              />
            </div>
            <p className="hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
              Przyjmujemy stopnie dziesiętne (52.186349, 21.543556) oraz zapis stopniowy
              (52°11'10.9"N 21°32'36.8"E). Kolejność: szerokość, potem długość.
            </p>
          </div>
        )}

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
            {geoBusy ? 'Szukam…' : mode === 'coords' ? 'Pokaż na mapie' : 'Znajdź i pokaż na mapie'}
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
                onClick={() => stage(c)}
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

      {staged && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>2. Potwierdź miejsce odwiertu</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            {staged.label}
          </p>
          <PickMap
            lat={staged.lat}
            lon={staged.lon}
            outline={staged.outline}
            accuracyM={staged.accuracyM}
            busy={busy}
            onConfirm={confirm}
          />
        </div>
      )}
    </section>
  )
}
