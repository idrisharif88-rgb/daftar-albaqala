import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import authRouter from './routes/auth';
import customersRouter from './routes/customers';
import transactionsRouter from './routes/transactions';
import syncRouter from './routes/sync';
import { requireAuth, AuthedRequest } from './middleware/auth';
import { requireSubscription } from './middleware/requireSubscription';
import { asyncHandler } from './asyncHandler';
import { pool } from './db';

// The configured Express app, with NO app.listen() — so tests can drive it
// in-process (via supertest) and the real server (index.ts) can bind a port.
const app = express();

// Parse JSON request bodies.
//
// The default limit is 100 KB, which a sync push can exceed easily: a phone
// that has been offline for a fortnight uploads its whole backlog in one body,
// and past roughly 400 rows every sync attempt died with a 413 that the app
// reported as a generic failure. The client now chunks its push (see
// src/data/sync.ts), so this ceiling is headroom rather than the mechanism —
// but it has to be above the chunk size, not below it.
//
// 🧩 Server concept: body limits are a denial-of-service control, not a
// formality. Removing the cap entirely would let one authenticated request ask
// the 1GB droplet to buffer an arbitrarily large body in memory. The number
// should be the largest legitimate request, and no larger.
app.use(express.json({ limit: '2mb' }));

// Health check — confirms the server is alive and reachable.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'daftar-api',
    time: new Date().toISOString(),
  });
});

// Auth: POST /auth/register, POST /auth/login.
app.use('/auth', authRouter);

// Customers CRUD — all behind requireAuth, every query filtered by req.userId.
app.use('/customers', requireAuth, customersRouter);

// Transactions (append-only) — behind requireAuth, every query filtered by req.userId.
app.use('/transactions', requireAuth, transactionsRouter);

// Sync — phone pushes offline changes up. Behind requireAuth, every record
// checked against req.userId. requireSubscription gates the PAID cloud feature:
// sync is refused (402) unless the user's subscription is active and unexpired.
// POST /sync/push, GET /sync/pull.
app.use('/sync', requireAuth, requireSubscription, syncRouter);

// Protected test route — returns the user named in the JWT.
app.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.query(
      'SELECT id, phone, store_name, plan, subscription_status FROM users WHERE id = ?',
      [req.userId]
    );
    const user = (rows as unknown[])[0];
    if (!user) return res.status(404).json({ error: 'user not found' });
    return res.json({ user });
  })
);

// Catch-all error handler (async route rejections land here).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

export default app;
