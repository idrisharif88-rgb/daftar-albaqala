import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import authRouter from './routes/auth';
import customersRouter from './routes/customers';
import transactionsRouter from './routes/transactions';
import { requireAuth, AuthedRequest } from './middleware/auth';
import { asyncHandler } from './asyncHandler';
import { pool } from './db';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3002;

// Parse JSON request bodies.
app.use(express.json());

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

// Protected test route — returns the user named in the JWT.
app.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.query(
      'SELECT id, email, store_name, plan, subscription_status FROM users WHERE id = ?',
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

app.listen(PORT, () => {
  console.log(`daftar-api listening on port ${PORT}`);
});
