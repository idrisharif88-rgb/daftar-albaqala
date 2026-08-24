// Where the app talks to the backend.
//  - Dev (browser): defaults to '/api', which Vite proxies to the local server
//    (http://localhost:3002) — see vite.config.ts. No CORS in development.
//  - Device/production builds: set VITE_API_BASE to the full URL, e.g.
//    https://shopbook.shahed.uk
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

// Features that belong to the OWNER's build, not the shopkeeper's.
//
// Editing a contact's name, phone or role is one of them. It reads like a
// convenience, but each of the three rewrites history that other people rely
// on: the phone is who the notifications were sent to, and the role decides
// what every past and future message CALLS the entries — flipping it turns
// «تسجيل دين» into «تسديد دفعة» across the whole history at once. That is a
// decision the owner should make deliberately, after hearing the reason, not
// something a user does on their own device.
//
// The screen is built and works; it is gated here so the owner build can turn
// it on (`VITE_OWNER_BUILD=1`) alongside the account-activation tools when
// those land.
export const OWNER_BUILD = import.meta.env.VITE_OWNER_BUILD === '1';

export const FEATURES = {
  /** Pencil on the contact screen: edit name / phone / note / role. */
  editContacts: OWNER_BUILD,
};

/**
 * The privacy policy, served by the API itself (server/public/privacy.html).
 *
 * It lives on the same host as the API on purpose: nginx already proxies
 * everything there, so there is nothing extra to configure and nothing that can
 * be reachable in the app but not on the web. A link to a page that 404s is
 * worse than no link at all.
 */
export const PRIVACY_URL = 'https://shopbook.shahed.uk/privacy.html';
