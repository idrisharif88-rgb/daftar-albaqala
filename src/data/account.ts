import { getMeta, setMeta } from './meta';

// Whether the owner has activated this account on the server. The server is the
// real enforcement point: /sync returns 402 until subscription_status='active'.
// We mirror that result into a local flag so the app can block data entry while
// offline too. Default = NOT active: a brand-new account is blocked until the
// owner activates it server-side and a sync succeeds.

const ACTIVE_KEY = 'account_active';

export async function isAccountActive(): Promise<boolean> {
  return (await getMeta(ACTIVE_KEY)) === '1';
}

export async function setAccountActive(active: boolean): Promise<void> {
  await setMeta(ACTIVE_KEY, active ? '1' : '0');
}

// Arabic message shown when a blocked account tries to add data.
export const INACTIVE_MESSAGE = 'حسابك غير مفعّل. تواصل مع المالك لتفعيل حسابك.';
