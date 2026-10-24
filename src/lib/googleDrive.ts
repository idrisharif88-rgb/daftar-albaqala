import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { expectReturn } from './biometric';

// Google Drive — the app's HIDDEN folder in the grocer's own Drive. Copied from
// «خماسيات».
//
// Scope `drive.appdata` only: the app sees the files it wrote and nothing else
// in the grocer's Drive. The access token lives about an hour and is kept on
// the device so the daily backup can run without opening Google's window.
//
// Needs VITE_GOOGLE_WEB_CLIENT_ID (the WEB OAuth client of this app's Google
// Cloud project; the Android clients there carry the debug and release SHA-1s).
// Without it the feature stays hidden.
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '';
export const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID);

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'daftar.google-token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const MARGIN_MS = 5 * 60 * 1000; // a token expiring within five minutes counts as expired

interface SavedToken {
  token: string | null;
  expiresAt: number;
  email: string | null;
}

let initialized: Promise<unknown> | null = null;
const init = () => {
  if (!initialized) {
    initialized = SocialLogin.initialize({ google: { webClientId: GOOGLE_CLIENT_ID, mode: 'online' } });
    initialized.catch(() => { initialized = null; });
  }
  return initialized;
};

const readToken = (): SavedToken | null => {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null'); } catch { return null; }
};
const writeToken = (value: SavedToken | null) => {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage failure: the next backup asks again */ }
};

/** The linked Google account's address, if any — it outlives the token. */
export const linkedEmail = (): string | null => readToken()?.email || null;

const freshExpiry = () => Date.now() + 55 * 60 * 1000;

// Silent renewal for an account linked before (Android): Google picks the same
// authorised account with no chooser, and Drive was already granted.
async function renewSilently(saved: SavedToken | null): Promise<string | null> {
  if (!saved?.email || !Capacitor.isNativePlatform()) return null;
  try {
    await init();
    await SocialLogin.refresh({ provider: 'google', options: { scopes: ['email', SCOPE] } } as never);
    const { accessToken } = await SocialLogin.getAuthorizationCode({ provider: 'google' }) as { accessToken?: string };
    if (!accessToken) return null;
    writeToken({ ...saved, token: accessToken, expiresAt: freshExpiry() });
    return accessToken;
  } catch {
    return null;
  }
}

/**
 * A valid Drive token. `interactive: false` never opens Google's window: it
 * tries a silent renewal only, else null.
 */
export async function getAccessToken({ interactive }: { interactive: boolean }): Promise<string | null> {
  const saved = readToken();
  if (saved?.token && saved.expiresAt - MARGIN_MS > Date.now()) return saved.token;
  const renewed = await renewSilently(saved);
  if (renewed) return renewed;
  if (!interactive) return null;
  await init();
  expectReturn(); // Google opens its own account screen
  const { result } = await SocialLogin.login({
    provider: 'google', options: { scopes: ['email', SCOPE] },
  }) as { result: { accessToken?: { token?: string; expires?: string }; profile?: { email?: string } } };
  const token = result?.accessToken?.token;
  if (!token) throw new Error('لم يمنح Google صلاحية Drive');
  const expires = result.accessToken?.expires ? new Date(result.accessToken.expires).getTime() : NaN;
  writeToken({
    token,
    expiresAt: Number.isFinite(expires) ? expires : freshExpiry(),
    email: result.profile?.email || saved?.email || null,
  });
  return token;
}

export async function unlinkGoogle(): Promise<void> {
  writeToken(null);
  try { await init(); await SocialLogin.logout({ provider: 'google' }); } catch { /* was not linked */ }
}

class DriveError extends Error {
  constructor(public status: number) { super(`drive http ${status}`); }
}

async function drive(token: string, url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    const saved = readToken();
    writeToken(saved ? { ...saved, token: null, expiresAt: 0 } : null);
  }
  if (!res.ok) throw new DriveError(res.status);
  return res;
}

export interface DriveFile { id: string; modifiedTime: string; size?: string }

export async function findFile(token: string, name: string): Promise<DriveFile | null> {
  const q = encodeURIComponent(`name = '${name}'`);
  const res = await drive(token, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)`);
  return (await res.json()).files?.[0] || null;
}

/** Create the file, or replace its content — one multipart request carries the
 *  metadata and the body. */
export async function saveFile(token: string, name: string, text: string): Promise<DriveFile> {
  const existing = await findFile(token, name);
  const boundary = 'daftar' + Date.now();
  const metadata = existing ? {} : { name, parents: ['appDataFolder'] };
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata),
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', text,
    `--${boundary}--`, '',
  ].join('\r\n');
  const url = existing
    ? `${UPLOAD}/files/${existing.id}?uploadType=multipart&fields=id,modifiedTime,size`
    : `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime,size`;
  const res = await drive(token, url, {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json();
}

export async function readFile(token: string, id: string): Promise<string> {
  return (await drive(token, `${API}/files/${id}?alt=media`)).text();
}
