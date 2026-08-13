import type { Config } from '@netlify/functions'
import { ENDPOINTS, RADIUS_LADDER, DEFAULT_TARGET_DEPTH_M } from '../../server/endpoints'

/** Jawna lista uslug PGI-PIB uzywanych przez aplikacje - do wgladu dla uzytkownika. */
export default async (): Promise<Response> => {
  return new Response(
    JSON.stringify({
      endpoints: Object.values(ENDPOINTS),
      radiusLadderM: RADIUS_LADDER,
      defaultTargetDepthM: DEFAULT_TARGET_DEPTH_M,
      policy:
        'Dane geologiczne pochodzą wyłącznie z usług PGI-PIB / CBDG wymienionych powyżej. ' +
        'Aplikacja nie korzysta z żadnych innych źródeł danych geologicznych.',
    }),
    { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } },
  )
}

export const config: Config = {
  path: '/api/endpoints',
}
