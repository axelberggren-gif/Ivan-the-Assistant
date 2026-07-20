import type { RecommendTraining, TrainRecommendation, WdlSplit } from './types'

/** Minimum merged games before an opening can be recommended. */
const MIN_GAMES = 5
/** Recommend only when the merged score is below this threshold. */
const SCORE_THRESHOLD = 0.5
/** Cap on how much a large sample can amplify urgency. */
const URGENCY_GAMES_CAP = 20

/** Generic words dropped when extracting the core of a trainable name. */
const TERMINATOR_WORDS = new Set([
  'defense',
  'defence',
  'game',
  'opening',
  'gambit',
  'attack',
  'system',
  'variation',
])

/** Lowercase, drop apostrophes ("Queen's" → "queens"), non-alphanumerics → spaces. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The distinctive core of a trainable opening name: terminator words removed,
 * unless that would leave fewer than two words (then keep the full name so
 * e.g. "Queen's Gambit" stays "queens gambit" rather than just "queens").
 */
function coreOf(name: string): string {
  const norm = normalize(name)
  const words = norm.split(' ').filter((w) => !TERMINATOR_WORDS.has(w))
  return words.length >= 2 ? words.join(' ') : norm
}

function mergeSplits(splits: WdlSplit[]): WdlSplit {
  let games = 0
  let wins = 0
  let draws = 0
  let losses = 0
  for (const s of splits) {
    games += s.games
    wins += s.wins
    draws += s.draws
    losses += s.losses
  }
  return {
    games,
    wins,
    draws,
    losses,
    score: games === 0 ? 0 : (wins + draws / 2) / games,
  }
}

function buildMessage(openingName: string, split: WdlSplit): string {
  const drawn = split.draws > 0 ? ` and drawn ${split.draws}` : ''
  return `You've lost ${split.losses}${drawn} of your ${split.games} games in the ${openingName} — train it now`
}

/**
 * Match the report's opening families against the trainable openings and
 * recommend the ones the user is struggling with: merged games ≥ 5 and
 * score < 0.5, sorted by urgency descending.
 */
export const recommendTraining: RecommendTraining = (report, trainable) => {
  const recommendations: TrainRecommendation[] = []

  for (const opening of trainable) {
    const core = coreOf(opening.name)
    const isItalian = normalize(opening.name).includes('italian')

    const rows = report.openings.filter((row) => {
      if (row.asColor !== opening.userColor) return false
      const family = normalize(row.family)
      if (family.includes(core)) return true
      if (isItalian && (family.includes('giuoco') || family.includes('two knights'))) return true
      return false
    })
    if (rows.length === 0) continue

    const split = mergeSplits(rows.map((r) => r.split))
    if (split.games < MIN_GAMES || split.score >= SCORE_THRESHOLD) continue

    recommendations.push({
      openingId: opening.id,
      openingName: opening.name,
      message: buildMessage(opening.name, split),
      split,
      urgency: (SCORE_THRESHOLD - split.score) * Math.min(split.games, URGENCY_GAMES_CAP),
    })
  }

  return recommendations.sort((a, b) => b.urgency - a.urgency)
}
