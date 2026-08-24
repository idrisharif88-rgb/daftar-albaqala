import { getDB } from './db';
import { getMeta, setMeta } from './meta';

// The invoice number — «رقم الفاتورة».
//
// A paper invoice book is numbered, and the number is how the two sides refer
// to one visit afterwards: «الفاتورة رقم 12» settles which basket is being
// argued about far better than a date and a total do. So every recorded
// invoice takes the next number, and that number appears on the receipt, in
// the message and in the entry's own note — the three places it can be read
// back from.
//
// The next number is the higher of two things:
//
//   1. a counter in `app_meta`, and
//   2. the highest number already written into an entry's note.
//
// (2) is what makes it survive. The counter lives in the phone's own database,
// which a reinstall wipes — the owner reinstalled and his book started again at
// 1, next to entries already numbered up to 12. The ENTRIES come back, because
// they sync; so the ledger itself is asked what the last invoice was, and the
// counter is only a cache in front of that answer.
//
// It is still deliberately NOT synced as a setting: it counts what this book
// issued, and two phones issuing offline could not agree on a number anyway —
// a number has to be handed out before it is used, and sync happens after. So
// it is a reference, never an identity; the entry's UUID is the identity.

const SEQ_KEY = 'invoice_seq';

// The note an invoice writes: «فاتورة رقم 12: جبن ×3، سكر ×2» (see Invoice.tsx).
const NOTE_PREFIX = 'فاتورة رقم ';
const NOTE_NUMBER = /^فاتورة رقم (\d+)/;

/** The highest invoice number the ledger itself can account for. Survives a
 *  reinstall, because the entries are pulled back from the server. */
async function highestInLedger(): Promise<number> {
  const db = await getDB();
  const res = await db.query(
    `SELECT note FROM transactions WHERE note LIKE ?`,
    [`${NOTE_PREFIX}%`],
  );
  let highest = 0;
  for (const row of (res.values ?? []) as { note?: string | null }[]) {
    const match = NOTE_NUMBER.exec(row.note ?? '');
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest;
}

/** The number the NEXT invoice would take, without consuming it. */
export async function peekInvoiceNumber(): Promise<number> {
  const [stored, inLedger] = await Promise.all([getMeta(SEQ_KEY), highestInLedger()]);
  return Math.max(Number(stored ?? 0) || 0, inLedger) + 1;
}

/**
 * Take the next number and store it. Called only once the basket is actually
 * being recorded: a number burnt by an abandoned invoice leaves a gap in the
 * book, and a gap in a numbered book looks like a missing page.
 */
export async function nextInvoiceNumber(): Promise<number> {
  const next = await peekInvoiceNumber();
  await setMeta(SEQ_KEY, String(next));
  return next;
}
