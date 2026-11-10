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
  /** «دفتر المقاول»'s own store name, if one was set. */
  contractor_store_name: string | null;
  plan: string;
  subscription_status: Status;
  subscription_expires_at: string | null;
  /** Google Drive backup — an extra the owner grants per account. */
  drive_backup: boolean;
  /** The point-of-sale section — switched on per account by the owner. */
  pos_enabled: boolean;
  /** POS staff accounts (cashier / adder / admin) — switched on per account by the owner. */
  pos_staff_enabled?: boolean;
  /** POS notes — switched on per account by the owner. */
  pos_notes_enabled?: boolean;
  /** The shop owner may see the report per staff member (the developer always can). */
  pos_report_enabled?: boolean;
  /** The shopkeeper's own answer to the sync request. Switching sync on only
   *  ASKS ('pending'); the server syncs nothing until he approves. */
  sync_consent?: 'none' | 'pending' | 'approved' | 'rejected';
  /** «دفتر المقاول»'s own activation ('active' | 'none'); subscription_status
   *  is the grocery app's, and 'suspended' there blocks both apps. */
  contractor_status: string;
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

export function setContractorStatus(id: string, active: boolean, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ app: 'contractor', status: active ? 'active' : 'none', code }),
  });
}

/** A one-time ticket for the live line (GET /events?ticket=…). */
export function liveTicket(): Promise<{ ticket: string }> {
  return request('/admin/events/ticket', { method: 'POST' });
}

/** Ask the user to agree to server sync (their app shows ✓ / ✗). No code needed. */
export function requestSync(id: string): Promise<{ sync_consent: string }> {
  return request(`/admin/users/${encodeURIComponent(id)}/sync-request`, { method: 'POST' });
}

export function setAccountStatus(id: string, status: 'active' | 'none' | 'suspended', code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, code }),
  });
}

export function setDriveBackup(id: string, enabled: boolean, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/drive-backup`, {
    method: 'POST',
    body: JSON.stringify({ enabled, code }),
  });
}

export function setPosAccess(id: string, enabled: boolean, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/pos`, {
    method: 'POST',
    body: JSON.stringify({ enabled, code }),
  });
}

/** Switch POS staff accounts on/off for one shop. Off: the shop sees no
 *  «الموظفون», and its staff cannot sign in. The staff are kept. */
export function setPosStaffAccess(id: string, enabled: boolean, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/pos-staff`, {
    method: 'POST',
    body: JSON.stringify({ enabled, code }),
  });
}

/** Switch POS notes on/off for one shop. Notes already written are kept. */
export function setPosNotesAccess(id: string, enabled: boolean, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/pos-notes`, {
    method: 'POST',
    body: JSON.stringify({ enabled, code }),
  });
}

/** Let one shop's owner see the report per staff member (on/off). */
export function setPosReportAccess(id: string, enabled: boolean, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/pos-report`, {
    method: 'POST',
    body: JSON.stringify({ enabled, code }),
  });
}

export interface ShopNote {
  id: string; author_staff_id: string | null; author_name: string; day: string;
  body: string; edited_at: string | null; created_at: string;
}
/** One shop's POS notes, newest first (read-only). */
export function listShopNotes(id: string): Promise<{ notes: ShopNote[] }> {
  return request(`/admin/users/${encodeURIComponent(id)}/notes`);
}

export interface ShopStaff { id: string; name: string; phone: string; role: string; disabled: boolean }
export function listShopStaff(id: string): Promise<{ staff: ShopStaff[] }> {
  return request(`/admin/users/${encodeURIComponent(id)}/staff`);
}

export interface StaffReport {
  staff: { id: string; name: string };
  sessions: { login_at: string; logout_at: string | null }[];
  days: { day: string; qty: number; amount: number }[];
  totals: { qty: number; amount: number };
}
export function shopStaffReport(id: string, staffId: string, from: string, to: string): Promise<StaffReport> {
  return request(`/admin/users/${encodeURIComponent(id)}/staff/${encodeURIComponent(staffId)}/report?from=${from}&to=${to}`);
}

/** Erase a whole account. The server checks `confirmPhone` against the account. */
export function deleteAccount(id: string, confirmPhone: string, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm_phone: confirmPhone, code }),
  });
}

/** Set a new password for a shopkeeper who forgot his (6–128 characters). */
export function setPassword(id: string, password: string, code: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/password`, {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
}

/** Rename the store the phones show — the grocery book's, or the contractor's. */
export function setStoreName(
  id: string, storeName: string, app: 'grocery' | 'contractor', code: string,
): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/store-name`, {
    method: 'POST',
    body: JSON.stringify({ store_name: storeName, code, ...(app === 'contractor' ? { app } : {}) }),
  });
}

// ---- One account's book (slice 2) ----

// One account can keep two books: «دفتر البقالة» and «دفتر المقاول» each have
// their own role codes (src/flavors/ in the shop app).
export type Role =
  | 'customer' | 'supplier' | 'partner'
  | 'worker' | 'client' | 'broker' | 'materials';
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

// ---- A copy of one account's whole book ----
//
// What a grocer gets when he asks for his data. The shop app exports his own
// book from Settings; this is the same book handed over by the owner, for
// someone who cannot manage that himself. Read-only, so no authenticator code.

export interface ExportedContact {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface ExportedEntry {
  id: string;
  customer_id: string;
  type: TxnType;
  amount: number;
  currency: string;
  note: string | null;
  occurred_at: string;
  created_at: string;
}

export interface BookExport {
  account: Pick<Account, 'id' | 'phone' | 'store_name' | 'subscription_status'>;
  customers: ExportedContact[];
  transactions: ExportedEntry[];
  exported_at: string;
  /** Set by the Watcher, not the server: which of the account's two books
   *  this file holds — «دفتر البقالة» or «دفتر المقاول». */
  book_label?: string;
}

export function exportBook(userId: string): Promise<BookExport> {
  return request(`${u(userId)}/export`);
}
