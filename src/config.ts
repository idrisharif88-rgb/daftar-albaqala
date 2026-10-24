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

// The owner's own login. Owner-only tools («دفتر التحديثات») show on this
// account and no other. Compared by its last 9 digits, so it matches whether
// the number was stored with the 967 country code or without.
export const OWNER_PHONE = '781215102';

export const isOwnerPhone = (phone: string | null | undefined): boolean =>
  !!phone && phone.replace(/\D/g, '').endsWith(OWNER_PHONE);

export const FEATURES = {
  /** Pencil on the contact screen: edit name / phone / note / role. */
  editContacts: OWNER_BUILD,
};

/**
 * The privacy policy, published on GitHub Pages from `docs/privacy.html`.
 *
 * It is NOT served from the API host any more: the page is handed to anyone who
 * asks — users, Google Play, Google's OAuth review — and it has no business
 * pointing them at the machine that holds everyone's books. GitHub Pages also
 * stays up when the droplet does not, and a privacy link that 404s reads as an
 * app hiding what it does.
 *
 * The page itself no longer names the server either; it says what is stored and
 * how it travels, which is what a reader actually needs.
 */
export const PRIVACY_URL = 'https://idrisharif88-rgb.github.io/daftar-albaqala/privacy.html';
