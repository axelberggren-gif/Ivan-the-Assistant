#!/usr/bin/env node
/**
 * scripts/build-problems.mjs — Milestone 6a data pipeline (ADR-0003, PLAN.md §8.2).
 *
 * Dev-only Node (>= 20) script. Downloads the Lichess puzzle database
 * (CC0, https://database.lichess.org/#puzzles), filters it down to clean
 * 2–4-move tactics across a wide rating spread (~1400–2500), samples a
 * balanced set per curated motif × rating band, verifies every sampled
 * puzzle through chess.js, and writes per-theme JSON plus a manifest to
 * public/problems/. The motif set includes defensive/holding themes so the
 * read-check verdict isn't always "you're winning".
 *
 * The raw CSV is NEVER committed and never persisted to disk here — the
 * ~250 MB .zst dump is streamed (HTTPS → zstd decompress → readline) and
 * only the ~6k sampled problems are kept in memory.
 *
 * Decompression prefers the system `zstd` binary (preinstalled on
 * GitHub's ubuntu-latest runners; handles long-window and multi-frame
 * archives), falling back to node:zlib's ZstdDecompress. Failures at any
 * pipeline stage abort the run BEFORE anything is written — output files
 * only appear after a fully successful scan.
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

const RATING_MIN = 1400
const RATING_MAX = 2500
const POPULARITY_MIN = 90
// Harder puzzles get fewer plays than easy ones, so the popularity floor is
// kept high (quality) while the raw play-count floor is relaxed — otherwise
// the top band would be starved.
const NB_PLAYS_MIN = 500

/**
 * Four difficulty bands spanning the wider spread (~1400–2500). Sampling is
 * balanced across them, so the set has a long tail of hard problems, not just
 * a cluster at the easy end.
 */
const RATING_BANDS = [
  [1400, 1699],
  [1700, 1999],
  [2000, 2249],
  [2250, 2500],
]

/** ~600 problems per motif, split evenly across the rating bands. */
const TARGET_PER_MOTIF = 600
const BUCKET_SIZE = Math.round(TARGET_PER_MOTIF / RATING_BANDS.length) // 150

/**
 * Lichess length tags → expected Moves length (moves[0] is the opponent's
 * setup move, so a "2 user moves" puzzle is 4 UCI moves). 'oneMove' puzzles
 * are excluded entirely; 'veryLong' (4 user moves, 8 UCI) adds deeper
 * calculation to the set (CONTEXT.md: a problem is a 2–4 move line).
 */
const LENGTH_TAGS = { short: 4, long: 6, veryLong: 8 }

/** Seed constant — combined with the dump's source date for the PRNG. */
const SEED_BASE = 'ivan-problems-v1'

/**
 * The curated motifs (PLAN.md §8.2). Display names/descriptions are
 * hand-authored coach copy and flow into manifest.json (ProblemThemeInfo).
 * The set spans attacking motifs AND defensive/holding play (`defensiveMove`)
 * so the read-check verdict isn't always "you're winning".
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
    id: 'doubleCheck',
    name: 'Double Check',
    description: 'Two pieces check at once — the king must move, nothing else parries it.',
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
  {
    id: 'trappedPiece',
    name: 'Trapped Piece',
    description: 'A piece has run out of safe squares — hem it in and win it.',
  },
  {
    id: 'deflection',
    name: 'Deflection',
    description: 'Drag a defender off its post, then strike where it used to guard.',
  },
  {
    id: 'attraction',
    name: 'Attraction',
    description: 'Lure a piece — often the king — onto a square where it walks into a tactic.',
  },
  {
    id: 'sacrifice',
    name: 'Sacrifice',
    description: 'Give up material now to force a bigger gain, or mate, right after.',
  },
  {
    id: 'intermezzo',
    name: 'In-Between Move',
    description: "Slip in a forcing move before the 'obvious' recapture — the zwischenzug.",
  },
  {
    id: 'advancedPawn',
    name: 'Advanced Pawn',
    description: 'A pawn near promotion does the work — push it, or use its threat.',
  },
  {
    id: 'defensiveMove',
    name: 'Defensive Resource',
    description: "You're under fire — find the only move that holds the position together.",
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

/** HTTPS/local source → { stream, lastModified, compressed }. Logs diagnostics. */
async function openSource(input) {
  if (/^https?:\/\//i.test(input)) {
    console.log(`Downloading ${input} (streaming — the raw CSV is never written to disk or committed)`)
    const res = await fetch(input)
    console.log(
      `HTTP ${res.status} ${res.statusText}; content-type: ${res.headers.get('content-type') ?? '(none)'}; ` +
        `content-length: ${res.headers.get('content-length') ?? '(none)'}; ` +
        `last-modified: ${res.headers.get('last-modified') ?? '(none)'}`,
    )
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
 * Read (and push back) the first n bytes of a paused Readable without
 * consuming them — the stream can then be piped as if untouched.
 */
function peekBytes(stream, n) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const cleanup = () => {
      stream.removeListener('readable', onReadable)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
    }
    const finish = () => {
      cleanup()
      const buf = Buffer.concat(chunks)
      if (buf.length > 0) stream.unshift(buf)
      resolve(buf.subarray(0, n))
    }
    const onReadable = () => {
      let chunk
      while (size < n && (chunk = stream.read()) !== null) {
        chunks.push(chunk)
        size += chunk.length
      }
      if (size >= n) finish()
    }
    const onEnd = () => finish()
    const onError = (err) => {
      cleanup()
      reject(err)
    }
    stream.on('readable', onReadable)
    stream.on('end', onEnd)
    stream.on('error', onError)
    onReadable()
  })
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]) // zstd frame magic, as it appears on the wire

