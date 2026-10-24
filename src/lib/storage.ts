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

// The signed-in phone. The token carries only the user id, and the app needs
// the phone to know whether this is the owner's own account (see isOwner).
const PHONE_KEY = 'daftar.phone';

export function getPhone(): string | null {
  return localStorage.getItem(PHONE_KEY);
}

export function setPhone(phone: string): void {
  localStorage.setItem(PHONE_KEY, phone);
}
