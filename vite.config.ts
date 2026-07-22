import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Ivan is a browser-only SPA (no backend, no secrets — AGENTS.md invariant 6).
// The PWA layer is a static, install-and-offline shell over that same SPA:
// vite-plugin-pwa generates the web manifest and a Workbox service worker.
//
// Base-URL aware: the deploy workflow builds with `--base=/<repo>/` for GitHub
// Pages, and the plugin reads Vite's resolved base, so the manifest link, the
// service-worker registration/scope, and every cached URL below resolve under
// the deploy base exactly like the engine worker and problem JSON already do.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ship SW updates silently: a new deploy's worker takes over on next load.
      registerType: 'autoUpdate',
      // Precache these too (they live in public/, not in the module graph).
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Ivan — Chess Coach',
        short_name: 'Ivan',
        description:
          'An interactive chess coach that teaches openings and tactics by playing them with you, commenting on every move.',
        // Meadow theme (see src/index.css): green UI chrome, pale-green splash.
        theme_color: '#4f9a6f',
        background_color: '#e6efe1',
        display: 'standalone',
        // start_url / scope are intentionally omitted: the browser defaults them
        // to the manifest's own directory (= Vite's base), which is correct for
        // both the local root and the /<repo>/ GitHub Pages base.
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell: everything hashed in the build. The 7 MB Stockfish .wasm is
        // deliberately NOT precached (it exceeds the size cap) — it is runtime-
        // cached on first use below, so the install stays light.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        cleanupOutdatedCaches: true,
        // SPA: unknown navigations fall back to the app shell.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Stockfish worker script + WASM — large, immutable, hashed by build.
            urlPattern: ({ url }) => url.pathname.includes('/engine/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ivan-engine',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 8 },
            },
          },
          {
            // Bundled Lichess problem sets (committed, CC0). Revalidate so a data
            // refresh is picked up, but serve instantly from cache meanwhile.
            urlPattern: ({ url }) => url.pathname.includes('/problems/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ivan-problems',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 32 },
            },
          },
          {
            // Google Fonts stylesheet (see index.html).
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            // Google Fonts webfont files.
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // NOTE: the BYOK reasoning coach's requests to api.anthropic.com are
          // intentionally absent here — no route means the service worker never
          // intercepts, caches, or logs them (ADR-0003; AGENTS.md invariant 6).
        ],
      },
    }),
  ],
})
