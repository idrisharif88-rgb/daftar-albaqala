import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { SCHEMA } from './schema';
import { runMigrations } from './migrations';

// Single shared connection to the on-phone database. The repositories
// (customers.ts, transactions.ts) call getDB() and never touch the plugin
// directly, so all the connection/lifecycle quirks live here.

const DB_NAME = 'daftar';
const sqlite = new SQLiteConnection(CapacitorSQLite);

let db: SQLiteDBConnection | null = null;
let initPromise: Promise<SQLiteDBConnection> | null = null;

// Opens (or reuses) the connection and ensures the schema exists. Safe to call
// repeatedly — the work runs once and later callers await the same promise.
export async function initDB(): Promise<SQLiteDBConnection> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // On the web, bring up the jeep-sqlite element + IndexedDB-backed store
    // before opening any connection. (The element class is registered in
    // main.tsx via the loader.) On native this block is skipped entirely.
    if (Capacitor.getPlatform() === 'web') {
      if (!document.querySelector('jeep-sqlite')) {
        document.body.appendChild(document.createElement('jeep-sqlite'));
      }
      await customElements.whenDefined('jeep-sqlite');
      await sqlite.initWebStore();
    }

    // Reuse an existing connection if one survived a hot-reload.
    const existing = (await sqlite.isConnection(DB_NAME, false)).result;
    const conn = existing
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

    await conn.open();
    // SCHEMA is the baseline (v0) shape and only creates what's missing; every
    // change since then is a numbered migration. Both run on every start: a
    // fresh install gets the baseline then all migrations, an existing phone
    // skips the baseline (IF NOT EXISTS) and applies only what it's missing.
    await conn.execute(SCHEMA);
    await runMigrations(conn);
    db = conn;
    return conn;
  })();

  return initPromise;
}

export async function getDB(): Promise<SQLiteDBConnection> {
  return db ?? initDB();
}

// On the web platform the database lives in memory and must be flushed to
// IndexedDB after writes to survive a refresh. On native this is a no-op.
export async function persist(): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    await sqlite.saveToStore(DB_NAME);
  }
}
