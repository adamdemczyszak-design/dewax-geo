import type {
  BoreholeDetail,
  EvidenceRef,
  GroundwaterPoint,
  RiskCode,
  RiskFinding,
  RiskSeverity,
} from '../types'

interface RiskRule {
  code: RiskCode
  label: string
  severity: RiskSeverity
  rationale: string
  /** Slowa kluczowe (znormalizowane, bez polskich znakow, male litery). */
  keywords: string[]
  /** Slowa, ktore uniewazniaja trafienie (np. "brak wody"). */
  negations?: string[]
}

/**
 * Katalog ryzyk wiertniczych istotnych dla otworow GSHP.
 * Detekcja opiera sie WYLACZNIE na slowach kluczowych z opisow litologicznych CBDG
 * oraz na wartosciach liczbowych z monitoringu wod podziemnych PSH.
 * Brak trafienia = brak dowodu, a nie brak ryzyka - raport mowi o tym wprost.
 */
export const RISK_RULES: RiskRule[] = [
  {
    code: 'KURZAWKA',
    label: 'Kurzawka',
    severity: 'wysokie',
    rationale:
      'Upłynniony grunt drobnoziarnisty pod ciśnieniem wody. Grozi zaciskaniem otworu, utratą płuczki, urwaniem przewodu i osiadaniem terenu wokół otworu.',
    keywords: ['kurzawka', 'kurzawki', 'kurzawke', 'kurzawkowa', 'grunt uplynniony', 'uplynnion'],
  },
  {
    code: 'PIASKI_NAWODNIONE',
    label: 'Piaski nawodnione / warstwa wodonośna w piaskach',
    severity: 'srednie',
    rationale:
      'Przewiercanie nawodnionych piasków wymaga rurowania lub płuczki o odpowiednich parametrach; ryzyko obsypywania ścian i ucieczki płuczki.',
    keywords: [
      'nawodnion',
      'piasek wodonosny',
      'piaski wodonosne',
      'warstwa wodonosna',
      'poziom wodonosny',
      'zawodnion',
      'piasek z woda',
      'z saczeniami',
      'saczenia',
      'przesiakl',
    ],
    negations: ['brak wody', 'suchy', 'nie nawodnion'],
  },
  {
    code: 'ARTEZYJSKIE',
    label: 'Wody artezyjskie / subartezyjskie (napięte)',
    severity: 'wysokie',
    rationale:
      'Samowypływ lub ciśnienie naporowe wymaga uszczelnienia i przeciwdziałania wypływowi; błąd wykonania skutkuje trwałym wypływem i odpowiedzialnością prawną.',
    keywords: ['artezyj', 'subartezyj', 'samowyplyw', 'napiete zwierciadlo', 'zwierciadlo napiete', 'naporowe'],
  },
  {
    code: 'ILY_POZNANSKIE',
    label: 'Iły poznańskie / iły pstre — grunty ekspansywne',
    severity: 'wysokie',
    rationale:
      'Iły serii poznańskiej pęcznieją przy kontakcie z wodą i zaciskają otwór; utrudniają zapuszczanie sondy i wymagają odpowiedniej płuczki oraz szybkiego zarurowania.',
    keywords: [
      'il poznansk',
      'ily poznansk',
      'ilow poznansk',
      'seria poznansk',
      'il pstry',
      'ily pstre',
      'ilow pstrych',
      'pstre ily',
      'peczniej',
      'ekspansywn',
      'il plastyczny',
      'ily plastyczne',
      'il zwiezly',
    ],
  },
  {
    code: 'KRAS',
    label: 'Zjawiska krasowe',
    severity: 'wysokie',
    rationale:
      'Pustki krasowe powodują nagłą utratę płuczki, zablokowanie przewodu i brak możliwości uszczelnienia otworu; wymagają zmiany technologii wiercenia.',
    keywords: ['kras', 'krasow', 'skrasowia', 'jaskin', 'pustka', 'pustki', 'kawerna', 'kawerny', 'lej krasowy'],
  },
  {
    code: 'ANHYDRYT_GIPS',
    label: 'Anhydryty / gipsy (ewaporaty)',
    severity: 'wysokie',
    rationale:
      'Anhydryt pod wpływem wody przechodzi w gips, zwiększając objętość o ok. 60% — zaciska otwór i niszczy cementację; gipsy łatwo ulegają ługowaniu.',
    keywords: ['anhydryt', 'gips', 'ewaporat', 'sol kamienna', 'halit'],
  },
  {
    code: 'SKALY_TWARDE',
    label: 'Skały zwięzłe / trudnowiercalne',
    severity: 'srednie',
    rationale:
      'Wymagają wiercenia obrotowo-udarowego (DTH) i innego uzbrojenia; istotnie wpływają na czas i koszt wykonania otworu.',
    keywords: [
      'granit', 'granodioryt', 'bazalt', 'gnejs', 'kwarcyt', 'porfir', 'amfibolit',
      'diabaz', 'gabro', 'sjenit', 'melafir', 'lupek krystaliczn', 'migmatyt',
      'piaskowiec zwiezl', 'wapien zwiezl', 'dolomit zwiezl', 'marmur', 'krzemien', 'czert',
    ],
  },
  {
    code: 'GLAZY_OTOCZAKI',
    label: 'Głazy / bruk morenowy / otoczaki',
    severity: 'srednie',
    rationale:
      'Duże frakcje w glinach zwałowych powodują zbaczanie otworu, uszkodzenia koronki i konieczność rurowania od powierzchni.',
    keywords: ['glaz', 'glazy', 'glazow', 'bruk morenow', 'otoczak', 'otoczaki', 'otoczakow', 'kamienist', 'zwir gruby'],
  },
  {
    code: 'TORF_GRUNT_ORGANICZNY',
    label: 'Torfy / namuły / grunty organiczne',
    severity: 'informacyjne',
    rationale:
      'Słabonośne grunty organiczne w stropie profilu — wymagają rurowania wstępnego i wpływają na posadowienie głowicy oraz przebieg poziomów.',
    keywords: ['torf', 'namul', 'gytia', 'gytie', 'muly organiczn', 'grunt organiczn', 'kreda jeziorna'],
  },
]

