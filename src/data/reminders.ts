import { Capacitor, registerPlugin } from '@capacitor/core';
import { getDB } from './db';
import { getBalancesByCustomer } from './transactions';
import { getRates } from './rates';
import { getSettings, messageSender } from './settings';
import { formatAmountFull, totalInBase, type CurrencyBalance, type Rates } from './currencies';
import { VISIBLE_ROLE_CODES } from './roles';
import { FLAVOR } from '../flavors';
import { toIntlDigits } from '../lib/notify';

// Automatic SMS reminders — «ذكّر الزبون بدينه كل أسبوع».
//
// Only the DIRECT build (outside Google Play) can send them: Play refuses the
// SEND_SMS permission to any app that is not the phone's SMS app, so the
// sender (AutoSmsPlugin.java + ReminderWorker.java) lives in
// android/app/src/direct/ and nowhere else. In every other build the plugin is
// missing, `autoSmsAvailable()` is false and the screens hide the feature.
//
// The split of work:
//   - HERE (JS) the outbox is written: who is due a reminder, every how many
//     days, and the finished text. It is rewritten whenever the book changes
//     (an entry, a limit edit, a sync, app start), so the text always quotes
//     today's balance — the balance can only change through the app.
//   - NATIVE (Android WorkManager) wakes a few times a day even with the app
//     closed, and sends whatever is due, from the owner's own SIM, by day only.
//
// A contact is in the outbox only when ALL hold: the owner recorded that they
// agreed (reminder_consent), an interval is set, they have a phone, and they
// owe money. Paying up removes them; owing again starts the interval afresh.

export interface ReminderItem {
  id: string;
  phone: string;
  text: string;
  days: number;
}

export interface AutoSmsStatus {
  /** 'granted' | 'denied' | 'prompt' … — Android's answer for SEND_SMS. */
  permission: string;
  /** The owner's switch in Settings. */
  enabled: boolean;
  /** contact id → when the last reminder went (ms since epoch). */
  lastSent: Record<string, number>;
}

interface AutoSmsPlugin {
  status(): Promise<AutoSmsStatus>;
  requestPermission(): Promise<{ permission: string }>;
  setEnabled(o: { enabled: boolean }): Promise<void>;
  setOutbox(o: { items: ReminderItem[] }): Promise<void>;
}

const AutoSms = registerPlugin<AutoSmsPlugin>('AutoSms');

/** True only in the direct build, on Android. */
export function autoSmsAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('AutoSms');
}

export async function autoSmsStatus(): Promise<AutoSmsStatus | null> {
  if (!autoSmsAvailable()) return null;
  try { return await AutoSms.status(); } catch { return null; }
}

export async function requestAutoSmsPermission(): Promise<boolean> {
  if (!autoSmsAvailable()) return false;
  try { return (await AutoSms.requestPermission()).permission === 'granted'; } catch { return false; }
}

export async function setAutoSmsEnabled(enabled: boolean): Promise<void> {
  if (!autoSmsAvailable()) return;
  await AutoSms.setEnabled({ enabled });
  kickReminders();
}

/** The app's name as the reader of an SMS should see it. */
const SENDER_APP = FLAVOR.id === 'contractor' ? 'دفتر المقاول' : 'فليكتب';

/** What they owe, in words a message can carry; null when they owe nothing. */
export function owedText(balances: CurrencyBalance[], rates: Rates): string | null {
  const owed = balances.filter((b) => b.minor > 0);
  if (owed.length === 0) return null;
  const total = totalInBase(balances, rates);
  if (balances.length === 1) return formatAmountFull(balances[0].minor, balances[0].currency);
  if (total.complete) return total.minor > 0 ? formatAmountFull(total.minor, 'YER') : null;
  return owed.map((b) => formatAmountFull(b.minor, b.currency)).join(' و');
}

/**
 * The reminder itself. Short on purpose — two SMS parts for a usual name — polite, and
 * plain that no person pressed send: the reader should not think the shop is
 * chasing them by hand.
 */
export function buildReminderMessage(sender: string, owed: string): string {
  return [
    sender ? `تذكير من ${sender}:` : 'تذكير:',
    `رصيدك المستحق: ${owed}`,
    'نرجو التكرم بالسداد، وشكراً لكم.',
    `رسالة آلية من تطبيق ${SENDER_APP} دون تدخل من أحد.`,
  ].join('\n');
}

export async function buildReminderOutbox(): Promise<ReminderItem[]> {
  const db = await getDB();
  const marks = VISIBLE_ROLE_CODES.map(() => '?').join(', ');
  const res = await db.query(
    `SELECT id, phone, reminder_days FROM customers
      WHERE deleted_at IS NULL AND reminder_consent = 1 AND reminder_days IS NOT NULL
        AND phone <> '' AND role IN (${marks})`,
    VISIBLE_ROLE_CODES,
  );
  const rows = (res.values ?? []) as { id: string; phone: string; reminder_days: number }[];
  if (rows.length === 0) return [];
  const [balances, rates, settings] = await Promise.all([getBalancesByCustomer(), getRates(), getSettings()]);
  const sender = messageSender(settings);
  const out: ReminderItem[] = [];
  for (const r of rows) {
    const owed = owedText(balances.get(r.id) ?? [], rates);
    if (!owed) continue;
    out.push({ id: r.id, phone: '+' + toIntlDigits(String(r.phone)), text: buildReminderMessage(sender, owed), days: Number(r.reminder_days) });
  }
  return out;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Rewrite the outbox soon. Cheap to call after every change: calls within a
 *  second collapse into one. Never throws. */
export function kickReminders(): void {
  if (!autoSmsAvailable()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void buildReminderOutbox()
      .then((items) => AutoSms.setOutbox({ items }))
      .catch(() => { /* the next change tries again */ });
  }, 1000);
}
