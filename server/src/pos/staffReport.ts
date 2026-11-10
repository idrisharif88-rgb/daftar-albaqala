import { pool } from '../db';

// The report on one POS staff member: sign-ins / sign-outs and sales per day.
// Read by the shop OWNER (routes/posStaff.ts, when the developer allowed it)
// and by the DEVELOPER (routes/admin.ts, always). Both are scoped to one
// owner: a member of another shop is "not found".
//
// `day` is the phone's LOCAL calendar day, as every POS row carries it. The
// sign-ins are instants; they come with a day of margin on each side and the
// app sorts them into its own local days.

type Row = Record<string, unknown>;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validRange(from: unknown, to: unknown): { from: string; to: string } | null {
  const f = String(from ?? ''); const t = String(to ?? '');
  return DAY_RE.test(f) && DAY_RE.test(t) && f <= t ? { from: f, to: t } : null;
}

export async function buildStaffReport(ownerId: string, staffId: string, from: string, to: string) {
  const [member] = await pool.query(
    'SELECT id, name FROM pos_staff WHERE id = ? AND owner_id = ?', [staffId, ownerId],
  );
  if ((member as Row[]).length === 0) return null;
  const [sessions] = await pool.query(
    `SELECT login_at, logout_at FROM pos_staff_sessions
      WHERE owner_id = ? AND staff_id = ?
        AND login_at >= DATE_SUB(?, INTERVAL 1 DAY) AND login_at < DATE_ADD(?, INTERVAL 2 DAY)
      ORDER BY login_at`,
    [ownerId, staffId, from, to],
  );
  const [days] = await pool.query(
    `SELECT day, CAST(SUM(qty) AS SIGNED) AS qty, CAST(SUM(qty * price) AS SIGNED) AS amount
       FROM pos_sales
      WHERE user_id = ? AND staff_id = ? AND day BETWEEN ? AND ?
      GROUP BY day ORDER BY day`,
    [ownerId, staffId, from, to],
  );
  const list = (days as Row[]).map((d) => ({ day: String(d.day), qty: Number(d.qty), amount: Number(d.amount) }));
  return {
    staff: (member as Row[])[0],
    sessions: sessions as Row[],
    days: list,
    totals: {
      qty: list.reduce((n, d) => n + d.qty, 0),
      amount: list.reduce((n, d) => n + d.amount, 0),
    },
  };
}

export async function reportEnabled(ownerId: string): Promise<boolean> {
  const [rows] = await pool.query('SELECT pos_report_enabled FROM users WHERE id = ?', [ownerId]);
  return Number((rows as Row[])[0]?.pos_report_enabled) === 1;
}
