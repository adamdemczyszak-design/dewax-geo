import type { SyntheticLayer } from '../../server/types'
import { lithoColor } from '../lithoColor'

interface Props {
  layers: SyntheticLayer[]
  targetDepthM: number
}

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')

export default function ProfileColumn({ layers, targetDepthM }: Props) {
  if (!layers.length) return null
  const HEIGHT = Math.max(420, Math.min(900, targetDepthM * 5))

  return (
    <div className="profile-wrap">
      <div className="profile-col" style={{ height: HEIGHT }} aria-hidden="true">
        {layers.map((l, i) => (
          <div
            key={i}
            className="profile-seg"
            style={{
              height: `${((l.toM - l.fromM) / targetDepthM) * 100}%`,
              background: lithoColor(l.description, l.noData),
            }}
            title={
              l.noData
                ? `${fmt(l.fromM)}–${fmt(l.toM)} m: brak danych`
                : `${fmt(l.fromM)}–${fmt(l.toM)} m: ${l.description}`
            }
          />
        ))}
      </div>

      <div className="profile-legend">
        {layers.map((l, i) => (
          <div className="pl-row" key={i}>
            <div className="pl-depth">
              {fmt(l.fromM)}–{fmt(l.toM)} m
            </div>
            <div>
              {l.noData ? (
                <div className="pl-desc pl-nodata">BRAK DANYCH W SPRAWDZONYM ZAKRESIE</div>
              ) : (
                <>
                  <div className="pl-desc">{l.description}</div>
                  <div className="pl-meta">
                    {l.chronostratigraphy ? `${l.chronostratigraphy} · ` : ''}
                    Otwór CBDG ID {l.evidence?.cbdgId} „{l.evidence?.boreholeName}” ·{' '}
                    {l.evidence?.distanceM} m
                    {l.evidence?.locationUncertaintyM !== undefined &&
                      l.evidence.locationUncertaintyM >= 1000 && (
                        <span style={{ color: 'var(--danger)' }}> (±~1 km!)</span>
                      )}{' '}
                    ·{' '}
                    <a href={l.evidence?.sourceUrl} target="_blank" rel="noreferrer">
                      źródło CBDG
                    </a>
                  </div>
                  {!!l.evidence?.elevationShiftM && (
                    <div className="pl-meta">
                      w otworze: {fmt(l.evidence.sourceFromM ?? 0)}–{fmt(l.evidence.sourceToM ?? 0)} m
                      p.p.t. · korekta wysokościowa {l.evidence.elevationShiftM > 0 ? '+' : ''}
                      {fmt(l.evidence.elevationShiftM)} m
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
