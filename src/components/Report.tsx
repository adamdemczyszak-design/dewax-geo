import type { GshpReport } from '../../server/types'
import ProfileColumn from './ProfileColumn'
import SiteMap from './SiteMap'

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : Number.isInteger(n)
      ? String(n)
      : n.toFixed(1).replace('.', ',')

/** Etykiety wyświetlane zamiast technicznych wartości pól. */
const SEVERITY_PL: Record<string, string> = {
  wysokie: 'wysokie',
  srednie: 'średnie',
  informacyjne: 'informacyjne',
}

const DECISION_PL: Record<string, string> = {
  wystarczajace: 'dane wystarczające',
  'rozszerz-promien': 'rozszerz promień',
  'wyczerpano-promienie': 'wyczerpano promienie',
}

export default function Report({ report }: { report: GshpReport }) {
  const v = report.verification
  const c = report.credibility
  const es = report.evidenceSummary
  const gaps = report.syntheticProfile.filter((l) => l.noData)

  return (
    <>
      {/* ---------- 1. Weryfikacja PGI ---------- */}
      <section className="card">
        <h2>2. Podsumowanie weryfikacji PGI</h2>
        <p className="hint">
          Wykaz usług PGI-PIB odpytanych na potrzeby tego raportu wraz z wynikiem. Dane geologiczne
          nie pochodzą z żadnego innego źródła.
        </p>

        <div
          className={`notice ${
            c.grade === 'wysoka' ? 'ok' : c.grade === 'umiarkowana' ? 'warn' : 'err'
          }`}
          style={{ marginTop: 0, marginBottom: 16 }}
        >
          <div style={{ fontSize: 17, fontWeight: 680, marginBottom: 4 }}>
            Wiarygodność raportu: {c.grade.toUpperCase()} ({c.score}/100)
          </div>
          <div style={{ marginBottom: c.reasons.length ? 8 : 0 }}>{c.headline}</div>
          {c.reasons.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
              {c.reasons.map((r, i) => (
                <li key={i} style={{ marginBottom: 3 }}>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="stats">
          <Stat v={`${v.boreholesFound}`} k="otworów CBDG w promieniu" />
          <Stat v={`${v.boreholesWithLithology}`} k="z profilem litologicznym" />
          <Stat v={`${v.finalRadiusM} m`} k="promień końcowy" />
          <Stat
            v={`${v.profileCoveragePct}%`}
            k={`pokrycia 0–${v.targetDepthM} m`}
            tone={v.profileCoveragePct >= 99 ? 'good' : v.profileCoveragePct >= 50 ? 'warn' : 'bad'}
          />
          <Stat
            v={report.siteElevationM !== null ? `${fmt(report.siteElevationM)} m` : '—'}
            k="rzędna terenu n.p.m."
            tone={report.siteElevationM !== null ? 'good' : 'bad'}
          />
        </div>

        <div className="notice" style={{ marginTop: 16 }}>
          <strong>Punkt analizy:</strong>{' '}
          <span className="num">
            {report.location.lat.toFixed(6)}, {report.location.lon.toFixed(6)}
          </span>{' '}
          — {report.location.label}
          {report.location.accuracyM !== null && (
            <> · niepewność pozycji ±{report.location.accuracyM} m</>
          )}
          <br />
          <strong>Sprawdzone promienie:</strong>{' '}
          <span className="num">{v.radiiChecked.join(' → ')} m</span>
          <br />
          <strong>Raport wygenerowano:</strong>{' '}
          {new Date(report.generatedAt).toLocaleString('pl-PL')}
        </div>

        {(v.transferLimitReached || v.detailLimitReached || v.timeBudgetExceeded) && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            <strong>Ograniczenia tej analizy:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {v.transferLimitReached && (
                <li>
                  Usługa CBDG zwróciła maksymalną liczbę 1000 rekordów — w promieniu{' '}
                  {v.finalRadiusM} m może znajdować się więcej otworów.
                </li>
              )}
              {v.detailLimitReached && (
                <li>
                  Wyczerpano limit otworów pobieranych szczegółowo. Profile pobrano dla{' '}
                  {v.boreholesWithLithology + (v.boreholesListed - v.boreholesWithLithology)} otworów
                  wg priorytetu: najbliższe, następnie sięgające {v.targetDepthM} m.
                </li>
              )}
              {v.timeBudgetExceeded && (
                <li>
                  Przerwano pobieranie profili po przekroczeniu budżetu czasu. Braków nie
                  uzupełniono — pozostały oznaczone jako brak danych.
                </li>
              )}
            </ul>
          </div>
        )}

        {!v.dataSufficient && (
          <div className="notice err" style={{ marginTop: 12 }}>
            <strong>Profil niepełny.</strong> Dane CBDG nie pokrywają całego zakresu 0–
            {v.targetDepthM} m p.p.t. nawet po rozszerzeniu poszukiwań do{' '}
            {v.finalRadiusM} m. Braków nie uzupełniono szacunkami — luki są oznaczone jawnie.
            Do projektu dolnego źródła wymagane jest rozpoznanie własne (otwór pilotażowy / TRT).
          </div>
        )}

        <div className="scroll" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Usługa PGI-PIB</th>
                <th>Status</th>
                <th>Wynik</th>
                <th>Adres</th>
              </tr>
            </thead>
            <tbody>
              {v.checkedEndpoints.map((e, i) => (
                <tr key={i}>
                  <td>{e.name}</td>
                  <td>
                    <span
                      className={`chip ${
                        e.status === 'ok' ? 'informacyjne' : e.status === 'blad' ? 'wysokie' : 'srednie'
                      }`}
                      style={{ marginLeft: 0 }}
                    >
                      {e.status === 'ok' ? 'OK' : e.status === 'blad' ? 'BŁĄD' : 'BRAK DANYCH'}
                    </span>
                  </td>
                  <td>{e.detail}</td>
                  <td style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {e.url}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Mapa sytuacyjna ---------- */}
      <section className="card">
        <h2>3. Mapa sytuacyjna</h2>
        <p className="hint">
          Rozmieszczenie otworów CBDG i punktów monitoringu wód względem punktu inwestycji.
          Przełącz podkład na ortofotomapę GUGiK, aby sprawdzić, czy punkt trafił we właściwą
          działkę. Podkład mapowy nie jest źródłem danych geologicznych.
        </p>
        <SiteMap report={report} />
      </section>

      {/* ---------- Parametry dolnego źródła ---------- */}
      <section className="card">
        <h2>4. Parametry dolnego źródła (MPGN)</h2>
        <p className="hint">
          Przewodność termiczna gruntu λ i jednostkowa wydajność termiczna otworu q<sub>v</sub> z
          Mapy Potencjału Geotermii Niskotemperaturowej PIG-PIB — jedynego oficjalnego źródła
          parametrów projektowych dla geotermii płytkiej.
        </p>

        {!report.mpgn || report.thermalStatements.length === 0 ? (
          <div className="notice err">
            Punkt inwestycji poza zasięgiem arkuszy MPGN — brak parametrów termicznych gruntu.
          </div>
        ) : (
          <>
            <div className="stats">
              <Stat
                v={report.mpgn.lambdaWmK ? report.mpgn.lambdaWmK.label : '—'}
                k={`λ [W/(m·K)] 0–${report.mpgn.bracketDepthM} m`}
                tone={report.mpgn.lambdaWmK ? 'good' : 'bad'}
              />
              <Stat
                v={report.mpgn.qv1800Wm ? report.mpgn.qv1800Wm.label : '—'}
                k="qᵥ [W/m] · 1800 h/rok"
                tone={report.mpgn.qv1800Wm ? 'good' : 'bad'}
              />
              <Stat
                v={report.mpgn.qv2100Wm ? report.mpgn.qv2100Wm.label : '—'}
                k="qᵥ [W/m] · 2100 h/rok"
                tone={report.mpgn.qv2100Wm ? 'good' : 'bad'}
              />
            </div>
            <ul style={{ margin: '14px 0 0', paddingLeft: 20, fontSize: 13.5 }}>
              {report.thermalStatements.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {s}
                </li>
              ))}
            </ul>
          </>
        )}

        {report.sizing ? (
          <>
            <div className="notice ok" style={{ marginTop: 18 }}>
              <div style={{ fontSize: 17, fontWeight: 680, marginBottom: 6 }}>
                Wstępny dobór: {report.sizing.totalMetresRange.min}–
                {report.sizing.totalMetresRange.max} m odwiertów
              </div>
              <div>
                tj.{' '}
                {report.sizing.boreholeCountRange.min === report.sizing.boreholeCountRange.max
                  ? `${report.sizing.boreholeCountRange.min}`
                  : `${report.sizing.boreholeCountRange.min}–${report.sizing.boreholeCountRange.max}`}{' '}
                × {report.sizing.singleBoreholeDepthM} m dla pompy {fmt(report.sizing.heatPumpKw)} kW
                (moc pobierana z gruntu {fmt(report.sizing.groundLoadKw)} kW).
              </div>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13.5 }}>
                Założenia i ograniczenia doboru
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
                {report.sizing.assumptions.map((a, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>
                    {a}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <div className="notice info" style={{ marginTop: 16 }}>
            Podaj moc grzewczą pompy ciepła w formularzu, aby otrzymać wstępny dobór łącznej
            długości odwiertów.
          </div>
        )}
      </section>

      {/* ---------- Otwory ---------- */}
      <section className="card">
        <h2>5. Analizowane otwory CBDG</h2>
        <p className="hint">
          {v.boreholesListed < v.boreholesFound
            ? `Wypisano ${v.boreholesListed} z ${v.boreholesFound} otworów znalezionych w promieniu ${v.finalRadiusM} m — najbliższe punktowi inwestycji.`
            : 'Otwory znalezione w promieniu wyszukiwania, posortowane wg odległości od punktu inwestycji.'}
        </p>
        {report.boreholes.length === 0 ? (
          <div className="notice err">
            Brak otworów wiertniczych CBDG w sprawdzonym zakresie (do {v.finalRadiusM} m).
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>ID CBDG</th>
                  <th>Nazwa</th>
                  <th>Odl. [m]</th>
                  <th>Głęb. [m]</th>
                  <th>Rzędna [m n.p.m.]</th>
                  <th>Rok</th>
                  <th>Cel wiercenia</th>
                  <th>Profil litologiczny</th>
                  <th>Lokalizacja wg CBDG</th>
                </tr>
              </thead>
              <tbody>
                {report.boreholes.map((b) => (
                  <tr key={b.cbdgId}>
                    <td className="num">
                      <a
                        href={`https://otworywiertnicze.pgi.gov.pl/details/${b.cbdgId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {b.cbdgId}
                      </a>
                    </td>
                    <td>{b.name}</td>
                    <td className="num">
                      {b.distanceM}
                      {b.locationQuality.cls === 'przybliżona' && (
                        <div
                          className="pl-meta"
                          style={{ color: 'var(--danger)' }}
                          title={b.locationQuality.note}
                        >
                          ±~1 km
                        </div>
                      )}
                      {b.locationQuality.cls === 'nieznana' && (
                        <div className="pl-meta" title={b.locationQuality.note}>
                          ±?
                        </div>
                      )}
                    </td>
                    <td className="num">{fmt(b.finalDepthM)}</td>
                    <td className="num">{fmt(b.elevationM)}</td>
                    <td className="num">{b.drillingYear ?? '—'}</td>
                    <td>{b.drillingPurpose ?? '—'}</td>
                    <td>
                      {b.lithology.length ? (
                        <span style={{ color: 'var(--ok)' }}>
                          {b.lithology.length} warstw, do {fmt(b.lithologyMaxDepthM)} m
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-mute)' }}>
                          brak danych{b.notes[0] ? ` — ${b.notes[0]}` : ''}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {[b.locality, b.commune, b.county].filter(Boolean).join(', ') || '—'}
                      {b.locationBasis && (
                        <div className="pl-meta">
                          podstawa lokalizacji: {b.locationBasis} → jakość:{' '}
                          <strong
                            style={{
                              color:
                                b.locationQuality.cls === 'przybliżona'
                                  ? 'var(--danger)'
                                  : b.locationQuality.cls === 'geodezyjna'
                                    ? 'var(--ok)'
                                    : 'var(--text-dim)',
                            }}
                          >
                            {b.locationQuality.cls}
                          </strong>{' '}
                          (±{b.locationQuality.uncertaintyM} m)
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- 3. Profil syntetyczny ---------- */}
      <section className="card">
        <h2>6. Syntetyczny profil gruntu 0–{report.targetDepthM} m p.p.t.</h2>
        <p className="hint">
          Każdy przedział pochodzi z najbliższego otworu CBDG, który faktycznie posiada opis na tej
          głębokości. Nic nie jest interpolowane ani ekstrapolowane.
          {report.siteElevationM !== null ? (
            <>
              {' '}
              Głębokości <strong>przeliczono na rzędną działki</strong> ({fmt(report.siteElevationM)}{' '}
              m n.p.m., {report.siteElevationSource}) — warstwy z otworów stojących na innej
              wysokości są przesunięte o różnicę rzędnych.
            </>
          ) : (
            <>
              {' '}
              <strong style={{ color: 'var(--danger)' }}>
                Nie ustalono rzędnej działki — profil bez korekty wysokościowej.
              </strong>{' '}
              Głębokości odnoszą się do terenu przy otworze źródłowym, nie przy inwestycji.
            </>
          )}
        </p>

        {gaps.length > 0 && (
          <div className="notice err" style={{ marginBottom: 16 }}>
            <strong>Luki w profilu ({gaps.length}):</strong>{' '}
            {gaps.map((g) => `${fmt(g.fromM)}–${fmt(g.toM)} m`).join(', ')} — brak danych w
            sprawdzonym zakresie.
          </div>
        )}

        <ProfileColumn layers={report.syntheticProfile} targetDepthM={report.targetDepthM} />
      </section>

      {/* ---------- 4. Hydrogeologia ---------- */}
      <section className="card">
        <h2>7. Warunki hydrogeologiczne</h2>
        <p className="hint">
          Źródła: monitoring wód podziemnych PSH, obiekty CBDH, warstwy GZWP/LZWP i JCWPd — wszystkie
          w serwisach PGI-PIB.
        </p>

        {report.hydrogeology.noDataNote && (
          <div className="notice err">{report.hydrogeology.noDataNote}</div>
        )}

        <ul style={{ margin: '0 0 16px', paddingLeft: 20, fontSize: 14 }}>
          {report.hydrogeology.statements.map((s, i) => (
            <li key={i} style={{ marginBottom: 5 }}>
              {s}
            </li>
          ))}
        </ul>

        {report.hydrogeology.groundwaterPoints.length > 0 && (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Punkt PSH</th>
                  <th>Odl. [m]</th>
                  <th>Zw. nawiercone [m]</th>
                  <th>Zw. ustalone [m]</th>
                  <th>Ostatni pomiar [m]</th>
                  <th>Warstwa wod. strop–spąg</th>
                  <th>Litologia</th>
                  <th>Stratygrafia</th>
                </tr>
              </thead>
              <tbody>
                {report.hydrogeology.groundwaterPoints.slice(0, 15).map((g, i) => (
                  <tr key={i}>
                    <td>{g.name ?? g.id ?? '—'}</td>
                    <td className="num">{g.distanceM}</td>
                    <td className="num">{fmt(g.drilledLevelM)}</td>
                    <td className="num">{fmt(g.stabilisedLevelM)}</td>
                    <td className="num">
                      {fmt(g.measuredLevelM)}
                      {g.measurementDate && (
                        <div className="pl-meta">{g.measurementDate.slice(0, 10)}</div>
                      )}
                    </td>
                    <td className="num">
                      {fmt(g.aquiferTopM)}–{fmt(g.aquiferBottomM)}
                    </td>
                    <td>{g.lithology ?? '—'}</td>
                    <td>{g.chronostratigraphy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- 5. Ryzyka ---------- */}
      <section className="card">
        <h2>8. Ryzyka wiertnicze</h2>
        <p className="hint">
          Wykrywane na podstawie słów kluczowych w oryginalnych opisach litologicznych CBDG oraz
          pomiarów zwierciadła wody PSH. Każde trafienie ma wskazany otwór, głębokość i źródło.
        </p>

        {report.risks.length === 0 ? (
          <div className="notice ok">
            W dostępnych danych CBDG nie znaleziono przesłanek dla żadnej z {report.risksNotFound.length}{' '}
            sprawdzanych kategorii ryzyka. <strong>Brak dowodu nie oznacza braku zagrożenia</strong> —
            przy niepełnym pokryciu profilu wynik ma ograniczoną wartość.
          </div>
        ) : (
          report.risks.map((r) => (
            <div className={`risk ${r.severity}`} key={r.code}>
              <h4>
                {r.label}
                <span className={`chip ${r.severity}`}>{SEVERITY_PL[r.severity] ?? r.severity}</span>
              </h4>
              <p className="why">{r.rationale}</p>
              <ul>
                {r.matches.slice(0, 10).map((m, i) => (
                  <li key={i}>
                    <strong className="num">
                      {fmt(m.evidence.fromM)}–{fmt(m.evidence.toM)} m
                    </strong>{' '}
                    „{m.matchedText}” — otwór ID CBDG {m.evidence.cbdgId} „{m.evidence.boreholeName}
                    ”, {m.evidence.distanceM} m od punktu ·{' '}
                    <a href={m.evidence.sourceUrl} target="_blank" rel="noreferrer">
                      źródło
                    </a>{' '}
                    <span style={{ color: 'var(--text-mute)' }}>[słowo kluczowe: {m.keyword}]</span>
                  </li>
                ))}
                {r.matches.length > 10 && (
                  <li style={{ color: 'var(--text-mute)' }}>
                    …oraz {r.matches.length - 10} dalszych trafień (pełna lista w pliku JSON).
                  </li>
                )}
              </ul>
            </div>
          ))
        )}

        {report.risksNotFound.length > 0 && (
          <>
            <p className="hint" style={{ marginTop: 16, marginBottom: 8 }}>
              Kategorie sprawdzone i <strong>niepotwierdzone</strong> w dostępnych danych:
            </p>
            <div className="tag-list">
              {report.risksNotFound.map((r) => (
                <span className="tag" key={r.code}>
                  {r.label}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---------- 6. Dowody ---------- */}
      <section className="card">
        <h2>9. Podsumowanie dowodowe</h2>
        <div className="stats">
          <Stat v={`${es.totalLayers}`} k="warstw w profilu" />
          <Stat v={`${es.layersWithEvidence}`} k="warstw z dowodem" tone="good" />
          <Stat
            v={`${es.layersWithoutData}`}
            k="warstw bez danych"
            tone={es.layersWithoutData ? 'bad' : 'good'}
          />
          <Stat v={`${es.distinctBoreholesUsed}`} k="otworów użytych" />
          <Stat v={es.nearestBoreholeM !== null ? `${es.nearestBoreholeM} m` : '—'} k="najbliższy dowód" />
          <Stat
            v={es.farthestUsedBoreholeM !== null ? `${es.farthestUsedBoreholeM} m` : '—'}
            k="najdalszy dowód"
          />
        </div>

        <p className="hint" style={{ marginTop: 16, marginBottom: 8 }}>
          Punkty dostępowe, z których faktycznie pobrano dane do tego raportu:
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5 }}>
          {es.endpointsUsed.map((e) => (
            <li key={e.sourceId} style={{ marginBottom: 4 }}>
              <strong>{e.name}</strong>
              <br />
              <a href={e.url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
                {e.url}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- 7. OODA + audyt ---------- */}
      <section className="card">
        <h2>10. Przebieg analizy (pętla OODA) i dziennik audytu</h2>
        <p className="hint">
          Pełny zapis decyzji o rozszerzaniu promienia oraz każdego odpytania usług PGI.
        </p>

        {report.ooda.map((c) => (
          <div className={`ooda-step ${c.decision}`} key={c.cycle}>
            <h4>
              Cykl {c.cycle} — promień {c.radiusM} m → {DECISION_PL[c.decision] ?? c.decision}
            </h4>
            <p>
              Otwory: {c.observedBoreholes} (z litologią: {c.boreholesWithLithology}), najgłębszy
              profil: {fmt(c.maxLithologyDepthM)} m, pokrycie: {c.coveragePct}%.
              <br />
              {c.reason}
            </p>
          </div>
        ))}

        <details className="audit" style={{ marginTop: 14 }}>
          <summary>Dziennik audytu ({report.audit.length} wpisów)</summary>
          <div className="audit-log">
            {report.audit.map((a, i) => (
              <div className="ln" key={i}>
                <span className="t">{a.ts.slice(11, 19)}</span>
                <span className="s">{a.stage}</span>
                <span className="m">
                  {a.message}
                  {a.radiusM !== undefined && ` · r=${a.radiusM} m`}
                  {a.found !== undefined && ` · n=${a.found}`}
                  {a.cache && ` · cache:${a.cache}`}
                  {a.httpStatus !== undefined && ` · HTTP ${a.httpStatus}`}
                  {a.durationMs !== undefined && ` · ${a.durationMs} ms`}
                  {a.endpoint && (
                    <>
                      <br />
                      <span style={{ color: '#4a5563' }}>{a.endpoint}</span>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </details>
      </section>
    </>
  )
}

function Stat({ v, k, tone }: { v: string; k: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  )
}
