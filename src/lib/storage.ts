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
}
