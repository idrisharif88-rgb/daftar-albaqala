import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';
import { normalizePhone } from '../auth/phone';

const router = Router();

// Signs a 30-day login token carrying the user id as `sub`.
function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ sub: userId }, secret, { expiresIn: '30d' });
}

// POST /auth/register — create an account, return a token.
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { phone, password, store_name } = req.body ?? {};
    const normPhone = normalizePhone(phone);
    if (!normPhone || !password) {
      return res.status(400).json({ error: 'phone and password are required' });
    }
    if (!/^\d{6,20}$/.test(normPhone)) {
      return res.status(400).json({ error: 'phone must be 6–20 digits' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    // Only another OWNER account takes the number. A staff login with the
    // same number is a separate path («دخول موظف»), so a cashier may have a
    // book of their own.
    const [existing] = await pool.query('SELECT 1 FROM users WHERE phone = ? LIMIT 1', [normPhone]);
    if ((existing as unknown[]).length > 0) {
      return res.status(409).json({ error: 'phone already registered' });
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(String(password), 10);
    const now = new Date();

    await pool.query(
      `INSERT INTO users (id, phone, password_hash, store_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, normPhone, passwordHash, store_name ?? null, now, now]
    );

    const token = signToken(id);
    return res.status(201).json({
      token,
      user: { id, phone: normPhone, store_name: store_name ?? null },
    });
  })
);

// POST /auth/login — verify credentials, return a token.
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { phone, password } = req.body ?? {};
    const normPhone = normalizePhone(phone);
    if (!normPhone || !password) {
      return res.status(400).json({ error: 'phone and password are required' });
    }

    const [rows] = await pool.query(
      'SELECT id, phone, password_hash, store_name, subscription_status FROM users WHERE phone = ?',
      [normPhone]
    );
    const user = (rows as Array<Record<string, string>>)[0];

    // Same generic message whether the phone or the password is wrong.
    const ok = user && (await bcrypt.compare(String(password), user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'invalid phone or password' });
    }

    // Suspended by the owner (Watcher app): no new session. Checked only AFTER
    // the password, so this answer never tells a stranger the number exists.
    if (user.subscription_status === 'suspended') {
      return res.status(403).json({ error: 'account suspended' });
    }

    const token = signToken(user.id);
    return res.json({
      token,
      user: { id: user.id, phone: user.phone, store_name: user.store_name },
    });
  })
);

export default router;
