import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

import { joinBasePath, resolvePagesBasePath } from './src/pwa/base-path';

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const base = resolvePagesBasePath(environment);
  return {
    base,
    plugins: [
      react(),
      ...VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'],
        manifest: {
          id: base,
          name: '澳門巴士',
          short_name: '澳門巴士',
          description: '澳門巴士路線、站點及即時觀測。',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#ffffff',
          lang: 'zh-Hant',
          dir: 'ltr',
          icons: [
            { src: joinBasePath(base, 'icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: joinBasePath(base, 'icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: joinBasePath(base, 'icons/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,png,svg,ico,json}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          minify: false,
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:3001',
      },
    },
    preview: {
      port: 4173,
    },
    test: {
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'scripts/**/*.test.ts',
        'server/**/*.test.ts',
        'tests/netlify/**/*.test.ts',
      ],
      passWithNoTests: false,
    },
  };
});
