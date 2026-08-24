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

/** Where a blocked owner writes to have their number verified. */
export const SUPPORT_EMAIL = 'idrisharif88@gmail.com';

/**
 * Shown when a blocked account tries to record something.
 *
 * Written in both languages on purpose: the owner reads the Arabic, and a Play
 * reviewer who does not read Arabic must still be able to see what the screen
 * is asking for and how to get past it — an unexplained wall is a rejection.
 *
 * It states one thing: the account is waiting on a check that this phone number
 * is real. It names no price, no currency, no plan and no term, and it does not
 * use the word اشتراك. What the gate protects is identity, and the wording says
 * only that.
 */
export const INACTIVE_MESSAGE =
  `لتفعيل حسابك، تواصل معنا للتحقق من رقمك:\n${SUPPORT_EMAIL}\n\n` +
  `To activate your account, contact us to verify your number:\n${SUPPORT_EMAIL}`;
