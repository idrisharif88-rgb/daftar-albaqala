import { API_BASE } from '../config';
import { getToken } from './storage';
import { FLAVOR } from '../flavors';

// Thin fetch wrapper around the backend. Attaches the JWT (when present) and
// turns non-2xx responses into a typed ApiError the UI can branch on — most
// importantly status 402 (subscription inactive), which gates cloud sync.

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown>;

// Fail a request after this long instead of hanging forever on a flaky link.
// Yemeni connections drop silently; without this the login/sync spinner spins
// indefinitely and the app looks frozen.
const REQUEST_TIMEOUT_MS = 15000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Which app is asking: the server activates each app separately (one
  // account can use both). Older builds send nothing and count as grocery.
  headers['X-App'] = FLAVOR.id;

  let res: Response;
  try {
    // Race the request against a timeout. We use a race (not just an
    // AbortController) because CapacitorHttp on native doesn't reliably honor
    // the abort signal — the race guarantees the UI unblocks after the timeout
    // regardless. A stray background request is harmless (calls are idempotent).
    res = await Promise.race([
      fetch(`${API_BASE}${path}`, { ...options, headers }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS)
      ),
    ]);
  } catch {
    // Network down / server unreachable / timed out — offline-first, expected.
    throw new ApiError(0, 'تعذّر الاتصال بالخادم', null);
  }

  const body: Json | null = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && typeof body.error === 'string' && body.error) || `خطأ ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

// ---- Auth ----

export interface AuthResult {
  token: string;
  user: { id: string; phone: string; store_name: string | null };
}

export function register(
  phone: string,
  password: string,
  storeName: string
): Promise<AuthResult> {
  return request<AuthResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone, password, store_name: storeName }),
  });
}

export function login(phone: string, password: string): Promise<AuthResult> {
  return request<AuthResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
}

/** The signed-in user — used to learn the phone of a session that predates
 *  storing it (see storage.ts). */
export interface Me {
  id: string;
  phone: string;
  /** Google Drive backup, granted per account by the owner (Watcher). */
  drive_backup: boolean;
  /** The point-of-sale section, switched on per account by the owner. */
  pos_enabled: boolean;
  /** POS staff accounts, switched on per account by the developer (Watcher). */
  pos_staff_enabled?: boolean;
  /** POS notes, switched on per account by the developer (Watcher). */
  pos_notes_enabled?: boolean;
  /** The shopkeeper's answer to «keep my book on the server?». 'pending' =
   *  the developer switched sync on and the app must ask. */
  sync_consent?: 'none' | 'pending' | 'approved' | 'rejected';
}

export function me(): Promise<{ user: Me }> {
  return request<{ user: Me }>('/me');
}

// ---- POS staff ----
// A staff member signs in with their own phone + password and works on the
// owner's point-of-sale data. Codes in features/pos/permissions.ts.

export interface StaffInfo { id: string; name: string; role: string; permissions: string[] }
export interface StaffSessionResult {
  token: string; staff: StaffInfo; store_name: string | null; notes_enabled?: boolean;
}

export function staffLogin(phone: string, password: string): Promise<StaffSessionResult> {
  return request<StaffSessionResult>('/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
}

/** Who this staff token is, and what they may do NOW. */
export function staffMe(): Promise<{ staff: StaffInfo; store_name: string | null; notes_enabled?: boolean }> {
  return request('/auth/staff/me');
}

export interface StaffMember extends StaffInfo {
  phone: string; disabled: boolean; created_at: string;
  /** Locked after 4 wrong passwords; a new password unlocks. Absent from an older server. */
  locked?: boolean;
}

/** Sign the staff member out on the server — closes their session for the
 *  owner's report. */
export function staffLogout(): Promise<{ ok: boolean }> {
  return request('/auth/staff/logout', { method: 'POST' });
}

export interface StaffReport {
  staff: { id: string; name: string };
  /** Instants (server time). logout_at null = never signed out. */
  sessions: { login_at: string; logout_at: string | null }[];
  /** Per LOCAL day: items sold (corrections subtracted) and money, minor units. */
  days: { day: string; qty: number; amount: number }[];
  totals: { qty: number; amount: number };
}
/** The OWNER's report on one staff member, `from`..`to` inclusive (YYYY-MM-DD). */
export function staffReport(id: string, from: string, to: string): Promise<StaffReport> {
  return request(`/pos-staff/${encodeURIComponent(id)}/report?from=${from}&to=${to}`);
}

export function listStaff(): Promise<{ staff: StaffMember[]; report_enabled?: boolean }> {
  return request('/pos-staff');
}

export function addStaff(body: {
  name: string; phone: string; role: string; password: string; permissions: string[];
}): Promise<{ staff: StaffMember }> {
  return request('/pos-staff', { method: 'POST', body: JSON.stringify(body) });
}

export function updateStaff(id: string, body: {
  name?: string; role?: string; permissions?: string[]; password?: string; disabled?: boolean;
}): Promise<{ staff: StaffMember }> {
  return request(`/pos-staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ---- Account ----

