import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: the app calls '/api/*' and Vite forwards it to the droplet (no CORS).
// Device builds use VITE_API_BASE from .env.production instead.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // WATCHER_API_TARGET=http://localhost:3002 npm run dev → a local backend.
        target: process.env.WATCHER_API_TARGET ?? 'https://shopbook.shahed.uk',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
