import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
// @ts-ignore -- Node builtin: vitest runs this in Node, but @types/node isn't
// installed in this browser-first repo, so the import has no declarations.
import { existsSync, readFileSync } from 'node:fs'
import type { Problem, ProblemManifest } from '../types'

/**
 * Proof for the bundled problem data (PLAN.md §8.2, ADR-0003): like opening
 * data, every committed problem must replay through chess.js. The data is
 * generated — not hand-written — by scripts/build-problems.mjs, which runs
 * in the `refresh-problems` GitHub workflow (or locally) and commits
 * public/problems/**. This suite fails loudly when that output is missing.
 */

const problemsDir = new URL('../../public/problems/', import.meta.url)
const manifestUrl = new URL('manifest.json', problemsDir)

const MISSING_MANIFEST_MESSAGE =
  'public/problems/manifest.json is missing — the bundled problem set has not been generated yet. ' +
  'Run the refresh-problems GitHub workflow (or locally: `node scripts/build-problems.mjs`, needs ' +
  'network access to database.lichess.org) to build public/problems/** from the Lichess puzzle dump, ' +
  'then commit the generated JSON. The raw CSV itself is never committed (PLAN.md §8.2, ADR-0003).'

/** UCI string ("e2e4", "e7e8q") → chess.js move object. */
function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined,
  }
}

if (!existsSync(manifestUrl)) {
  describe('bundled problem data (public/problems)', () => {
    it('has a generated manifest.json', () => {
      throw new Error(MISSING_MANIFEST_MESSAGE)
    })
  })
} else {
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as ProblemManifest

  describe('problem manifest', () => {
    it('matches the ProblemManifest contract', () => {
      expect(manifest.source).toBe('lichess_db_puzzle')
      expect(manifest.sourceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(manifest.generatedAt))).toBe(false)
      expect(manifest.license).toBe('CC0-1.0')
      // The rating spread is a build-script tunable (widened over time), so
      // the contract test asserts a sane, ordered range rather than pinning
      // exact bounds — the per-problem checks below enforce membership.
      expect(typeof manifest.ratingMin).toBe('number')
      expect(typeof manifest.ratingMax).toBe('number')
      expect(manifest.ratingMin).toBeGreaterThanOrEqual(1000)
      expect(manifest.ratingMax).toBeGreaterThan(manifest.ratingMin)
      expect(typeof manifest.total).toBe('number')
      expect(Array.isArray(manifest.themes)).toBe(true)
      expect(manifest.themes.length).toBeGreaterThan(0)
    })

    it('describes every theme for the picker', () => {
      for (const theme of manifest.themes) {
        expect(theme.id.length).toBeGreaterThan(0)
        expect(theme.name.length).toBeGreaterThan(0)
        expect(theme.description.length).toBeGreaterThan(10)
        expect(theme.file).toBe(`${theme.id}.json`)
        expect(theme.count).toBeGreaterThan(0)
      }
    })

    it('total equals the sum of per-theme counts', () => {
      const sum = manifest.themes.reduce((acc, t) => acc + t.count, 0)
      expect(manifest.total).toBe(sum)
    })
  })

  const seenIds = new Map<string, string>() // problem id -> theme file it appeared in

  for (const theme of manifest.themes) {
    describe(`theme file ${theme.file}`, () => {
      const fileUrl = new URL(theme.file, problemsDir)

      it('exists and holds exactly the manifest count', () => {
        expect(existsSync(fileUrl), `${theme.file} is missing from public/problems/`).toBe(true)
        const problems = JSON.parse(readFileSync(fileUrl, 'utf8')) as Problem[]
        expect(Array.isArray(problems)).toBe(true)
        expect(problems).toHaveLength(theme.count)
      })

      it('every problem is well-formed and replays through chess.js', () => {
        const problems = JSON.parse(readFileSync(fileUrl, 'utf8')) as Problem[]
        for (const problem of problems) {
          expect(typeof problem.id).toBe('string')
          expect(problem.id.length).toBeGreaterThan(0)

          // Unique id across ALL theme files (each puzzle ships in one file).
          const dupe = seenIds.get(problem.id)
          expect(dupe, `problem ${problem.id} appears in both ${dupe} and ${theme.file}`).toBeUndefined()
          seenIds.set(problem.id, theme.file)

          expect(
            problem.rating,
            `problem ${problem.id} rating out of range`,
          ).toBeGreaterThanOrEqual(manifest.ratingMin)
          expect(problem.rating).toBeLessThanOrEqual(manifest.ratingMax)

          expect(problem.themes).toContain(theme.id)

          // 2–4 user moves plus the opponent's setup move (moves[0]).
          expect(
            [4, 6, 8],
            `problem ${problem.id} has ${problem.moves.length} moves (want 4, 6, or 8)`,
          ).toContain(problem.moves.length)

          // FEN parses, every UCI move legal in sequence.
          let chess!: Chess
          expect(() => {
            chess = new Chess(problem.fen)
          }, `problem ${problem.id} has an invalid FEN: ${problem.fen}`).not.toThrow()
          for (const uci of problem.moves) {
            expect(
              () => chess.move(uciToMove(uci)),
              `problem ${problem.id}: illegal move '${uci}' after ${chess.history().join(' ')}`,
            ).not.toThrow()
          }
        }
      })
    })
  }
}
