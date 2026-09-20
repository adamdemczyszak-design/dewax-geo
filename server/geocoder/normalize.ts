/**
 * Normalizacja danych adresowych wpisanych przez uzytkownika.
 *
 * Usluga UUG dopasowuje nazwy tekstowo i jest wrazliwa na forme zapisu.
 * Wiertacz wpisuje adres z pamieci albo przepisuje go z umowy - stad
 * "ul.", "m. st. Warszawa", podwojne spacje, mylone myslniki i brak ogonkow.
 * Kazdy taki drobiazg potrafil wczesniej zwrocic zero wynikow.
 */

/** Zdejmuje prefiks rodzaju ulicy - UUG oczekuje samej nazwy. */
export function stripStreetPrefix(street: string): string {
  return street
    .replace(/^\s*(ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle|rondo|skwer)\s+/i, '')
    .trim()
}

/** Zdejmuje prefiksy rodzaju miejscowosci ("m. st.", "gm.", "wies"). */
export function stripCityPrefix(city: string): string {
  return city
    .replace(/^\s*(m\.\s*st\.?|m\.|miasto|gm\.?|gmina|wie[sś]|w\.)\s+/i, '')
    .trim()
}

/** Scala biale znaki i ujednolica myslniki oraz apostrofy. */
export function tidy(s: string): string {
  return s
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Rozbija numer domu na czesc bazowa i wyroznik.
 * "10A" -> { base: "10", full: "10A" }; "12/3" -> { base: "12", full: "12/3" }.
 * Sluzy do proby zapasowej: gdy UUG nie zna "10A", punkt "10" jest o kilka
 * metrow obok i nadal jest wielokrotnie lepszy niz srodek ulicy.
 */
export function splitHouseNumber(houseNumber: string): { full: string; base: string | null } {
  const full = tidy(houseNumber).replace(/\s*([/\\-])\s*/g, '$1')
  const m = /^(\d+)/.exec(full)
  const base = m && m[1] !== full ? m[1] : null
  return { full, base }
}

/** Kod pocztowy do postaci "00-000"; null gdy wpis nie jest kodem. */
export function normalizePostalCode(code: string): string | null {
  const digits = tidy(code).replace(/\D/g, '')
  if (digits.length !== 5) return null
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

/**
 * Forma porownawcza: male litery, bez ogonkow, bez znakow innych niz
 * litery i cyfry. Uzywana wylacznie do porownan po stronie aplikacji -
 * do uslugi zawsze wysylamy zapis z polskimi znakami.
 */
export function foldPl(s: string): string {
  const from = 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ'
  const to = 'acelnoszzACELNOSZZ'
  let out = ''
  for (const ch of s) {
    const i = from.indexOf(ch)
    out += i >= 0 ? to[i] : ch
  }
  return out
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}
