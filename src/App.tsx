import { useState } from 'react'
import LocationForm, { type DesignInput, type LocationPick } from './components/LocationForm'
import Report from './components/Report'
import { analyze } from './api'
import type { GshpReport } from '../server/types'

export default function App() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<GshpReport | null>(null)

  const run = async (pick: LocationPick, design: DesignInput) => {
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const r = await analyze({
        lat: pick.lat,
        lon: pick.lon,
        targetDepthM: design.targetDepthM,
        method: pick.method,
        matchLevel: pick.matchLevel,
        locationLabel: pick.label,
        accuracyM: pick.accuracyM,
        heatPumpKw: design.heatPumpKw,
        annualHours: design.annualHours,
      })
      setReport(r)
      queueMicrotask(() =>
        document.getElementById('wynik')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dewax-geo_${report.location.lat.toFixed(5)}_${report.location.lon.toFixed(5)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="logo">dg</div>
        <div>
          <h1>dewax geo — Asystent Wiertacza GSHP</h1>
          <p className="sub">
            Raport geologiczny dolnego źródła pompy ciepła na podstawie oficjalnych danych CBDG
            PGI-PIB
          </p>
        </div>
        <div className="spacer" />
        <span className="badge-src no-print">źródło danych: PGI-PIB / CBDG</span>
      </header>

      <div className="notice info no-print" style={{ marginTop: 18 }}>
        <strong>Zasada działania:</strong> aplikacja pokazuje wyłącznie to, co znajduje się w bazach
        PGI-PIB. Jeżeli w sprawdzonym zakresie nie ma danych, raport pokaże{' '}
        <em>„brak danych w sprawdzonym zakresie”</em> — nigdy nie uzupełni profilu domysłem. Raport
        nie zastępuje projektu robót geologicznych ani rozpoznania własnego.
      </div>

      <LocationForm busy={busy} onSubmit={run} />

      {busy && (
        <section className="card">
          <h2>Analiza w toku</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            <span className="spinner" />
            Odpytuję usługi PGI-PIB i rozszerzam promień wyszukiwania (200 → 500 → 1000 → 2000 →
            5000 m). Pobieranie profili litologicznych może potrwać kilkanaście sekund.
          </p>
        </section>
      )}

      {error && (
        <section className="card">
          <h2>Błąd analizy</h2>
          <div className="notice err">{error}</div>
        </section>
      )}

      <div id="wynik">
        {report && (
          <>
            <div className="row no-print" style={{ marginTop: 18 }}>
              <button className="btn" onClick={() => window.print()} type="button">
                🖨 Drukuj / zapisz PDF
              </button>
              <button className="btn" onClick={download} type="button">
                ⤓ Pobierz dane raportu (JSON)
              </button>
            </div>
            <Report report={report} />
          </>
        )}
      </div>

      <footer className="foot">
        <strong>dewax geo</strong> · Dane geologiczne: Centralna Baza Danych Geologicznych,
        Państwowy Instytut Geologiczny — Państwowy Instytut Badawczy (PIG-PIB). Geokodowanie adresów:
        Główny Urząd Geodezji i Kartografii (GUGiK). Aplikacja nie korzysta z żadnych innych źródeł
        danych geologicznych.
        <br />
        Raport ma charakter informacyjny i nie zastępuje projektu robót geologicznych, dokumentacji
        hydrogeologicznej ani testu reakcji termicznej (TRT).
      </footer>
    </div>
  )
}