/** Usuwa polskie znaki diakrytyczne i sprowadza tekst do malych liter. */
export function normalizePl(text: string): string {
  return text
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface RiskDetectionInput {
  boreholes: BoreholeDetail[]
  groundwater?: GroundwaterPoint[]
  /** Ograniczenie analizy do zakresu 0..targetDepthM; null = caly profil. */
  targetDepthM?: number | null
}

export interface RiskDetectionResult {
  found: RiskFinding[]
  notFound: Array<{ code: RiskCode; label: string }>
}

/**
 * Wykrywanie ryzyk na podstawie slow kluczowych w litologii CBDG.
 * Zwraca rowniez liste ryzyk sprawdzonych i NIE potwierdzonych - to swiadomy
 * element raportu dowodowego (brak dowodu != brak zagrozenia).
 */
export function detectRisks(input: RiskDetectionInput): RiskDetectionResult {
  const { boreholes, groundwater = [], targetDepthM = null } = input
  const byCode = new Map<RiskCode, RiskFinding>()

  const push = (
    rule: RiskRule,
    matchedText: string,
    keyword: string,
    evidence: EvidenceRef,
  ) => {
    let finding = byCode.get(rule.code)
    if (!finding) {
      finding = {
        code: rule.code,
        label: rule.label,
        severity: rule.severity,
        rationale: rule.rationale,
        matches: [],
      }
      byCode.set(rule.code, finding)
    }
    const dup = finding.matches.some(
      (m) =>
        m.evidence.cbdgId === evidence.cbdgId &&
        m.evidence.fromM === evidence.fromM &&
        m.evidence.toM === evidence.toM &&
        m.keyword === keyword,
    )
    if (!dup) finding.matches.push({ matchedText, keyword, evidence })
  }

  for (const b of boreholes) {
    for (const layer of b.lithology) {
      if (targetDepthM !== null && layer.fromM > targetDepthM) continue
      const haystack = normalizePl(
        [layer.description, layer.lithostratigraphy, layer.chronostratigraphy]
          .filter(Boolean)
          .join(' | '),
      )
      if (!haystack) continue

      for (const rule of RISK_RULES) {
        if (rule.negations?.some((n) => haystack.includes(normalizePl(n)))) continue
        for (const kw of rule.keywords) {
          const k = normalizePl(kw)
          if (haystack.includes(k)) {
            push(rule, layer.description, kw, {
              cbdgId: b.cbdgId,
              boreholeName: b.name,
              distanceM: b.distanceM,
              fromM: layer.fromM,
              toM: layer.toM,
              sourceId: 'CBDG_OTWORY_REST',
              sourceUrl: b.detailSourceUrl,
            })
            break // jedno trafienie na regule i warstwe wystarczy
          }
        }
      }
    }
  }

  // Wody napiete/artezyjskie z pomiarow PSH: zwierciadlo ustalone plytsze niz
  // nawiercone oznacza naporowosc; wartosc ujemna oznacza samowyplyw.
  const artesianRule = RISK_RULES.find((r) => r.code === 'ARTEZYJSKIE')!
  for (const g of groundwater) {
    const stab = g.stabilisedLevelM
    const drilled = g.drilledLevelM
    if (stab !== null && stab < 0) {
      push(
        artesianRule,
        `Punkt monitoringu PSH ${g.name ?? g.id ?? ''}: zwierciadło ustalone ${stab} m p.p.t. (samowypływ)`,
        'zwierciadło ustalone poniżej 0 m p.p.t.',
        gwEvidence(g),
      )
    } else if (stab !== null && drilled !== null && drilled - stab > 1) {
      push(
        artesianRule,
        `Punkt monitoringu PSH ${g.name ?? g.id ?? ''}: zwierciadło nawiercone ${drilled} m p.p.t., ustalone ${stab} m p.p.t. (różnica ${round1(drilled - stab)} m — zwierciadło napięte)`,
        'różnica zwierciadła nawierconego i ustalonego > 1 m',
        gwEvidence(g),
      )
    }
  }

  const found = [...byCode.values()].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.matches.length - a.matches.length,
  )
  const foundCodes = new Set(found.map((f) => f.code))
  const notFound = RISK_RULES.filter((r) => !foundCodes.has(r.code)).map((r) => ({
    code: r.code,
    label: r.label,
  }))

  return { found, notFound }
}

function gwEvidence(g: GroundwaterPoint): EvidenceRef {
  return {
    cbdgId: g.id ?? -1,
    boreholeName: g.name ?? 'Punkt monitoringu PSH',
    distanceM: g.distanceM,
    fromM: g.aquiferTopM ?? 0,
    toM: g.aquiferBottomM ?? g.boreholeDepthM ?? 0,
    sourceId: g.sourceId,
    sourceUrl: g.sourceUrl,
  }
}

function severityRank(s: RiskSeverity): number {
  return s === 'wysokie' ? 3 : s === 'srednie' ? 2 : 1
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
