import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../asyncHandler';

const router = Router();

// Signs a 30-day login token carrying the user id as `sub`.
function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ sub: userId }, secret, { expiresIn: '30d' });
}

// Phone is the login identity (Yemen is phone-first; many users have no email).
// Normalize to digits only — strips spaces, dashes and a leading +, so the same
// number typed different ways maps to one account. App-layer uniqueness, mirroring
// how customer phones are handled (see CLAUDE.md).
function normalizePhone(raw: unknown): string {
  return String(raw ?? '').replace(/[\s-]/g, '').replace(/^\+/, '');
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

    const [existing] = await pool.query('SELECT id FROM users WHERE phone = ?', [normPhone]);
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
      'SELECT id, phone, password_hash, store_name FROM users WHERE phone = ?',
      [normPhone]
    );
    const user = (rows as Array<Record<string, string>>)[0];

    // Same generic message whether the phone or the password is wrong.
    const ok = user && (await bcrypt.compare(String(password), user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'invalid phone or password' });
    }

    const token = signToken(user.id);
    return res.json({
      token,
      user: { id: user.id, phone: user.phone, store_name: user.store_name },
    });
  })
);

export default router;