/** The shopkeeper's answer to the sync request (or a withdrawal later). */
export function answerSyncConsent(approve: boolean): Promise<{ sync_consent: string }> {
  return request('/account/sync-consent', { method: 'POST', body: JSON.stringify({ approve }) });
}

/** Erase this account and everything in it, server-side. Hard delete: the rows
 *  are gone, not tombstoned — there is no other device left to tell. */
export function deleteAccount(): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>('/account', { method: 'DELETE' });
}

// ---- Sync ----
// Wire shapes mirror the server (server/src/routes/sync.ts). NOTE: transaction
// `amount` travels as MAJOR units (e.g. 500.00) to match the server's DECIMAL —
// the local store keeps INTEGER minor units, so the sync layer converts.

export interface PushCustomer {
  id: string; name: string; phone: string; note: string | null; role: string;
  created_at: string; updated_at: string; deleted_at: string | null;
  /** MAJOR riyal units, like every amount on the wire; null = no limit. */
  debt_limit: number | null; reminder_days: number | null; reminder_consent: boolean;
}
export interface PushTransaction {
  id: string; customer_id: string; type: string; amount: number; currency: string;
  note: string | null; occurred_at: string; created_at: string;
}
export interface PushItem {
  id: string; customer_id: string; name: string; price: number; currency: string;
  note: string | null; created_at: string; updated_at: string; deleted_at: string | null;
}
/** A saved basket. `lines_json` is JSON TEXT — the server stores it without
 *  reading inside it, since the ids it holds only mean anything against this
 *  contact's price list on the phone. (Not `lines`: MySQL reserves that word,
 *  and the field is named for the column.) */
export interface PushItemGroup {
  id: string; customer_id: string; name: string; lines_json: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}

// Why the server would not store a row. 'missing_customer' is the only one
// worth retrying — see server/src/routes/sync.ts.
export type RejectReason = 'invalid' | 'missing_customer' | 'foreign_owner';
export interface Rejection {
  id: string;
  reason: RejectReason;
}
/** Per-row acknowledgement. Only ids in `accepted` are durably stored, and only
 *  those may be marked clean locally — anything else is still ours to keep. */
export interface TableAck {
  accepted: string[];
  rejected: Rejection[];
}
export interface PushResult {
  customers: TableAck;
  transactions: TableAck;
  /** Absent from a server older than the price list. */
  items?: TableAck;
  /** Absent from a server older than saved baskets. */
  item_groups?: TableAck;
  /** Keyed by setting NAME rather than by UUID — a setting has no id but its
   *  key is already unique per account. Absent from a server older than
   *  settings sync. */
  settings?: TableAck;
}

/** An account setting (store name, owner name, exchange rate) on the wire. */
export interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

