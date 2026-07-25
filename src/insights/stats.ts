import type {
  ChesscomGame,
  ComputeReport,
  GameResult,
  InsightsGame,
  InsightsReport,
  NormalizeGames,
  OpeningReportRow,
  RatingPoint,
  Termination,
  TimeClass,
  WdlSplit,
} from './types'

/** Per-side result codes chess.com uses for drawn games. */
const DRAW_CODES = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
])

/** Decisive result codes → coarse termination buckets. */
const TERMINATION_MAP: Record<string, Termination> = {
  checkmated: 'checkmate',
  resigned: 'resignation',
  timeout: 'timeout',
  abandoned: 'abandoned',
}

/** Words that end an opening family name (kept inclusive when truncating). */
const FAMILY_TERMINATORS = new Set([
  'defense',
  'defence',
  'game',
  'opening',
  'gambit',
  'attack',
  'system',
  'variation',
])

function resultFromCode(code: string): GameResult {
  if (code === 'win') return 'win'
  if (DRAW_CODES.has(code)) return 'draw'
  return 'loss'
}

/** Human opening name from an ECOUrl slug, dropping move-notation tokens. */
function openingNameFromUrl(url: string): string | undefined {
  const path = url.split('?')[0]
  const segments = path.split('/').filter((s) => s.length > 0)
  const slug = segments[segments.length - 1]
  if (!slug) return undefined
  const words = slug.split('-').filter((w) => w.length > 0 && !/[\d.]/.test(w))
  return words.length > 0 ? words.join(' ') : undefined
}

/** Truncate an opening name at the first family-terminator word, inclusive. */
function familyFromName(name: string): string {
  const words = name.split(' ')
  const idx = words.findIndex((w) => FAMILY_TERMINATORS.has(w.toLowerCase()))
  if (idx >= 0) return words.slice(0, idx + 1).join(' ')
  return words.slice(0, 3).join(' ')
}

/** Highest move number in the PGN movetext, if any. */
function parseFullMoves(pgn: string): number | undefined {
  const movetext = pgn
    .split('\n')
    .filter((line) => !line.startsWith('['))
    .join(' ')
    .replace(/\{[^}]*\}/g, ' ')
  let max: number | undefined
  for (const m of movetext.matchAll(/(\d+)\./g)) {
    const n = Number(m[1])
    if (max === undefined || n > max) max = n
  }
  return max
}

/**
 * Filter raw chess.com games to standard chess played by `username`
 * (case-insensitive) and normalize each from the user's side.
 * Returned games are sorted by end time, oldest first.
 */
export const normalizeGames: NormalizeGames = (raw, username) => {
  const lower = username.toLowerCase()
  const games: InsightsGame[] = []

  for (const g of raw) {
    if (g.rules !== 'chess') continue

    let userColor: 'white' | 'black'
    if (g.white.username.toLowerCase() === lower) userColor = 'white'
    else if (g.black.username.toLowerCase() === lower) userColor = 'black'
    else continue

    const user = userColor === 'white' ? g.white : g.black
    const opponent = userColor === 'white' ? g.black : g.white
    const result = resultFromCode(user.result)

    let termination: Termination
    if (result === 'draw') {
      termination = 'draw'
    } else {
      const loserCode = result === 'win' ? opponent.result : user.result
      termination = TERMINATION_MAP[loserCode] ?? 'other'
    }

    const eco = g.pgn?.match(/\[ECO "([^"]+)"\]/)?.[1]
    const ecoUrl = g.pgn?.match(/\[ECOUrl "([^"]+)"\]/)?.[1] ?? g.eco
    const openingName = ecoUrl ? openingNameFromUrl(ecoUrl) : undefined
    const openingFamily = openingName ? familyFromName(openingName) : undefined
    const fullMoves = g.pgn ? parseFullMoves(g.pgn) : undefined

    games.push({
      url: g.url,
      endTimeMs: g.end_time * 1000,
      timeClass: g.time_class,
      rated: g.rated,
      userColor,
      userRating: user.rating,
      opponentRating: opponent.rating,
      opponentUsername: opponent.username,
      result,
      termination,
      eco,
      openingName,
      openingFamily,
      fullMoves,
      ...(g.pgn ? { pgn: g.pgn } : {}),
    })
  }

  return games.sort((a, b) => a.endTimeMs - b.endTimeMs)
}

