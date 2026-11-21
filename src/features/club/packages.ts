import { getMeta, setMeta } from '../../data/meta';
import { uuidv4 } from '../../data/uuid';
import { BASE_CURRENCY, type CurrencyCode } from '../../data/currencies';

// The club's packages — «شهري 30 يوماً بـ 10,000». A short list the owner
// edits, kept as ONE synced setting (`club_packages`, JSON) rather than a
// table: a dozen rows, edited rarely, and they must follow the account to a
// second phone. A package is a price LIST — each subscription copies the name,
// days and price at the moment it is sold, and may be sold for less (discount).

export interface ClubPackage {
  id: string;
  name: string;
  days: number;
  /** Minor units. */
  price: number;
  currency: CurrencyCode;
}

const KEY = 'club_packages';

export async function listPackages(): Promise<ClubPackage[]> {
  try {
    const raw = await getMeta(KEY);
    const list = raw ? (JSON.parse(raw) as ClubPackage[]) : [];
    return list
      .filter((p) => p && typeof p.id === 'string' && p.name && p.days > 0 && p.price >= 0)
      .sort((a, b) => a.days - b.days);
  } catch {
    return [];
  }
}

async function save(list: ClubPackage[]): Promise<void> {
  await setMeta(KEY, JSON.stringify(list));
}

export async function savePackage(input: Omit<ClubPackage, 'id' | 'currency'> & { id?: string }): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم الباقة مطلوب');
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 3660) throw new Error('عدد الأيام غير صحيح');
  if (!Number.isInteger(input.price) || input.price < 0) throw new Error('أدخل سعراً صحيحاً');
  const list = await listPackages();
  if (list.some((p) => p.name === name && p.id !== input.id)) throw new Error('توجد باقة بهذا الاسم');
  const row: ClubPackage = { id: input.id ?? uuidv4(), name, days: input.days, price: input.price, currency: BASE_CURRENCY };
  await save(input.id ? list.map((p) => (p.id === input.id ? row : p)) : [...list, row]);
}

export async function deletePackage(id: string): Promise<void> {
  await save((await listPackages()).filter((p) => p.id !== id));
}
