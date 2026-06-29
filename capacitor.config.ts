import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'daftar-albaqala',
  webDir: 'dist',
  plugins: {
    // Route fetch/XHR through native HTTP instead of the WebView, so calls to
    // the droplet (https://shopbook.shahed.uk) aren't blocked by CORS. The dev
    // browser still uses the Vite proxy; this only affects the native app.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