const toHex = (buf) => [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ')

/**
 * Sanity-check that a .zst source actually starts with zstd data — a
 * proxy/CDN error page would otherwise surface as a cryptic frame error
 * deep inside the decompressor. Aborts (without writing anything) with the
 * offending bytes when the magic is wrong.
 */
async function assertZstdMagic(stream, label) {
  const head = await peekBytes(stream, 4)
  const hex = toHex(head)
  if (head.length === 4 && head.equals(ZSTD_MAGIC)) {
    console.log(`zstd magic verified (${hex})`)
    return
  }
  // Skippable frame: magic 0x184D2A50–0x184D2A5F, little-endian on the wire → 5x 2a 4d 18.
  const skippable =
    head.length === 4 && (head[0] & 0xf0) === 0x50 && head[1] === 0x2a && head[2] === 0x4d && head[3] === 0x18
  if (skippable) {
    console.log(
      `Note: ${label} starts with a zstd SKIPPABLE frame (bytes ${hex}, magic family 0x184D2A5x). ` +
        `That is valid zstd container data — the system 'zstd' binary skips it; node:zlib may not.`,
    )
    return
  }
  const preview = await peekBytes(stream, 200)
  const text = preview.toString('utf8').replace(/[^\x20-\x7e\n\t]/g, '.')
  fail(
    `${label} does not start with the zstd magic (expected 28 b5 2f fd, got ${hex}) ` +
      `and is not a zstd skippable frame (0x184D2A5x) either. This is probably an HTML/text ` +
      `error page from a proxy or CDN, not the dump. First ${preview.length} bytes as text:\n---\n${text}\n---`,
  )
}

/**
 * zstd decompression stage. PREFERS the system `zstd` binary (preinstalled
 * on ubuntu-latest; `--long=31` handles the long-window/multi-frame archives
 * that node:zlib's ZstdDecompress rejects with ZSTD_error_prefix_unknown /
 * frame errors on the Lichess dumps). Falls back to node:zlib with
 * windowLogMax raised to the format maximum. Fails clearly if neither exists.
 *
 * Every failure mode (spawn error, non-zero exit, stderr output, stream
 * errors) is routed through failStage so the run aborts before writing.
 * Returns { stream, done } — `done` MUST be awaited after the scan so a
 * decompressor that died mid-stream (ending the line stream early) cannot
 * pass as a successful, shorter scan.
 */
function zstdDecompress(source, failStage) {
  for (const [bin, binArgs] of [
    ['zstd', ['-dc', '--long=31', '-']],
    ['unzstd', ['-c', '--long=31', '-']],
  ]) {
    const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' })
    if (probe.error) continue
    console.log(`Decompressing via system '${bin}' (--long=31: handles long-window/multi-frame archives)`)
    const child = spawn(bin, binArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderrText = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => {
      stderrText += d
    })
    const done = new Promise((resolve, reject) => {
      child.on('error', (err) => reject(new Error(`could not run '${bin}': ${err.message}`)))
      child.on('close', (code) => {
        const stderr = stderrText.trim()
        if (code !== 0) {
          reject(new Error(`'${bin}' exited with code ${code}${stderr ? `; stderr: ${stderr}` : ''}`))
        } else if (stderr) {
          reject(new Error(`'${bin}' exited 0 but wrote to stderr (treated as failure): ${stderr}`))
        } else {
          resolve()
        }
      })
    })
    done.catch(failStage(`system ${bin}`)) // fail fast mid-scan; also marks the rejection handled
    child.stdin.on('error', failStage(`${bin} stdin`))
    child.stdout.on('error', failStage(`${bin} stdout`))
    source.on('error', () => child.stdin.destroy())
    source.pipe(child.stdin)
    return { stream: child.stdout, done: done.catch(() => {}) }
  }

  if (typeof zlib.createZstdDecompress === 'function') {
    console.log(
      "No system 'zstd' on PATH — falling back to node:zlib ZstdDecompress. " +
        "If this fails on a frame error, install zstd (apt install zstd / brew install zstd) and rerun.",
    )
    const opts = {}
    if (zlib.constants && typeof zlib.constants.ZSTD_d_windowLogMax === 'number') {
      // Raise the decompression window to the format maximum (2^31) so
      // --long-compressed archives don't get rejected outright.
      opts.params = { [zlib.constants.ZSTD_d_windowLogMax]: 31 }
    }
    let z
    try {
      z = zlib.createZstdDecompress(opts)
    } catch {
      z = zlib.createZstdDecompress() // params unsupported on this Node — best effort
    }
    z.on('error', failStage('zstd decompression (node:zlib)'))
    source.on('error', (err) => z.destroy(err))
    return { stream: source.pipe(z), done: Promise.resolve() }
  }

  fail(
    "no zstd decompressor available. Install the 'zstd' CLI (apt install zstd / " +
      'brew install zstd) — preferred — or run Node >= 22.15 (node:zlib ' +
      'createZstdDecompress), then rerun.',
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

  const { stream: rawStream, lastModified, compressed } = await openSource(args.input)

  const sourceDate =
    args.sourceDate ??
    (lastModified
      ? new Date(lastModified).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10))

  const rng = mulberry32(hashSeed(`${SEED_BASE}:${sourceDate}`))
  console.log(`Source date: ${sourceDate} (PRNG seeded from '${SEED_BASE}:${sourceDate}' — reruns on the same dump are reproducible)`)

  // -- Fail-fast wiring: an 'error' on ANY pipeline stage (download body,
  //    decompressor, child process, readline) rejects the scan, and output
  //    is only ever written after the scan finished with no recorded error.
  let pipelineError = null
  let rejectPipeline
  const pipelineFailed = new Promise((_, reject) => {
    rejectPipeline = reject
  })
  pipelineFailed.catch(() => {}) // handled via Promise.race; silence late rejections
  const failStage = (stage) => (err) => {
    const wrapped = new Error(`${stage} failed: ${err && err.message ? err.message : err}`)
    if (!pipelineError) pipelineError = wrapped
    rejectPipeline(wrapped)
  }
  rawStream.on('error', failStage(compressed ? 'download/read stream' : 'input stream'))

  let dataStream = rawStream
  let decompressorDone = Promise.resolve()
  if (compressed) {
    await assertZstdMagic(rawStream, args.input)
    const dec = zstdDecompress(rawStream, failStage)
    dataStream = dec.stream
    decompressorDone = dec.done
  }

  const lines = createInterface({ input: dataStream, crlfDelay: Infinity })
  lines.on('error', failStage('readline'))

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

  const scan = async () => {
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
    // The line stream ended — but a decompressor that died mid-stream also
    // ends it early. Wait for the decompressor's verdict and let pending
    // 'error' events land before declaring the scan complete.
    await decompressorDone
    await new Promise((resolve) => setImmediate(resolve))
    if (pipelineError) throw pipelineError
  }

  await Promise.race([scan(), pipelineFailed])

  console.log(`\nScanned ${rows.toLocaleString('en-US')} rows; ${candidates.toLocaleString('en-US')} passed the filters.`)

  if (candidates === 0) {
    fail(
      '0 rows passed the filters — refusing to write output. With the real Lichess dump this ' +
        'always means the download or decompression silently produced no usable data.',
    )
  }

  // Verification pass: every sampled puzzle must replay through chess.js.
  let droppedInvalid = 0
  const perMotif = new Map()
  for (const motif of MOTIFS) {
    const kept = []
    for (let b = 0; b < RATING_BANDS.length; b++) {
      for (const p of buckets.get(`${motif.id}:${b}`).items) {
        if ((p.moves.length === 4 || p.moves.length === 6 || p.moves.length === 8) && replays(p)) {
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

  const grandTotal = [...perMotif.values()].reduce((sum, list) => sum + list.length, 0)
  if (grandTotal === 0) {
    fail('every sampled puzzle failed chess.js verification — refusing to write output.')
  }

  // Write output — only reached after a fully successful scan: compact
  // per-theme files + pretty manifest.
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

  const manifest = {
    source: 'lichess_db_puzzle',
    sourceDate,
    generatedAt: new Date().toISOString(),
    license: 'CC0-1.0',
    ratingMin: RATING_MIN,
    ratingMax: RATING_MAX,
    total: grandTotal,
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
  console.log(`  total ${grandTotal} problems; ${droppedInvalid} sampled row(s) dropped by chess.js verification`)
  console.log('\nReminder (PLAN.md §8.2): commit only public/problems/*.json — the raw CSV is never committed.')
  process.exit(0) // don't let a lingering stream/child keep the event loop alive
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)))