export interface PullCustomer {
  id: string; name: string; phone: string; note: string | null; role: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
  /** Absent from a server older than limits. */
  debt_limit?: string | number | null; reminder_days?: number | null; reminder_consent?: number | boolean;
}
export interface PullTransaction {
  id: string; customer_id: string; type: string; amount: string | number;
  currency: string | null;
  note: string | null; occurred_at: string; created_at: string;
  /** Set when the owner deleted the entry from the Watcher. */
  deleted_at?: string | null;
}
export interface PullItem {
  id: string; customer_id: string; name: string; price: string | number;
  currency: string | null; note: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface PullItemGroup {
  id: string; customer_id: string; name: string; lines_json: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface PullResult {
  customers: PullCustomer[];
  transactions: PullTransaction[];
  /** Absent from a server older than the price list. */
  items?: PullItem[];
  /** Absent from a server older than saved baskets. */
  item_groups?: PullItemGroup[];
  /** Opaque cursor to send as `since` next time. Do not parse it. */
  synced_at: string;
  /** More pages are waiting — call again with the new cursor. */
  has_more?: boolean;
  /** The WHOLE settings set, on every page — they sit outside the delta
   *  cursor. Absent from a server older than settings sync. */
  settings?: SettingRow[];
}

export function syncPush(body: {
  customers: PushCustomer[];
  transactions: PushTransaction[];
  items?: PushItem[];
  item_groups?: PushItemGroup[];
  settings?: SettingRow[];
}): Promise<PushResult> {
  return request<PushResult>('/sync/push', { method: 'POST', body: JSON.stringify(body) });
}

// ---- Attachments ----
// A file pinned to an entry. Metadata + bytes travel on their OWN endpoints
// (not the JSON row sync): the bytes are base64 in a JSON body, which is what
// CapacitorHttp carries reliably. See server/src/routes/attachments.ts.

export interface AttachmentMeta {
  id: string;
  transaction_id: string;
  mime: string;
  filename: string | null;
  size: number;
  created_at: string;
  deleted_at: string | null;
}

/** Upload (or re-upload) one file. `data` is base64 with no data: prefix. */
export function uploadAttachment(body: {
  id: string;
  transaction_id: string;
  mime: string;
  filename: string;
  data: string;
}): Promise<{ attachment: AttachmentMeta }> {
  return request<{ attachment: AttachmentMeta }>('/attachments', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** The bytes for one attachment, base64. */
export function downloadAttachment(id: string): Promise<{ attachment: AttachmentMeta; data: string }> {
  return request<{ attachment: AttachmentMeta; data: string }>(`/attachments/${id}`);
}

/** Metadata delta since the given opaque cursor (includes tombstones). */
export function pullAttachments(since?: string | null): Promise<{
  attachments: AttachmentMeta[];
  synced_at: string | null;
}> {
  const q = since ? `?since=${encodeURIComponent(since)}` : '?since=';
  return request<{ attachments: AttachmentMeta[]; synced_at: string | null }>(`/attachments${q}`);
}

export function deleteAttachmentRemote(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/attachments/${id}`, { method: 'DELETE' });
}

export function syncPull(since?: string | null, limit?: number): Promise<PullResult> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (limit) params.set('limit', String(limit));
  // Ask for deleted entries too. Without it the server leaves them out, which
  // is what keeps an older app (that would insert them as live) safe.
  params.set('tombstones', '1');
  const q = params.toString();
  return request<PullResult>(`/sync/pull${q ? `?${q}` : ''}`);
}


// ---- Point-of-sale sync ----
// Its own endpoint (/pos-sync), apart from the ledger's — see server/src/routes/posSync.ts.

export interface PosProductRow {
  id: string; name: string; code: string; price: number;
  /** 1 = daily, 0 = carries-over stock. Absent from an older server = daily. */
  daily?: number;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface PosBakedRow { id: string; product_id: string; day: string; qty: number; created_at: string }
export interface PosSaleRow extends PosBakedRow { price: number }
export interface PosLockRow { day: string; locked_at: string | null; reopened: number; updated_at: string }

export interface PosTableAck { accepted: string[]; rejected: { id: string; reason: string }[] }
/** A note. `author_*` come FROM the server (it sets them from the token); the
 *  phone sends only what it wrote. */
export interface PosNoteRow {
  id: string; day: string; body: string; created_at: string; deleted_at: string | null;
  /** When the text was last edited (editor's clock); null = never. */
  edited_at?: string | null;
  updated_at?: string; author_staff_id?: string | null; author_name?: string;
}
export interface PosPushBody {
  products?: PosProductRow[]; baked?: PosBakedRow[]; sales?: PosSaleRow[]; day_locks?: PosLockRow[];
  notes?: PosNoteRow[];
}
export interface PosPushResult {
  products: PosTableAck; baked: PosTableAck; sales: PosTableAck; day_locks: PosTableAck;
  /** Absent from a server older than notes. */
  notes?: PosTableAck;
}
export interface PosPullResult {
  products: PosProductRow[]; baked: PosBakedRow[]; sales: PosSaleRow[]; day_locks: PosLockRow[];
  notes?: PosNoteRow[];
  synced_at: string; has_more: boolean;
}

export function posSyncPush(body: PosPushBody): Promise<PosPushResult> {
  return request<PosPushResult>('/pos-sync/push', { method: 'POST', body: JSON.stringify(body) });
}

export function posSyncPull(since?: string | null): Promise<PosPullResult> {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  return request<PosPullResult>(`/pos-sync/pull${q}`);
}
