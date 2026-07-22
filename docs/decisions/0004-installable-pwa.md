# 0004 — Ship the app as an installable, offline-capable PWA

- **Status:** Accepted
- **Date:** 2026-07-22

## Context
Ivan is a browser-only SPA already deployed as a static site to GitHub Pages (ADR-0002,
PLAN.md Milestone 4). The owner wanted it installable to a phone/desktop home screen and
usable without a live connection after the first visit. Because the whole app — board,
engine, opening book, problems — runs client-side with no backend, a Progressive Web App
is a natural fit: no server work, just a web manifest plus a service worker for caching.

## Decision
- **Add `vite-plugin-pwa`** (build-time dev dependency, Workbox under the hood). It
  generates `manifest.webmanifest` and a service worker (`sw.js`) at build time; the SW
  registration script is auto-injected into `index.html`.
- **`registerType: 'autoUpdate'`** — a new deploy's service worker takes over on the next
  load; no update prompt UI to maintain.
- **Caching strategy tuned to the asset sizes:**
  - *Precache* the hashed app shell (JS/CSS/HTML), icons, and the small engine loader JS
    (~837 KiB total).
  - The 7 MB Stockfish `.wasm` is **runtime-cached** (`CacheFirst`) on first use, not
    precached, so the install stays light while offline play still works after one visit.
  - Bundled Lichess problem JSON is `StaleWhileRevalidate` (instant from cache, refreshes
    in the background).
  - Google Fonts stylesheet/webfonts are runtime-cached so the UI font survives offline.
- **The BYOK Anthropic requests are deliberately never given a cache route** — the service
  worker does not intercept, cache, or log `api.anthropic.com` traffic (see Consequences).
- **Icons** are a white chess-knight glyph on the meadow-green gradient: `pwa-192`,
  `pwa-512`, a full-bleed `maskable-512`, an `apple-touch-icon`, and a `favicon`, all in
  `public/`.
- **Base-URL aware:** the plugin reads Vite's resolved `base`, so the manifest link, SW
  scope/registration, `start_url`, and every cached URL resolve correctly under both the
  local root and the `/<repo>/` GitHub Pages base (the deploy workflow's `--base` flag).

## Consequences
- The app is installable and works offline after the first visit, with no backend added —
  AGENTS.md invariant 6 ("browser-only, no backend, no secrets") is preserved.
- **A future agent must NOT add a runtime-caching route for `api.anthropic.com`** (or any
  authenticated/personal endpoint). Doing so would let the service worker cache the user's
  BYOK key material or responses on disk, violating ADR-0003 and invariant 6. The absence
  of that route is intentional and load-bearing.
- The service worker is a new moving part: after a deploy, clients update on next load. If
  a cache ever serves stale assets, `cleanupOutdatedCaches` plus a hard reload / SW
  unregister clears it. Precache is content-hashed, so shell updates are automatic.
- CI is unchanged (`typecheck && test && build`); the PWA artifacts are produced by the
  existing `vite build` step and deployed by the existing Pages workflow.
