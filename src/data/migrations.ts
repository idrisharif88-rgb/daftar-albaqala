import { generateCodes } from '../lib/productCodes';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';

// Schema migrations for the on-phone database.
//
// `schema.ts` only ever runs CREATE TABLE IF NOT EXISTS, so it can create a
// database but it can NEVER change one. A phone that already holds a grocer's
// debts keeps the old table shape forever, and any code expecting a new column
// crashes on that phone while working perfectly on a fresh install. This module
// closes that gap: every shape change is a numbered migration, applied in order,
// exactly once per device.
//
// 🧩 Server concept: schema migrations — the same problem the droplet's MySQL
// has (CLAUDE.md lists manual ALTERs the owner must run before a deploy), except
// here there is no admin to run them: the database is on thousands of phones you
// cannot log into. So the migration has to ship inside the app and be safe to
// re-run, because you never know which version a given device is coming from.
//
// The version counter is SQLite's built-in `PRAGMA user_version`, NOT a row in
// `app_meta` — `ensureLocalOwner` wipes `app_meta` when a different account logs
// in, which would reset the version and re-run every migration against tables
// that already have the columns. `user_version` survives that wipe.

interface Migration {
  version: number;
  name: string;
  run(db: SQLiteDBConnection): Promise<void>;
}

// Whether a column already exists — makes an ADD COLUMN safe to re-attempt if a
// migration was interrupted halfway (the app can be killed at any moment).
async function hasColumn(
  db: SQLiteDBConnection,
  table: string,
  column: string,
): Promise<boolean> {
  // PRAGMA can't take a bound parameter, but `table` is never user input here.
  const res = await db.query(`PRAGMA table_info(${table})`);
  return (res.values ?? []).some((r: { name?: string }) => r.name === column);
}