/** Build a win/draw/loss split over a set of games. */
function buildSplit(games: InsightsGame[]): WdlSplit {
  let wins = 0
  let draws = 0
  let losses = 0
  for (const g of games) {
    if (g.result === 'win') wins++
    else if (g.result === 'draw') draws++
    else losses++
  }
  const total = games.length
  return {
    games: total,
    wins,
    draws,
    losses,
    score: total === 0 ? 0 : (wins + draws / 2) / total,
  }
}

function opponentBand(g: InsightsGame): 'weaker' | 'similar' | 'stronger' {
  const diff = g.opponentRating - g.userRating
  if (diff <= -50) return 'weaker'
  if (diff >= 50) return 'stronger'
  return 'similar'
}

function mostFrequentEco(games: InsightsGame[]): string | undefined {
  const counts = new Map<string, number>()
  for (const g of games) {
    if (g.eco) counts.set(g.eco, (counts.get(g.eco) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = 0
  for (const [eco, count] of counts) {
    if (count > bestCount) {
      best = eco
      bestCount = count
    }
  }
  return best
}

/**
 * Aggregate normalized games into the insights dashboard report:
 * rating series, W/D/L splits by color, time class and opponent strength,
 * opening families, how wins/losses end, and game-length distribution.
 */
export const computeReport: ComputeReport = (games, username) => {
  const sorted = [...games].sort((a, b) => a.endTimeMs - b.endTimeMs)

  const ratingSeries: Partial<Record<TimeClass, RatingPoint[]>> = {}
  for (const g of sorted) {
    const series = (ratingSeries[g.timeClass] ??= [])
    series.push({ endTimeMs: g.endTimeMs, rating: g.userRating })
  }

  const byTimeClass: Partial<Record<TimeClass, WdlSplit>> = {}
  for (const tc of Object.keys(ratingSeries) as TimeClass[]) {
    byTimeClass[tc] = buildSplit(sorted.filter((g) => g.timeClass === tc))
  }

  const groups = new Map<string, { family: string; asColor: 'white' | 'black'; games: InsightsGame[] }>()
  for (const g of sorted) {
    if (!g.openingFamily) continue
    const key = `${g.openingFamily}|${g.userColor}`
    const group = groups.get(key)
    if (group) group.games.push(g)
    else groups.set(key, { family: g.openingFamily, asColor: g.userColor, games: [g] })
  }
  const openings: OpeningReportRow[] = []
  for (const { family, asColor, games: groupGames } of groups.values()) {
    if (groupGames.length < 3) continue
    openings.push({ family, eco: mostFrequentEco(groupGames), asColor, split: buildSplit(groupGames) })
  }
  openings.sort((a, b) => b.split.games - a.split.games)

  const lossEndings: Partial<Record<Termination, number>> = {}
  const winEndings: Partial<Record<Termination, number>> = {}
  for (const g of sorted) {
    if (g.result === 'loss') lossEndings[g.termination] = (lossEndings[g.termination] ?? 0) + 1
    else if (g.result === 'win') winEndings[g.termination] = (winEndings[g.termination] ?? 0) + 1
  }

  const lengthBuckets = { short: 0, medium: 0, long: 0 }
  for (const g of sorted) {
    if (g.fullMoves === undefined) continue
    if (g.fullMoves < 20) lengthBuckets.short++
    else if (g.fullMoves < 40) lengthBuckets.medium++
    else lengthBuckets.long++
  }

  const report: InsightsReport = {
    username,
    totalGames: sorted.length,
    from: sorted.length > 0 ? sorted[0].endTimeMs : undefined,
    to: sorted.length > 0 ? sorted[sorted.length - 1].endTimeMs : undefined,
    ratingSeries,
    overall: buildSplit(sorted),
    byColor: {
      white: buildSplit(sorted.filter((g) => g.userColor === 'white')),
      black: buildSplit(sorted.filter((g) => g.userColor === 'black')),
    },
    byTimeClass,
    byOpponentBand: {
      weaker: buildSplit(sorted.filter((g) => opponentBand(g) === 'weaker')),
      similar: buildSplit(sorted.filter((g) => opponentBand(g) === 'similar')),
      stronger: buildSplit(sorted.filter((g) => opponentBand(g) === 'stronger')),
    },
    openings,
    lossEndings,
    winEndings,
    lengthBuckets,
  }
  return report
}
