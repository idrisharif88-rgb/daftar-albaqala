// «رمز المدير» — checked on the staff member's phone, offline. The phone holds
// only 's1:<salt>:<sha256(salt + pin)>' from the server, never the code.

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Does `pin` match the stored hash? False for anything malformed. */
export async function pinMatches(pin: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || !/^\d{4}$/.test(pin)) return false;
  const [v, salt, digest] = stored.split(':');
  if (v !== 's1' || !salt || !digest) return false;
  try {
    return (await sha256Hex(salt + pin)) === digest;
  } catch {
    return false; // no WebCrypto (plain-http dev): never let it pass
  }
}
