/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// EN: The example plugin lives one folder up (../plugins-available) so the
//     command-line host and this app share ONE copy; Vite may read it via ?raw.
// NO: Eksempelpluginen ligger én mappe opp, så kommandolinje-verten og appen
//     deler ÉN kopi; Vite får lese den via ?raw.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  test: { include: ['src/**/*.test.ts'] },
});
