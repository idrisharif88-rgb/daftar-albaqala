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

// POST /auth/register — create an account, return a token.
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, store_name } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const normEmail = String(email).trim().toLowerCase();
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normEmail]);
    if ((existing as unknown[]).length > 0) {
      return res.status(409).json({ error: 'email already registered' });
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(String(password), 10);
    const now = new Date();

    await pool.query(
      `INSERT INTO users (id, email, password_hash, store_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, normEmail, passwordHash, store_name ?? null, now, now]
    );

    const token = signToken(id);
    return res.status(201).json({
      token,
      user: { id, email: normEmail, store_name: store_name ?? null },
    });
  })
);

// POST /auth/login — verify credentials, return a token.
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const normEmail = String(email).trim().toLowerCase();
    const [rows] = await pool.query(
      'SELECT id, email, password_hash, store_name FROM users WHERE email = ?',
      [normEmail]
    );
    const user = (rows as Array<Record<string, string>>)[0];

    // Same generic message whether the email or the password is wrong.
    const ok = user && (await bcrypt.compare(String(password), user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'invalid email or password' });
    }

    const token = signToken(user.id);
    return res.json({
      token,
      user: { id: user.id, email: user.email, store_name: user.store_name },
    });
  })
);

export default router;
