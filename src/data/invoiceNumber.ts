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
// The counter is a plain running integer in `app_meta`, and it is deliberately
// NOT synced (it is not on the settings allowlist). It counts what this phone
// issued, the way a paper book counts what that book issued; a second device
// would be a second book, starting again at 1. Two devices could therefore
// both issue a «رقم 5» — which is why the number is a reference, never an
// identity: the entry's UUID is the identity.

const SEQ_KEY = 'invoice_seq';

/** The number the NEXT invoice would take, without consuming it. */
export async function peekInvoiceNumber(): Promise<number> {
  const raw = await getMeta(SEQ_KEY);
  return (Number(raw ?? 0) || 0) + 1;
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
