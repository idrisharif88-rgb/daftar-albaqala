import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shopbookidris.app',
  appName: 'دفتر البقالة',
  webDir: 'dist',
  // Brand green behind the page. The WebView itself is held invisible until
  // its first frame is ready (MainActivity.holdWebViewUntilPainted), so the
  // launch window's basket is what shows meanwhile — never black, never white.
  backgroundColor: '#1b5e20',
  plugins: {
    // Route fetch/XHR through native HTTP instead of the WebView, so calls to
    // the droplet (https://shopbook.shahed.uk) aren't blocked by CORS. The dev
    // browser still uses the Vite proxy; this only affects the native app.
    CapacitorHttp: {
      enabled: true,
    },
    // Google sign-in is used for the Drive backup and nothing else. The plugin
    // bundles Facebook, Apple and Twitter by default — and Facebook's SDK brings
    // advertising-ID permissions (AD_ID, ADSERVICES_*) that Play would make us
    // declare for an app with no ads. Its sync hook turns this into
    // gradle.properties; editing gradle.properties directly is overwritten.
    SocialLogin: {
      providers: { google: true, facebook: false, apple: false, twitter: false },
    },
  },
};

export default config;
