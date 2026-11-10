// Persists the auth session (JWT) across app launches.
//
// For now this uses localStorage, which works in the browser AND inside the
// Capacitor WebView. When we add the offline data layer we'll likely move this
// to @capacitor/preferences for a proper native store; the rest of the app only
// touches these three functions, so that swap stays isolated here.

const TOKEN_KEY = 'daftar.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PHONE_KEY);
  localStorage.removeItem(DRIVE_KEY);
  localStorage.removeItem(POS_KEY);
  localStorage.removeItem(POS_STAFF_KEY);
  localStorage.removeItem(STAFF_KEY);
  localStorage.removeItem(POS_NOTES_KEY);
}

// Whether the owner granted this account Google Drive backup — remembered so the
// section still shows offline. Refreshed from GET /me on every launch.
const DRIVE_KEY = 'daftar.drive-allowed';

export function getDriveAllowed(): boolean {
  return localStorage.getItem(DRIVE_KEY) === '1';
}

export function setDriveAllowed(on: boolean): void {
  if (on) localStorage.setItem(DRIVE_KEY, '1'); else localStorage.removeItem(DRIVE_KEY);
}

// Whether the owner switched the point-of-sale section on for this account —
// remembered so it still opens offline. Refreshed from GET /me on every launch.
const POS_KEY = 'daftar.pos-allowed';

export function getPosAllowed(): boolean {
  return localStorage.getItem(POS_KEY) === '1';
}

export function setPosAllowed(on: boolean): void {
  if (on) localStorage.setItem(POS_KEY, '1'); else localStorage.removeItem(POS_KEY);
}

// The signed-in phone. The token carries only the user id, and the app needs
// the phone to know whether this is the owner's own account (see isOwner).
const PHONE_KEY = 'daftar.phone';

export function getPhone(): string | null {
  return localStorage.getItem(PHONE_KEY);
}

export function setPhone(phone: string): void {
  localStorage.setItem(PHONE_KEY, phone);
}

// Whether the developer switched POS staff accounts on for this (owner's)
// account. Refreshed from GET /me on every launch.
const POS_STAFF_KEY = 'daftar.pos-staff-allowed';

export function getPosStaffAllowed(): boolean {
  return localStorage.getItem(POS_STAFF_KEY) === '1';
}

export function setPosStaffAllowed(on: boolean): void {
  if (on) localStorage.setItem(POS_STAFF_KEY, '1'); else localStorage.removeItem(POS_STAFF_KEY);
}

// A STAFF session (cashier / adder / admin of someone's shop): who they are and
// what they may do. Present only when the token is a staff token. Refreshed
// from GET /auth/staff/me on every launch; the server enforces it regardless.
const STAFF_KEY = 'daftar.staff';

export interface StoredStaff {
  id: string; name: string; role: string; permissions: string[]; store_name: string | null;
}

export function getStaff(): StoredStaff | null {
  try {
    const raw = localStorage.getItem(STAFF_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredStaff;
    return v && typeof v.id === 'string' && Array.isArray(v.permissions) ? v : null;
  } catch {
    return null;
  }
}

export function setStaff(staff: StoredStaff): void {
  localStorage.setItem(STAFF_KEY, JSON.stringify(staff));
}

// Whether this shop's POS notes are switched on (developer, Watcher). For the
// owner from GET /me, for a staff member from /auth/staff/me.
const POS_NOTES_KEY = 'daftar.pos-notes-allowed';

export function getPosNotesAllowed(): boolean {
  return localStorage.getItem(POS_NOTES_KEY) === '1';
}

export function setPosNotesAllowed(on: boolean): void {
  if (on) localStorage.setItem(POS_NOTES_KEY, '1'); else localStorage.removeItem(POS_NOTES_KEY);
}
