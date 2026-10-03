import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // A different appId from the shopkeeper app (com.shopbookidris.app), so the
  // two install side by side on the owner's phone.
  appId: 'com.shopbookidris.watcher',
  appName: 'مراقب البقالة',
  webDir: 'dist',
  plugins: {
    // Same reason as the shopkeeper app: the server has no CORS middleware, so
    // calls go through native HTTP instead of the WebView.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
