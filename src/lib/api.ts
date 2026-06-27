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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    // Network down / server unreachable — offline-first, so this is expected.
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
