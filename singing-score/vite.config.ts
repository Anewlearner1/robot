/// <reference types="vitest/config" />
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Matches the dark --bg in src/index.css (dark mode first).
const THEME = '#111017'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      // No `virtual:pwa-register` import in the app → the plugin injects registerSW.js into index.html.
      injectRegister: 'auto',
      // public/ icons are already matched by workbox.globPatterns; avoid duplicate precache entries.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: '唱歌評分',
        short_name: '唱歌評分',
        description: '錄下自己唱歌，離線分析音準、節奏、氣息與顫音，追蹤進步。',
        lang: 'zh-Hant',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME,
        background_color: THEME,
        categories: ['music', 'education'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Precache every build asset so the app (incl. the analysis Web Worker chunk and the
        // AudioWorklet module, both emitted as .js/.mjs) works fully offline after the first load.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,json,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  test: {
    environment: 'node',
  },
})
