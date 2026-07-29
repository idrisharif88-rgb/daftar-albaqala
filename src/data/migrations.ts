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
