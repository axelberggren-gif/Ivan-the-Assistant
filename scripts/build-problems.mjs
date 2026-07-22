#!/usr/bin/env node
/**
 * scripts/build-problems.mjs — Milestone 6a data pipeline (ADR-0003, PLAN.md §8.2).
 *
 * Dev-only Node (>= 20) script. Downloads the Lichess puzzle database
 * (CC0, https://database.lichess.org/#puzzles), filters it down to clean
 * 2–3-move tactics in the club rating range, samples a balanced set per
 * curated motif × rating band, verifies every sampled puzzle through
 * chess.js, and writes per-theme JSON plus a manifest to public/problems/.
 *
 * The raw CSV is NEVER committed and never persisted to disk here — the
 * ~250 MB .zst dump is streamed (HTTPS → zstd decompress → readline) and
 * only the ~6k sampled problems are kept in memory.
 *
 * Sampling is deterministic: a seeded PRNG (constant + source dump date)
 * drives reservoir sampling, so reruns on the same dump reproduce the
 * same output byte-for-byte.
 *
 * Usage:
 *   node scripts/build-problems.mjs
 *   node scripts/build-problems.mjs --input path/to/dump.csv.zst
 *   node scripts/build-problems.mjs --input fixture.csv --out /tmp/out
 *   node scripts/build-problems.mjs --source-date 2026-07-01
 *
 * No dependencies beyond Node builtins and chess.js (already in package.json).
 */

import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import * as zlib from 'node:zlib'
import { spawn, spawnSync } from 'node:child_process'
import { Chess } from 'chess.js'

// ---------------------------------------------------------------------------
// Tunable constants (the filter/sampling contract from PLAN.md §8.2)
// ---------------------------------------------------------------------------

const DATASET_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst'

const RATING_MIN = 1200
const RATING_MAX = 1900
const POPULARITY_MIN = 90
const NB_PLAYS_MIN = 1000

/** Three difficulty bands the sample is balanced across. */
const RATING_BANDS = [
  [1200, 1449],
  [1450, 1699],
  [1700, 1900],
]

/** ~1000 problems per motif, split evenly across the rating bands. */
const TARGET_PER_MOTIF = 1000
const BUCKET_SIZE = Math.round(TARGET_PER_MOTIF / RATING_BANDS.length) // 333

/**
 * Lichess length tags → expected Moves length (moves[0] is the opponent's
 * setup move, so a "2 user moves" puzzle is 4 UCI moves). 'oneMove' puzzles
 * are excluded entirely.
 */
const LENGTH_TAGS = { short: 4, long: 6 }

/** Seed constant — combined with the dump's source date for the PRNG. */
const SEED_BASE = 'ivan-problems-v1'

/**
 * The six curated motifs (PLAN.md §8.2). Display names/descriptions are
 * hand-authored coach copy and flow into manifest.json (ProblemThemeInfo).
 */
const MOTIFS = [
  {
    id: 'fork',
    name: 'Fork',
    description: 'One piece attacks two targets at once — something has to give.',
  },
  {
    id: 'pin',
    name: 'Pin',
    description: "A piece can't move without exposing something more valuable behind it.",
  },
  {
    id: 'skewer',
    name: 'Skewer',
    description: 'Attack the big piece first — when it steps aside, win what was hiding behind it.',
  },
  {
    id: 'discoveredAttack',
    name: 'Discovered Attack',
    description: "Move one piece and unmask another's attack — two threats from a single move.",
  },
  {
    id: 'backRankMate',
    name: 'Back-Rank Mate',
    description: 'The king is boxed in behind its own pawns — crash through on the last rank.',
  },
  {
    id: 'hangingPiece',
    name: 'Hanging Piece',
    description: 'An undefended piece is up for grabs — spot it before your opponent saves it.',
  },
]