async function addColumn(
  db: SQLiteDBConnection,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (await hasColumn(db, table, column)) return;
  // SQLite requires a non-NULL default when adding a NOT NULL column to a table
  // that already has rows — every definition below supplies one, so existing
  // debts get a sensible value instead of failing the migration.
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'transaction currency + contact role',
    async run(db) {
      // Currency of the transaction. Existing rows are YER by definition — that
      // is all the app could record before this migration.
      await addColumn(db, 'transactions', 'currency', `TEXT NOT NULL DEFAULT 'YER'`);
      // What this contact is to the owner. Existing contacts are customers,
      // which is the only thing the app modelled until now.
      await addColumn(db, 'customers', 'role', `TEXT NOT NULL DEFAULT 'customer'`);
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_txn_currency ON transactions (customer_id, currency)`,
      );
    },
  },
  {
    version: 2,
    name: 'app_meta.updated_at (account settings sync)',
    async run(db) {
      // When each key was last written, so the store name and the exchange
      // rates can be merged with the server's copy last-write-wins instead of
      // one device blindly overwriting the other.
      //
      // Existing rows default to '' — deliberately, and read as "older than
      // anything". A value already on this phone must not outrank a value the
      // owner set on their other phone just because this one happens to sync
      // first; an unstamped local value should lose that argument.
      await addColumn(db, 'app_meta', 'updated_at', `TEXT NOT NULL DEFAULT ''`);
    },
  },
  {
    version: 3,
    name: 'items (per-contact price list)',
    async run(db) {
      // A price list per contact — see items.ts. CREATE TABLE IF NOT EXISTS is
      // safe to re-run, which matters because the app can be killed between the
      // statement and the version bump.
      await db.execute(`
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY NOT NULL,
  customer_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  price        INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'YER',
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  synced       INTEGER NOT NULL DEFAULT 0
);
`);
      // Each statement on its OWN line: the Android plugin splits a batch on
      // ";\n" and execSQL would otherwise run only the first (see owner.ts).
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_items_customer ON items (customer_id, name);
CREATE INDEX IF NOT EXISTS idx_items_synced ON items (synced);`,
      );
    },
  },
  {
    version: 4,
    name: 'item_groups (saved baskets)',
    async run(db) {
      // A named basket of this contact's items — see itemGroups.ts. Membership
      // is JSON text in one column rather than a child table: the ids only
      // travel together, and a second synced entity would bring its own
      // tombstones and its own way to arrive half-applied.
      //
      // `lines_json`, not `lines`: SQLite would take either, but the column is
      // called `lines_json` on the server because MySQL reserves `lines`, and
      // one name for one thing is worth more than the nicer spelling.
      await db.execute(`
CREATE TABLE IF NOT EXISTS item_groups (
  id           TEXT PRIMARY KEY NOT NULL,
  customer_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  lines_json   TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  synced       INTEGER NOT NULL DEFAULT 0
);
`);
      // One statement per line — the Android plugin splits a batch on ";\n"
      // and would otherwise run only the first (see owner.ts).
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_groups_customer ON item_groups (customer_id, name);
CREATE INDEX IF NOT EXISTS idx_groups_synced ON item_groups (synced);`,
      );
    },
  },
  {
    version: 5,
    name: 'attachments (a file pinned to an entry)',
    async run(db) {
      // A file on an entry — a product photo, a picture of the paper invoice,
      // proof of a payment (see attachments.ts). The bytes live in `data` as
      // base64: compressed images are small enough that one column beats the
      // filesystem/plugin juggling, and the same path then works identically on
      // web and native. `data` is NULL for a row learned from the server whose
      // bytes have not been downloaded yet (lazy — fetched when first viewed).
      //
      // `uploaded` distinguishes a row the server has seen from one created and
      // then deleted offline before any sync: the first needs a DELETE pushed,
      // the second is simply dropped (nothing on the server to tombstone).
      await db.execute(`
CREATE TABLE IF NOT EXISTS attachments (
  id             TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL,
  mime           TEXT NOT NULL,
  filename       TEXT NOT NULL DEFAULT '',
  size           INTEGER NOT NULL DEFAULT 0,
  data           TEXT,
  created_at     TEXT NOT NULL,
  deleted_at     TEXT,
  synced         INTEGER NOT NULL DEFAULT 0,
  uploaded       INTEGER NOT NULL DEFAULT 0
);
`);
      // One statement per line — the Android plugin splits a batch on ";\n"
      // and would otherwise run only the first (see owner.ts).
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_att_txn ON attachments (transaction_id);
CREATE INDEX IF NOT EXISTS idx_att_synced ON attachments (synced);`,
      );
    },
  },
  {
    version: 6,
    name: 'pos_products (what the shop sells, each with a printed QR code)',
    async run(db) {
      // The point-of-sale section (src/features/pos). `code` is the random key
      // printed on the shelf label; it means nothing by itself, so a label can
      // be reprinted without the product changing. Money in INTEGER minor units.
      // Local only for now — it joins the sync once the screen is proven.
      await db.execute(`
CREATE TABLE IF NOT EXISTS pos_products (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  price      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  synced     INTEGER NOT NULL DEFAULT 0
);
`);
      // One statement per line — the Android plugin splits a batch on ";\n"
      // and would otherwise run only the first (see owner.ts).
      await db.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_products_code ON pos_products (code);`,
      );
    },
  },
  {
    version: 7,
    name: 'pos_products: re-issue codes as EAN-13 (none were printed yet)',
    async run(db) {
      // The first codes were letters+digits («BK-RM8D3V»); the shop barcode
      // standard is 13 digits (EAN-13), which is what labels now carry. Only
      // rows still holding an old-style code are touched, once.
      const res = await db.query('SELECT id, code FROM pos_products');
      const rows = (res.values ?? []) as { id: string; code: string }[];
      const stale = rows.filter((r) => !/^2\d{12}$/.test(r.code));
      if (stale.length === 0) return;
      const fresh = generateCodes(stale.length, rows.map((r) => r.code));
      for (let i = 0; i < stale.length; i++) {
        await db.run(
          'UPDATE pos_products SET code = ?, updated_at = ?, synced = 0 WHERE id = ?',
          [fresh[i], new Date().toISOString(), stale[i].id],
        );
      }
    },
  },
  {
    version: 8,
    name: 'pos_baked + pos_sales (the day\'s baking and the day\'s selling)',
    async run(db) {
      // Both are ADD-ONLY, like the ledger: a correction is a new row (a
      // negative quantity), never an edit. `day` is the LOCAL calendar day as
      // «YYYY-MM-DD» — a bakery's day is the shop's day, not UTC's. A sale keeps
      // the price it was made at, so changing a price later does not rewrite
      // yesterday's takings. Local only for now, like pos_products.
      await db.execute(`
CREATE TABLE IF NOT EXISTS pos_baked (
  id         TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  synced     INTEGER NOT NULL DEFAULT 0
);
`);
      await db.execute(`
CREATE TABLE IF NOT EXISTS pos_sales (
  id         TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  price      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  synced     INTEGER NOT NULL DEFAULT 0
);
`);
      // One statement per line — the Android plugin splits a batch on ";\n"
      // and would otherwise run only the first (see owner.ts).
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_pos_baked_day ON pos_baked (day, product_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_day ON pos_sales (day, product_id);`,
      );
    },
  },
  {
    version: 9,
    name: 'pos_day_lock (a day\'s baked quantities, submitted)',
    async run(db) {
      // One row per day whose baked quantities were submitted. `locked_at` is
      // NULL while the day is reopened for a correction; `reopened` counts how
      // many times that happened, so the record shows a day was amended.
      await db.execute(`
CREATE TABLE IF NOT EXISTS pos_day_lock (
  day       TEXT PRIMARY KEY NOT NULL,
  locked_at TEXT,
  reopened  INTEGER NOT NULL DEFAULT 0
);
`);
    },
  },
  {
    version: 10,
    name: 'pos_day_lock: updated_at + synced (so a lock can sync)',
    async run(db) {
      // A lock syncs last-write-wins, so it needs a timestamp and a dirty flag
      // like every other synced row. Existing locks start dirty: they have
      // never been to the server.
      await db.run('ALTER TABLE pos_day_lock ADD COLUMN updated_at TEXT');
      await db.run('ALTER TABLE pos_day_lock ADD COLUMN synced INTEGER NOT NULL DEFAULT 0');
      await db.run(
        'UPDATE pos_day_lock SET updated_at = COALESCE(locked_at, ?) WHERE updated_at IS NULL',
        [new Date().toISOString()],
      );
    },
  },
  {
    version: 11,
    name: 'pos_products.daily (1 = baked fresh each day, 0 = stock that carries over)',
    async run(db) {
      // Vinegar, honey and ghee are not baked every morning: their stock is a
      // running total across days. Every existing product stays daily.
      await db.run('ALTER TABLE pos_products ADD COLUMN daily INTEGER NOT NULL DEFAULT 1');
    },
  },
  {
    version: 12,
    name: 'pos_notes (short notes written at the point of sale)',
    async run(db) {
      // Add-only; the owner may tombstone one. author_staff_id NULL = the
      // owner. The author is set by the SERVER — a note written here shows its
      // author once it comes back from a sync.
      await db.execute(`
CREATE TABLE IF NOT EXISTS pos_notes (
  id              TEXT PRIMARY KEY NOT NULL,
  author_staff_id TEXT,
  author_name     TEXT NOT NULL DEFAULT '',
  day             TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  synced          INTEGER NOT NULL DEFAULT 0
);
`);
    },
  },
];

// The version a fresh, fully-migrated database ends up at.
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

async function getUserVersion(db: SQLiteDBConnection): Promise<number> {
  const res = await db.query('PRAGMA user_version');
  const row = (res.values ?? [])[0] as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

async function setUserVersion(db: SQLiteDBConnection, version: number): Promise<void> {
  // PRAGMA values can't be bound; `version` is our own integer constant.
  await db.execute(`PRAGMA user_version = ${version}`);
}

// Bring the database up to LATEST_SCHEMA_VERSION. Called once from initDB after
// the baseline schema is in place. Migrations run in ascending order and each
// one bumps the version as it lands, so an interrupted upgrade resumes at the
// right place instead of redoing work that already committed.
export async function runMigrations(db: SQLiteDBConnection): Promise<void> {
  const current = await getUserVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await migration.run(db);
    await setUserVersion(db, migration.version);
  }
}
