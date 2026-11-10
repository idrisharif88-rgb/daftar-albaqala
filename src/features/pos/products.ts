import { getDB, persist } from '../../data/db';
import { uuidv4 } from '../../data/uuid';
import { generateCodes, parseScannedCode } from '../../lib/productCodes';
import { localDay } from './day';
import { kickPosSync } from './posSyncKick';

// POS product repository — what the shop sells, one row per product, each with
// the random code printed on its shelf label (see lib/productCodes.ts).
//
// Same local conventions as the rest of the data layer: UUID text PK, money in
// INTEGER minor units, ISO-8601 UTC text, soft-delete + `synced`.

export interface PosProduct {
  id: string;
  name: string;
  code: string;
  /** Minor units — see data/money.ts. */
  price: number;
  /** true = baked fresh each day; false = stock that carries over between days. */
  daily: boolean;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, name, code, price, daily, created_at, updated_at';
const nowIso = () => new Date().toISOString();

function toProduct(row: Record<string, unknown>): PosProduct {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    price: Number(row.price) || 0,
    daily: row.daily === undefined || row.daily === null ? true : Number(row.daily) !== 0,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listProducts(): Promise<PosProduct[]> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM pos_products WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  return ((res.values ?? []) as Record<string, unknown>[]).map(toProduct);
}

/** The product a scanned code stands for, or null. */
export async function findProductByCode(code: string): Promise<PosProduct | null> {
  const db = await getDB();
  const res = await db.query(
    `SELECT ${COLS} FROM pos_products WHERE code = ? AND deleted_at IS NULL`,
    [code],
  );
  const row = (res.values ?? [])[0] as Record<string, unknown> | undefined;
  return row ? toProduct(row) : null;
}

async function nameTaken(name: string, exceptId = ''): Promise<boolean> {
  const db = await getDB();
  const res = await db.query(
    `SELECT id FROM pos_products
      WHERE deleted_at IS NULL AND id <> ? AND name = ? COLLATE NOCASE`,
    [exceptId, name],
  );
  return (res.values ?? []).length > 0;
}

/** Every code ever issued, deleted products included: a printed label that is
 *  still on a board must never be handed to a different product. */
async function allCodes(): Promise<string[]> {
  const db = await getDB();
  const res = await db.query('SELECT code FROM pos_products');
  return ((res.values ?? []) as { code: string }[]).map((r) => r.code);
}

export async function createProduct(input: { name: string; price: number; daily?: boolean }): Promise<PosProduct> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم المنتج مطلوب');
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error('أدخل سعراً صحيحاً');
  if (await nameTaken(name)) throw new Error('المنتج مسجل مسبقاً');

