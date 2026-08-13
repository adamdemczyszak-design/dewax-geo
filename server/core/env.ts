declare const Netlify:
  | { env: { get(key: string): string | undefined } }
  | undefined

/**
 * Odczyt zmiennych srodowiskowych dzialajacy zarowno w funkcjach Netlify,
 * jak i w testach uruchamianych lokalnie pod Node.
 */
export function getEnv(key: string): string | undefined {
  try {
    if (typeof Netlify !== 'undefined' && Netlify?.env) {
      const v = Netlify.env.get(key)
      if (v !== undefined && v !== '') return v
    }
  } catch {
    /* poza srodowiskiem Netlify */
  }
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key]
  return v === '' ? undefined : v
}
