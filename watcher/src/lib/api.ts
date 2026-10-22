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
    case 403: return 'رمز التحقق غير صحيح أو مُستخدَم';
    case 429: return 'محاولات كثيرة. حاول بعد ١٥ دقيقة';
    case 503: return 'لوحة المراقبة غير مُعدّة على الخادم';
    case 404: return 'غير موجود — ربما حُذف للتو';
    case 409: return 'يوجد جهة أخرى بهذا الرقم في هذا الدفتر';
    case 400: return 'بيانات غير صالحة';
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

export function setAccountStatus(id: string, status: 'active' | 'suspended', code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, code }),
  });
}

// ---- One account's book (slice 2) ----

export type Role = 'customer' | 'supplier' | 'partner';
export type TxnType = 'debt' | 'payment';

export interface Balance {
  currency: string;
  /** debt − payment, major units. Positive = the contact owes the shopkeeper. */
  balance: number;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
  balances: Balance[];
  transactions_count?: number;
}

export interface Entry {
  id: string;
  type: TxnType;
  amount: number;
  currency: string;
  note: string | null;
  occurred_at: string;
  created_at: string;
}

const u = (id: string) => `/admin/users/${encodeURIComponent(id)}`;

export function getBook(userId: string): Promise<{ account: Pick<Account, 'id' | 'phone' | 'store_name' | 'subscription_status'>; customers: Contact[] }> {
  return request(`${u(userId)}/customers`);
}

export function getContact(userId: string, customerId: string): Promise<{ customer: Contact; transactions: Entry[] }> {
  return request(`${u(userId)}/customers/${encodeURIComponent(customerId)}`);
}

export function updateContact(
  userId: string,
  customerId: string,
  fields: { name: string; phone: string; note: string; role: Role },
  code: string,
): Promise<unknown> {
  return request(`${u(userId)}/customers/${encodeURIComponent(customerId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...fields, code }),
  });
}

export function deleteContact(userId: string, customerId: string, code: string): Promise<unknown> {
  return request(`${u(userId)}/customers/${encodeURIComponent(customerId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ code }),
  });
}

/** Deletes outright. Reaches only a shop app new enough to understand it. */
export function deleteEntry(userId: string, txnId: string, code: string): Promise<unknown> {
  return request(`${u(userId)}/transactions/${encodeURIComponent(txnId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ code }),
  });
}

/** Cancels with an opposite entry — works with every version of the shop app. */
export function reverseEntry(userId: string, txnId: string, code: string): Promise<unknown> {
  return request(`${u(userId)}/transactions/${encodeURIComponent(txnId)}/reverse`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}