  const [code] = generateCodes(1, await allCodes());
  const db = await getDB();
  const id = uuidv4();
  const now = nowIso();
  const price = Math.round(input.price);
  const daily = input.daily !== false;
  await db.run(
    `INSERT INTO pos_products (id, name, code, price, daily, created_at, updated_at, deleted_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
    [id, name, code, price, daily ? 1 : 0, now, now],
  );
  await persist();
  kickPosSync();
  return { id, name, code, price, daily, created_at: now, updated_at: now };
}

/** Many at once, one name per entry; blanks and names already in use are
 *  skipped and counted. Price starts at 0 — it is set per product afterwards. */
export async function createProducts(
  names: string[],
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    try {
      await createProduct({ name, price: 0 });
      added += 1;
    } catch {
      skipped += 1; // already exists
    }
  }
  return { added, skipped };
}

/** The code is deliberately not editable: it is already printed somewhere. */
export async function updateProduct(
  id: string,
  fields: { name: string; price: number; daily?: boolean },
): Promise<void> {
  const name = fields.name.trim();
  if (!name) throw new Error('اسم المنتج مطلوب');
  if (!Number.isFinite(fields.price) || fields.price < 0) throw new Error('أدخل سعراً صحيحاً');
  if (await nameTaken(name, id)) throw new Error('المنتج مسجل مسبقاً');
  const db = await getDB();
  await db.run(
    `UPDATE pos_products SET name = ?, price = ?, daily = COALESCE(?, daily), updated_at = ?, synced = 0 WHERE id = ?`,
    [name, Math.round(fields.price), fields.daily === undefined ? null : fields.daily ? 1 : 0, nowIso(), id],
  );
  await persist();
  kickPosSync();
}

export async function deleteProduct(id: string): Promise<void> {
  const db = await getDB();
  const now = nowIso();
  await db.run(
    `UPDATE pos_products SET deleted_at = ?, updated_at = ?, synced = 0 WHERE id = ?`,
    [now, now, id],
  );
  await persist();
  kickPosSync();
}

// ---------------------------------------------------------------------------
// Moving the product list between devices (until it syncs).
//
// The CODES travel with the products — a barcode already printed and stuck on
// a board must mean the same product on every device.

/** The whole list as text, ready to copy: products with their codes and
 *  prices, plus TODAY's baked quantities. Ids travel too, so importing the
 *  same text twice changes nothing. */
export async function exportProductsJson(): Promise<string> {
  const list = await listProducts();
  const db = await getDB();
  const baked = ((await db.query(
    'SELECT id, product_id, day, qty, created_at FROM pos_baked WHERE day = ?', [localDay()],
  )).values ?? []) as Record<string, unknown>[];
  return JSON.stringify({
    v: 2,
    products: list.map((p) => ({ id: p.id, name: p.name, code: p.code, price: p.price, daily: p.daily })),
    baked,
  });
}

/** Add products (and today's baked rows) from `exportProductsJson` text. A
 *  product whose code or name is already here is skipped; a baked row already
 *  here (same id) is skipped — so importing twice changes nothing. */
export async function importProductsJson(
  text: string,
): Promise<{ added: number; skipped: number; baked: number }> {
  const bad = 'النص غير صالح. انسخ القائمة كاملة ثم الصقها.';
  let data: { products?: unknown; baked?: unknown };
  try { data = JSON.parse(text.trim()); } catch { throw new Error(bad); }
  if (!Array.isArray(data.products)) throw new Error(bad);

  const db = await getDB();
  const idByTheirId = new Map<string, string>(); // exporter's id → the id used here
  let added = 0;
  let skipped = 0;
  for (const raw of data.products as Record<string, unknown>[]) {
    const name = String(raw?.name ?? '').trim();
    const code = parseScannedCode(String(raw?.code ?? ''));
    const price = Number(raw?.price);
    if (!name || !code || !Number.isInteger(price) || price < 0) { skipped += 1; continue; }
    const existing = ((await db.query('SELECT id FROM pos_products WHERE code = ?', [code])).values ?? [])[0] as { id: string } | undefined;
    if (existing) {
      if (raw.id) idByTheirId.set(String(raw.id), existing.id);
      skipped += 1;
      continue;
    }
    if (await nameTaken(name)) { skipped += 1; continue; }
    const taken = raw.id ? ((await db.query('SELECT id FROM pos_products WHERE id = ?', [String(raw.id)])).values ?? []).length > 0 : true;
    const id = !taken ? String(raw.id) : uuidv4();
    if (raw.id) idByTheirId.set(String(raw.id), id);
    const now = nowIso();
    await db.run(
      `INSERT INTO pos_products (id, name, code, price, daily, created_at, updated_at, deleted_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
      [id, name, code, price, raw.daily === false || raw.daily === 0 ? 0 : 1, now, now],
    );
    added += 1;
  }

  let baked = 0;
  if (Array.isArray(data.baked)) {
    for (const b of data.baked as Record<string, unknown>[]) {
      const productId = idByTheirId.get(String(b?.product_id ?? ''));
      const qty = Number(b?.qty);
      const day = String(b?.day ?? '');
      if (!productId || !b.id || !Number.isInteger(qty) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const done = await db.query('SELECT id FROM pos_baked WHERE id = ?', [String(b.id)]);
      if ((done.values ?? []).length > 0) continue;
      await db.run(
        'INSERT INTO pos_baked (id, product_id, day, qty, created_at, synced) VALUES (?, ?, ?, ?, ?, 0)',
        [String(b.id), productId, day, qty, String(b.created_at ?? nowIso())],
      );
      baked += 1;
    }
  }
  await persist();
  kickPosSync();
  return { added, skipped, baked };
}
