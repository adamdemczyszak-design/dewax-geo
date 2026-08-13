/**
 * Kolory kolumny profilu sluza WYLACZNIE celom prezentacyjnym.
 * Dobierane sa na podstawie slow kluczowych z oryginalnego opisu CBDG i nie
 * zmieniaja tresci danych. Brak dopasowania = kolor neutralny.
 */
const PALETTE: Array<[RegExp, string]> = [
  [/kurzawk|upłynn|uplynn/i, '#c2410c'],
  [/torf|namuł|namul|gytia|organiczn/i, '#4b3b2a'],
  [/nasyp|gruz|humus|gleba/i, '#6b6257'],
  [/ił|il\b|iły|ily|iłow|ilow/i, '#8b5a2b'],
  [/glin/i, '#a1743f'],
  [/pył|pyl|less/i, '#c2a878'],
  [/piask?o?wiec/i, '#b08a5a'],
  [/piask|piase/i, '#e0c068'],
  [/żwir|zwir|otoczak|głaz|glaz|bruk/i, '#9aa7b4'],
  [/wapie|margl|kred|dolomit/i, '#cfd8dc'],
  [/anhydryt|gips|sól|sol kamienn/i, '#e8e0f0'],
  [/granit|gnejs|bazalt|kwarcyt|łupek|lupek|porfir|amfibolit/i, '#5b6b7a'],
  [/węgiel|wegiel|torf brunatn/i, '#2b2b2b'],
]

export function lithoColor(description: string | null, noData: boolean): string {
  if (noData) return 'repeating-linear-gradient(45deg,#3a1f1f 0 6px,#2a1616 6px 12px)'
  if (!description) return '#4b5563'
  for (const [re, color] of PALETTE) if (re.test(description)) return color
  return '#556070'
}
