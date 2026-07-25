import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Problem, ProblemManifest } from '../types'
import { createProblemSource, SOLUTION_MOVES_LENGTHS } from './loader'

// ---------------------------------------------------------------------------
// Fixtures — structurally valid data in the shape build-problems.mjs writes.
// The loader's validation is structural only (chess.js replay is the data
// test's job), so the moves just need to be well-formed UCI strings.
// ---------------------------------------------------------------------------

/** A well-formed problem with `userMoves` user moves plus the setup move. */
function problem(id: string, userMoves: number): Problem {
  const plies = userMoves * 2 // setup move + user moves + opponent replies
  const moves = Array.from({ length: plies }, (_, i) => (i % 2 === 0 ? 'e2e4' : 'e7e5'))
  return { id, fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves, rating: 1800, themes: ['fork'] }
}

const MANIFEST: ProblemManifest = {
  source: 'lichess_db_puzzle',
  sourceDate: '2026-07-01',
  generatedAt: '2026-07-24T16:02:20.790Z',
  license: 'CC0-1.0',
  ratingMin: 1400,
  ratingMax: 2500,
  total: 3,
  themes: [
    {
      id: 'fork',
      name: 'Fork',
      description: 'One piece attacks two targets at once.',
      file: 'fork.json',
      count: 3,
    },
  ],
}

/** Stub global fetch to serve `files` keyed by path under /problems. */
function stubFetch(files: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = files[url]
      if (body === undefined) return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => body }
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createProblemSource', () => {
  it('accepts every solution length the data pipeline produces (2–4 movers)', async () => {
    // Regression: the bundled set gained 4-move (8-ply) `veryLong` lines and
    // the validator still only allowed 4/6 plies, which killed every theme
    // file at runtime. One problem per allowed length proves the whole range.
    const problems = SOLUTION_MOVES_LENGTHS.map((plies, i) => problem(`p${i}`, plies / 2))
    stubFetch({
      '/problems/manifest.json': MANIFEST,
      '/problems/fork.json': problems,
    })
    const source = createProblemSource('/problems')
    await expect(source.theme('fork')).resolves.toHaveLength(SOLUTION_MOVES_LENGTHS.length)
  })

  it('rejects a theme file containing a solution of an unexpected length', async () => {
    stubFetch({
      '/problems/manifest.json': MANIFEST,
      '/problems/fork.json': [problem('ok', 2), problem('too-long', 5)],
    })
    const source = createProblemSource('/problems')
    await expect(source.theme('fork')).rejects.toThrow(/malformed problem/)
  })

  it('rejects an unknown theme id', async () => {
    stubFetch({ '/problems/manifest.json': MANIFEST })
    const source = createProblemSource('/problems')
    await expect(source.theme('nope')).rejects.toThrow(/Unknown problem theme/)
  })

  it('caches the manifest and theme files in memory', async () => {
    const fork = [problem('p1', 2)]
    stubFetch({
      '/problems/manifest.json': { ...MANIFEST, total: 1, themes: [{ ...MANIFEST.themes[0], count: 1 }] },
      '/problems/fork.json': fork,
    })
    const source = createProblemSource('/problems')
    await source.theme('fork')
    await source.theme('fork')
    await source.manifest()
    // One fetch for the manifest, one for the theme file — repeats hit cache.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2)
  })
})
