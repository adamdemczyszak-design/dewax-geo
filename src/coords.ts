/**
 * Parser wspolrzednych: stopnie dziesietne albo zapis stopniowy DMS.
 * Wiertacz przepisuje punkt z nawigacji, z Google Maps albo z projektu -
 * kazde z tych zrodel zapisuje go inaczej.
 */
export function parseCoords(input: string): { lat: number; lon: number } | null {
  const s = input.trim().replace(/\s+/g, ' ')
  if (!s) return null

  const dms = /(\d+)[°º:\s]+(\d+)['′:\s]+([\d.,]+)?["″]?\s*([NSEWnsewPpZzWw])/g
  const found: Array<{ value: number; hemi: string }> = []
  let m: RegExpExecArray | null
  while ((m = dms.exec(s)) !== null) {
    const deg = Number(m[1])
    const min = Number(m[2])
    const sec = Number((m[3] ?? '0').replace(',', '.'))
    if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) continue
    found.push({ value: deg + min / 60 + sec / 3600, hemi: m[4].toUpperCase() })
  }
  if (found.length === 2) {
    const signed = found.map((f) =>
      f.hemi === 'S' || f.hemi === 'W' ? -f.value : f.value,
    )
    // N/S jest szerokoscia niezaleznie od kolejnosci wpisania.
    const latIdx = found.findIndex((f) => f.hemi === 'N' || f.hemi === 'S')
    const lat = latIdx >= 0 ? signed[latIdx] : signed[0]
    const lon = latIdx >= 0 ? signed[1 - latIdx] : signed[1]
    return inPoland(lat, lon) ? { lat, lon } : null
  }

  // Para liczb ulamkowych. Przecinek bywa i separatorem dziesietnym
  // ("52,186349 21,543556" - tak kopiuje sie z polskich narzedzi), i
  // separatorem pary ("52.186349, 21.543556"). Dopasowanie pary naraz
  // rozstrzyga te dwuznacznosc bez zgadywania.
  const pair = /(-?\d{1,3}[.,]\d+)\s*[;,\s]\s*(-?\d{1,3}[.,]\d+)/.exec(s)
  if (pair) {
    const lat = Number(pair[1].replace(',', '.'))
    const lon = Number(pair[2].replace(',', '.'))
    if (Number.isFinite(lat) && Number.isFinite(lon) && inPoland(lat, lon)) return { lat, lon }
    return null
  }

  const nums = s
    .replace(/[^\d.;\s-]/g, ' ')
    .split(/[;\s]+/)
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n))
  if (nums.length >= 2) {
    const [lat, lon] = nums
    return inPoland(lat, lon) ? { lat, lon } : null
  }
  return null
}

/** Odrzucamy zamienione miejscami wspolrzedne - w Polsce lat > lon zawsze. */
function inPoland(lat: number, lon: number): boolean {
  return lat >= 48.9 && lat <= 55.0 && lon >= 13.9 && lon <= 24.2
}
