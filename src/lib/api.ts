import { API_BASE } from '../config';
import { getToken } from './storage';

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

// ---- Sync ----
// Wire shapes mirror the server (server/src/routes/sync.ts). NOTE: transaction
// `amount` travels as MAJOR units (e.g. 500.00) to match the server's DECIMAL —
// the local store keeps INTEGER minor units, so the sync layer converts.

export interface PushCustomer {
  id: string; name: string; phone: string; note: string | null; role: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface PushTransaction {
  id: string; customer_id: string; type: string; amount: number; currency: string;
  note: string | null; occurred_at: string; created_at: string;
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
}

export interface PullCustomer {
  id: string; name: string; phone: string; note: string | null; role: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface PullTransaction {
  id: string; customer_id: string; type: string; amount: string | number;
  currency: string | null;
  note: string | null; occurred_at: string; created_at: string;
}
export interface PullResult {
  customers: PullCustomer[];
  transactions: PullTransaction[];
  /** Opaque cursor to send as `since` next time. Do not parse it. */
  synced_at: string;
  /** More pages are waiting — call again with the new cursor. */
  has_more?: boolean;
}

export function syncPush(body: {
  customers: PushCustomer[];
  transactions: PushTransaction[];
}): Promise<PushResult> {
  return request<PushResult>('/sync/push', { method: 'POST', body: JSON.stringify(body) });
}

export function syncPull(since?: string | null, limit?: number): Promise<PullResult> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (limit) params.set('limit', String(limit));
  const q = params.toString();
  return request<PullResult>(`/sync/pull${q ? `?${q}` : ''}`);
}
