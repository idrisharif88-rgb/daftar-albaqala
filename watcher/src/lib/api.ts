// The Watcher's only link to the server: the /admin routes (server/src/routes/admin.ts).
// Online-only on purpose — the Watcher holds no copy of anyone's book.

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const TOKEN_KEY = 'watcher_token';
const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable — the session just won't survive a restart */ }
}

// Called when the server says the admin token is no longer good (12h expiry).
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await Promise.race([
      fetch(`${API_BASE}${path}`, { ...options, headers }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS)
      ),
    ]);
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/admin/login') onUnauthorized();
    throw new ApiError(res.status, messageFor(res.status));
  }
  return body as T;
}

function messageFor(status: number): string {
  switch (status) {
    case 401: return 'البيانات غير صحيحة';
    case 429: return 'محاولات كثيرة. حاول بعد ١٥ دقيقة';
    case 503: return 'لوحة المراقبة غير مُعدّة على الخادم';
    case 404: return 'الحساب غير موجود';
    default: return `خطأ ${status}`;
  }
}

export type Status = 'none' | 'active' | 'expired' | 'suspended';

export interface Account {
  id: string;
  phone: string;
  store_name: string | null;
  plan: string;
  subscription_status: Status;
  subscription_expires_at: string | null;
  created_at: string;
  customers_count: number;
  transactions_count: number;
  last_activity_at: string | null;
}

export function adminLogin(phone: string, password: string, code: string): Promise<{ token: string }> {
  return request('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password, code }),
  });
}

export async function listAccounts(): Promise<Account[]> {
  const res = await request<{ users: Account[] }>('/admin/users');
  return res.users;
}

export function setAccountStatus(id: string, status: 'active' | 'suspended'): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}
