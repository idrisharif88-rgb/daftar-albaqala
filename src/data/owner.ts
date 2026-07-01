import { getDB, persist } from './db';

// The on-phone SQLite store is single-tenant: it holds one grocer's data with
// no user_id columns. When a DIFFERENT account logs in, the previous grocer's
// rows must be cleared so the new user never sees them. (Server isolation is by
// user_id and is fine; this guard fixes the client side.)
//
// We record the owning user_id in app_meta. On a user switch we wipe local
// customers / transactions / app_meta so a fresh sync re-pulls the new user's
// data into a clean store, then re-seed the store name from the account.
//
// Caveat: switching users discards any unsynced local rows — acceptable for
// one-grocer-per-phone use.

const OWNER_KEY = 'owner_user_id';

export async function ensureLocalOwner(
  userId: string,
  storeName?: string | null,
): Promise<void> {
  const db = await getDB();
  const res = await db.query(`SELECT value FROM app_meta WHERE key = ?`, [OWNER_KEY]);
  const current = ((res.values ?? [])[0]?.value as string) ?? null;

  if (current === userId) return; // same owner — nothing to wipe

  if (current !== null) {
    // A different user is signing in — drop the previous grocer's local store.
    // NOTE: the native (Android) plugin splits a batch on ";\n", and Android's
    // execSQL runs only the FIRST statement of a single-line ";"-joined string.
    // So each DELETE MUST be on its own line, or only `transactions` gets wiped
    // (balances reset to zero) while `customers` leak across accounts.
    await db.execute(
      `DELETE FROM transactions;
DELETE FROM customers;
DELETE FROM app_meta;`,
    );
  }

  // Record the new owner so the next switch is detected.
  await db.run(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [OWNER_KEY, userId],
  );

  // Seed the store name from the account (used in customer notifications).
  if (storeName) {
    await db.run(
      `INSERT INTO app_meta (key, value) VALUES ('store_name', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [storeName],
    );
  }

  await persist();
}
