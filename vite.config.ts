/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy()
  ],
  // jeep-sqlite is a Stencil component that lazy-loads its own chunks; Vite's
  // dep pre-bundler mangles them ("file does not exist in deps directory").
  // Excluding it lets the browser load it straight from node_modules.
  optimizeDeps: {
    exclude: ['jeep-sqlite'],
  },
  // Dev-only proxy: the app calls relative '/api/*' and Vite forwards it on, so
  // there's no CORS in development. On device builds the app uses VITE_API_BASE
  // (a full https URL) instead — see src/config.ts.
  //   target = the DROPLET (real server) — sync now reaches shopbook.shahed.uk.
  //   To go back to the local backend, set target to 'http://localhost:3002'.
  server: {
    proxy: {
      '/api': {
        target: 'https://shopbook.shahed.uk',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  }
})
