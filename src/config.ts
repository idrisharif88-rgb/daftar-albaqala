// Where the app talks to the backend.
//  - Dev (browser): defaults to '/api', which Vite proxies to the local server
//    (http://localhost:3002) — see vite.config.ts. No CORS in development.
//  - Device/production builds: set VITE_API_BASE to the full URL, e.g.
//    https://shopbook.shahed.uk
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
