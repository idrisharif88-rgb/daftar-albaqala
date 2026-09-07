import { getDB } from './db';
import { getMeta, setMeta } from './meta';

// The numbers this book hands out — «رقم الفاتورة» and «رقم الإشعار».
//
// A paper book is numbered, and the number is how the two sides refer to one
// dealing afterwards: «الفاتورة رقم 12» settles which basket is being argued
// about far better than a date and a total do. So every recorded document takes
// the next number in its series, and that number appears in the message, on the
// receipt and in the entry's own note — the places it can be read back from.
//
// TWO SERIES, counted separately. An invoice is a basket of goods; an «إشعار
// حركة» is a single movement — a payment made, an amount taken. They are
// different documents, so a shared counter would leave each series full of
// gaps, and a gap in a numbered book looks like a missing page.
//
// The next number in a series is the higher of two things:
//
//   1. a counter in `app_meta`, and
//   2. the highest number already written into an entry's note.
//
// (2) is what makes it survive. The counter lives in the phone's own database,
// which a reinstall wipes — the owner reinstalled and his book started again at
// 1, next to entries already numbered up to 12. The ENTRIES come back, because
// they sync; so the ledger itself is asked what the last number was, and the
// counter is only a cache in front of that answer.
//
// It is still deliberately NOT synced as a setting: it counts what this book
// issued, and two phones issuing offline could not agree on a number anyway —
// a number has to be handed out before it is used, and sync happens after. So
// it is a reference, never an identity; the entry's UUID is the identity.

interface Series {
  /** Where the counter is cached, in `app_meta`. */
  key: string;
  /** How the number is written into an entry's note — «فاتورة رقم 12: …». */
  prefix: string;
}

const INVOICE: Series = { key: 'invoice_seq', prefix: 'فاتورة رقم ' };
const NOTICE: Series = { key: 'notice_seq', prefix: 'إشعار رقم ' };

/** The highest number of this series the ledger itself can account for.
 *  Survives a reinstall, because the entries are pulled back from the server. */
async function highestInLedger(series: Series): Promise<number> {
  const db = await getDB();
  const res = await db.query(
    `SELECT note FROM transactions WHERE note LIKE ?`,
    [`${series.prefix}%`],
  );
  const pattern = new RegExp(`^${series.prefix}(\\d+)`);
  let highest = 0;
  for (const row of (res.values ?? []) as { note?: string | null }[]) {
    const match = pattern.exec(row.note ?? '');
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest;
}

async function peek(series: Series): Promise<number> {
  const [stored, inLedger] = await Promise.all([
    getMeta(series.key), highestInLedger(series),
  ]);
  return Math.max(Number(stored ?? 0) || 0, inLedger) + 1;
}

/**
 * Take the next number and store it. Called only once the document is actually
 * being recorded — a number burnt by an abandoned invoice leaves a gap.
 */
async function next(series: Series): Promise<number> {
  const n = await peek(series);
  await setMeta(series.key, String(n));
  return n;
}

/** The number the NEXT invoice would take, without consuming it. */
export const peekInvoiceNumber = () => peek(INVOICE);
export const nextInvoiceNumber = () => next(INVOICE);

/** The same, for a single movement — a payment made, an amount taken. */
export const peekNoticeNumber = () => peek(NOTICE);
export const nextNoticeNumber = () => next(NOTICE);

/**
 * The note the entry carries: «إشعار رقم 5: كيس دقيق».
 *
 * The number has to be IN the ledger, not only in the message — it is what the
 * counter reads back after a reinstall, and what the owner points at when the
 * other person asks which payment is being talked about. The message does not
 * repeat it in its own note section; the header already says it.
 */
export function noticeNote(number: number, note: string): string {
  const own = note.trim();
  return own ? `${NOTICE.prefix}${number}: ${own}` : `${NOTICE.prefix}${number}`;
}