// CSV columns of lichess_db_puzzle.csv:
// PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
const COL = {
  id: 0,
  fen: 1,
  moves: 2,
  rating: 3,
  popularity: 5,
  nbPlays: 6,
  themes: 7,
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_OUT = fileURLToPath(new URL('../public/problems', import.meta.url))

function usage() {
  console.log(`Usage: node scripts/build-problems.mjs [options]

Options:
  --input <path-or-url>     CSV source (.csv.zst or plain .csv). Default:
                            ${DATASET_URL}
  --out <dir>               Output directory. Default: public/problems
  --source-date YYYY-MM-DD  Override the dump date recorded in the manifest
                            (default: HTTP Last-Modified header, else today).
  -h, --help                Show this help.`)
}

function fail(message) {
  console.error(`\nbuild-problems: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { input: DATASET_URL, out: DEFAULT_OUT, sourceDate: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input') {
      args.input = argv[++i]
    } else if (a === '--out') {
      args.out = argv[++i]
    } else if (a === '--source-date') {
      args.sourceDate = argv[++i]
    } else if (a === '-h' || a === '--help') {
      usage()
      process.exit(0)
    } else {
      fail(`unknown argument '${a}' (see --help)`)
    }
  }
  if (!args.input) fail('--input needs a value')
  if (!args.out) fail('--out needs a value')
  if (args.sourceDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.sourceDate)) {
    fail(`--source-date must be YYYY-MM-DD, got '${args.sourceDate}'`)
  }
  return args
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (xmur3 string hash → mulberry32)
// ---------------------------------------------------------------------------

function hashSeed(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Input: open the source as a line stream (never buffering the whole file)
// ---------------------------------------------------------------------------

/** HTTPS/local source → { stream, lastModified }. */
async function openSource(input) {
  if (/^https?:\/\//i.test(input)) {
    console.log(`Downloading ${input} (streaming — the raw CSV is never written to disk or committed)`)
    const res = await fetch(input)
    if (!res.ok || !res.body) {
      fail(`download failed: HTTP ${res.status} ${res.statusText} for ${input}`)
    }
    return {
      stream: Readable.fromWeb(res.body),
      lastModified: res.headers.get('last-modified'),
      compressed: new URL(input).pathname.endsWith('.zst'),
    }
  }
  console.log(`Reading ${input} (streaming)`)
  return {
    stream: createReadStream(input),
    lastModified: null,
    compressed: input.endsWith('.zst'),
  }
}

/**
 * zstd decompression: prefer node:zlib's native stream (Node >= 22.15),
 * else pipe through a system `zstd -dc` / `unzstd`. Clear failure otherwise.
 */
function zstdDecompress(source) {
  if (typeof zlib.createZstdDecompress === 'function') {
    const z = zlib.createZstdDecompress()
    source.on('error', (err) => z.destroy(err))
    return source.pipe(z)
  }
  for (const [bin, binArgs] of [
    ['zstd', ['-dc', '-']],
    ['unzstd', ['-c', '-']],
  ]) {
    const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' })
    if (!probe.error) {
      console.log(`node:zlib has no zstd support here — decompressing via system '${bin}'`)
      const child = spawn(bin, binArgs, { stdio: ['pipe', 'pipe', 'inherit'] })
      child.on('exit', (code) => {
        if (code !== 0) fail(`${bin} exited with code ${code}`)
      })
      source.on('error', (err) => child.stdout.destroy(err))
      source.pipe(child.stdin)
      return child.stdout
    }
  }
  fail(
    'no zstd decompressor available. Either run Node >= 22.15 ' +
      "(node:zlib createZstdDecompress) or install the 'zstd' CLI " +
      '(apt install zstd / brew install zstd), then rerun.',
  )
}

// ---------------------------------------------------------------------------
// Verification: replay a puzzle through chess.js
// ---------------------------------------------------------------------------

function uciToMove(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined,
  }
}

/** True iff the FEN parses and every UCI move is legal in sequence. */
function replays(problem) {
  try {
    const chess = new Chess(problem.fen)
    for (const uci of problem.moves) chess.move(uciToMove(uci))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv)

  const { stream, lastModified, compressed } = await openSource(args.input)

  const sourceDate =
    args.sourceDate ??
    (lastModified
      ? new Date(lastModified).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10))

  const rng = mulberry32(hashSeed(`${SEED_BASE}:${sourceDate}`))
  console.log(`Source date: ${sourceDate} (PRNG seeded from '${SEED_BASE}:${sourceDate}' — reruns on the same dump are reproducible)`)

  const lines = createInterface({
    input: compressed ? zstdDecompress(stream) : stream,
    crlfDelay: Infinity,
  })

  // One reservoir per (motif, rating band); every puzzle is assigned to
  // exactly one motif — the matching motif with the fewest picks so far.
  const buckets = new Map() // `${motifId}:${bandIdx}` -> { items: [], seen: 0 }
  for (const motif of MOTIFS) {
    for (let b = 0; b < RATING_BANDS.length; b++) {
      buckets.set(`${motif.id}:${b}`, { items: [], seen: 0 })
    }
  }
  const assignedPerMotif = new Map(MOTIFS.map((m) => [m.id, 0]))

  let rows = 0
  let candidates = 0

  for await (const line of lines) {
    if (!line || line.startsWith('PuzzleId,')) continue
    rows++
    if (rows % 1_000_000 === 0) console.log(`  … ${rows.toLocaleString('en-US')} rows scanned`)

    const cols = line.split(',')
    if (cols.length < 10) continue

    const rating = Number(cols[COL.rating])
    if (!(rating >= RATING_MIN && rating <= RATING_MAX)) continue
    if (Number(cols[COL.popularity]) < POPULARITY_MIN) continue
    if (Number(cols[COL.nbPlays]) < NB_PLAYS_MIN) continue

    const themes = cols[COL.themes].split(' ').filter(Boolean)
    if (themes.includes('oneMove')) continue
    const lengthTag = themes.find((t) => t in LENGTH_TAGS)
    if (!lengthTag) continue

    const moves = cols[COL.moves].split(' ').filter(Boolean)
    if (moves.length !== LENGTH_TAGS[lengthTag]) continue

    const matching = MOTIFS.filter((m) => themes.includes(m.id))
    if (matching.length === 0) continue

    candidates++

    // Assign to exactly one motif: the matching one with the fewest picks
    // so far (ties broken by curated motif order — deterministic).
    let motif = matching[0]
    for (const m of matching) {
      if (assignedPerMotif.get(m.id) < assignedPerMotif.get(motif.id)) motif = m
    }
    assignedPerMotif.set(motif.id, assignedPerMotif.get(motif.id) + 1)

    const bandIdx = RATING_BANDS.findIndex(([lo, hi]) => rating >= lo && rating <= hi)
    const bucket = buckets.get(`${motif.id}:${bandIdx}`)

    const problem = {
      id: cols[COL.id],
      fen: cols[COL.fen],
      moves,
      rating,
      themes, // keep the full original tag list
    }

    // Reservoir sampling: uniform BUCKET_SIZE-subset of the bucket's stream.
    bucket.seen++
    if (bucket.items.length < BUCKET_SIZE) {
      bucket.items.push(problem)
    } else {
      const j = Math.floor(rng() * bucket.seen)
      if (j < BUCKET_SIZE) bucket.items[j] = problem
    }
  }

  console.log(`\nScanned ${rows.toLocaleString('en-US')} rows; ${candidates.toLocaleString('en-US')} passed the filters.`)

  // Verification pass: every sampled puzzle must replay through chess.js.
  let droppedInvalid = 0
  const perMotif = new Map()
  for (const motif of MOTIFS) {
    const kept = []
    for (let b = 0; b < RATING_BANDS.length; b++) {
      for (const p of buckets.get(`${motif.id}:${b}`).items) {
        if ((p.moves.length === 4 || p.moves.length === 6) && replays(p)) {
          kept.push(p)
        } else {
          droppedInvalid++
        }
      }
    }
    // Deterministic, human-friendly file order.
    kept.sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1))
    perMotif.set(motif.id, kept)
  }

  // Write output: compact per-theme files + pretty manifest.
  mkdirSync(args.out, { recursive: true })
  const themeInfos = MOTIFS.map((motif) => {
    const problems = perMotif.get(motif.id)
    const file = `${motif.id}.json`
    writeFileSync(join(args.out, file), JSON.stringify(problems))
    return {
      id: motif.id,
      name: motif.name,
      description: motif.description,
      file,
      count: problems.length,
    }
  })

  const total = themeInfos.reduce((sum, t) => sum + t.count, 0)
  const manifest = {
    source: 'lichess_db_puzzle',
    sourceDate,
    generatedAt: new Date().toISOString(),
    license: 'CC0-1.0',
    ratingMin: RATING_MIN,
    ratingMax: RATING_MAX,
    total,
    themes: themeInfos,
  }
  writeFileSync(join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`\nWrote ${args.out}/manifest.json (+ ${themeInfos.length} theme files):`)
  for (const t of themeInfos) {
    const bands = RATING_BANDS.map(
      ([lo, hi]) => perMotif.get(t.id).filter((p) => p.rating >= lo && p.rating <= hi).length,
    ).join('/')
    console.log(`  ${t.file.padEnd(22)} ${String(t.count).padStart(5)} problems (bands ${bands})`)
  }
  console.log(`  total ${total} problems; ${droppedInvalid} sampled row(s) dropped by chess.js verification`)
  console.log('\nReminder (PLAN.md §8.2): commit only public/problems/*.json — the raw CSV is never committed.')
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)))
