// Random product codes — one per product, printed as a barcode label the seller
// scans with the phone camera each time one is sold.
//
// EAN-13, the barcode on every shop product: 13 digits, with the number printed
// under the bars. Bakery products have no factory barcode, so the code carries
// no meaning of its own — it is only a key; the product it stands for lives in
// the database, which is what lets a label be reprinted without changing it.
//
// A leading «2» is how EAN reserves numbers for in-store use (GS1 sets 200–299
// aside for it), so a code made here can never collide with a real product's
// factory barcode. The last digit is the standard check digit, which is how a
// scanner knows it read the lines correctly rather than misreading one.

/** The digit that completes a 12-digit EAN-13 body. */
export function ean13CheckDigit(body12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function randomCode(): string {
  const bytes = new Uint8Array(11);
  let body = '2';
  // Rejection sampling: `byte % 10` alone would favour the digits 0–5.
  while (body.length < 12) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < 250 && body.length < 12) body += String(b % 10);
  }
  return body + ean13CheckDigit(body);
}

/**
 * `count` new codes, none repeating each other or anything in `existing`
 * (codes already printed and in use — a duplicate would sell the wrong product).
 */
export function generateCodes(count: number, existing: Iterable<string> = []): string[] {
  const taken = new Set(existing);
  const made: string[] = [];
  while (made.length < count) {
    const code = randomCode();
    if (taken.has(code)) continue;
    taken.add(code);
    made.push(code);
  }
  return made;
}

/** Is this one of our codes? 13 digits, leading 2, correct check digit.
 *  Spaces around it are ignored. Returns the clean code, or null. */
export function parseScannedCode(raw: string): string | null {
  const s = raw.trim();
  if (!/^2\d{12}$/.test(s)) return null;
  return ean13CheckDigit(s.slice(0, 12)) === Number(s[12]) ? s : null;
}
