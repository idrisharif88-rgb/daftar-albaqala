import { getMeta, setMeta } from './meta';

// Whether the owner has switched SERVER SYNC on for this account. The server is
// the real enforcement point: /sync returns 402 until subscription_status='active'.
// The result is mirrored here only so Settings can say so. It no longer blocks
// recording (2026-11-05): an account without sync is a full book on this phone,
// backed up to its own Google Drive — only the server copy is withheld.

const ACTIVE_KEY = 'account_active';

export async function isAccountActive(): Promise<boolean> {
  return (await getMeta(ACTIVE_KEY)) === '1';
}

export async function setAccountActive(active: boolean): Promise<void> {
  await setMeta(ACTIVE_KEY, active ? '1' : '0');
}

/** Where a blocked owner writes to have their number verified. */
export const SUPPORT_EMAIL = 'q.fives.app@gmail.com';

/**
 * Shown in Settings to an account without server sync.
 *
 * Written in both languages on purpose: the owner reads the Arabic, and a Play
 * reviewer who does not read Arabic must still see what it says. It names no
 * price, no currency, no plan and no term, and does not use the word اشتراك.
 */
export const INACTIVE_MESSAGE =
  `دفترك محفوظ على هذا الجهاز. المزامنة مع الخادم غير مفعّلة لحسابك — لتفعيلها تواصل معنا:\n${SUPPORT_EMAIL}\n\n` +
  `Your book is saved on this phone. Server sync is not enabled for your account — to enable it, contact us:\n${SUPPORT_EMAIL}`;
