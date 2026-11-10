import 'dotenv/config';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import authRouter from './routes/auth';
import customersRouter from './routes/customers';
import transactionsRouter from './routes/transactions';
import syncRouter from './routes/sync';
import posSyncRouter from './routes/posSync';
import { requirePos } from './middleware/requirePos';
import attachmentsRouter, { attachmentsBodyParser } from './routes/attachments';
import accountRouter from './routes/account';
import adminRouter from './routes/admin';
import { requireAuth, AuthedRequest } from './middleware/auth';
import { requirePosActor, requireStaffFeature, requireStaffManager } from './middleware/posActor';
import staffAuthRouter from './routes/staffAuth';
import posStaffRouter from './routes/posStaff';
import posChatRouter from './routes/posChat';
import { requireSubscription, requireNotSuspended, appOf } from './middleware/requireSubscription';
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
//
// /attachments is the one exception: an upload body is a base64 image or PDF,
// far above 2 MB, so it carries its OWN parser (a higher limit, mounted on that
// router) and this global one must step aside — otherwise it rejects the body
// here, before the router's parser is ever reached.
const globalJson = express.json({ limit: '2mb' });
app.use((req, res, next) =>
  req.path.startsWith('/attachments') ? next() : globalJson(req, res, next),
);

// The privacy policy, served as a plain file from server/public.
//
// It lives on the API's own host because nginx already proxies everything
// there: nothing extra to configure, and no way for the page to be reachable
// in the app but missing on the web. A privacy link that 404s is worse than no
// link — a reviewer reads it as an app hiding what it does.
//
// This is the ONLY static path. Everything else here is JSON, and the
// directory holds exactly one file, so there is nothing else to expose.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check — confirms the server is alive and reachable.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'daftar-api',
    time: new Date().toISOString(),
  });
});

// Auth: POST /auth/register, POST /auth/login. Staff: POST /auth/staff/login.
app.use('/auth/staff', staffAuthRouter);
app.use('/auth', authRouter);

// Customers CRUD — all behind requireAuth, every query filtered by req.userId.
app.use('/customers', requireAuth, requireNotSuspended, customersRouter);

// Transactions (append-only) — behind requireAuth, every query filtered by req.userId.
app.use('/transactions', requireAuth, requireNotSuspended, transactionsRouter);

// The account itself. Behind requireAuth but NOT requireSubscription: an
// account that was never activated is the likeliest one to be deleted, and
// gating deletion on the flag that blocked it would trap someone in an account
// they can neither use nor leave. DELETE /account.
app.use('/account', requireAuth, accountRouter);

// Sync — phone pushes offline changes up. Behind requireAuth, every record
// checked against req.userId. requireSubscription gates the PAID cloud feature:
// sync is refused (402) unless the user's subscription is active and unexpired.
// POST /sync/push, GET /sync/pull.
app.use('/sync', requireAuth, requireSubscription, syncRouter);

// Point of sale: its own sync, same gates plus «the section was switched on
// for this account» (users.pos_enabled). The ONE place a staff token is
// accepted: requirePosActor sets req.userId to the OWNER for staff too, so the
// gates below check the owner's subscription and POS switch.
app.use('/pos-sync', requirePosActor, requireSubscription, requirePos, posSyncRouter);

// The shop's POS staff. Only where the DEVELOPER switched staff accounts on
// (requireStaffFeature), and only for the owner or a member holding
// `manage_staff` (requireStaffManager). routes/posStaff.ts adds the rules that
// keep a staff manager from handing out more than they hold.
app.use(
  '/pos-staff',
  requirePosActor, requireNotSuspended, requirePos, requireStaffFeature, requireStaffManager,
  posStaffRouter,
);

// Private chat owner ↔ each staff member (routes/posChat.ts decides who sees
// which conversation). Same shop switches as staff accounts.
app.use('/pos-chat', requirePosActor, requireNotSuspended, requirePos, requireStaffFeature, posChatRouter);

// Attachments — a file pinned to an entry. Behind the same gates as sync (it is
// part of the paid cloud backup) and tenant-filtered by req.userId. The global
// JSON parser skips this path (above), so the router's own larger parser is the
// one that reads the upload body.
app.use(
  '/attachments',
  requireAuth, requireSubscription, requireNotSuspended,
  attachmentsBodyParser, attachmentsRouter,
);

// The Watcher app (the owner's admin view over every account). Its own login
// (phone + admin password + authenticator code) and its own token — see
// routes/admin.ts and middleware/requireAdmin.ts. NOT behind requireAuth: a
// shopkeeper token must never open it.
app.use('/admin', adminRouter);

// Protected test route — returns the user named in the JWT.
app.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.query(
      'SELECT id, phone, store_name, plan, subscription_status, contractor_status, drive_backup, pos_enabled, pos_staff_enabled, pos_notes_enabled, sync_consent FROM users WHERE id = ?',
      [req.userId]
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) return res.status(404).json({ error: 'user not found' });
    const { contractor_status: contractorStatus, ...user } = row;
    // Drive backup: granted per account by the owner — and always on for a book
    // WITHOUT server sync, which would otherwise live on one phone with no copy
    // anywhere. Each app has its own sync switch, so ask about the app calling.
    const syncOn = appOf(req) === 'contractor'
      ? contractorStatus === 'active'
      : user.subscription_status === 'active';
    const driveBackup = Number(user.drive_backup) === 1 || !syncOn;
    return res.json({
      user: {
        ...user, drive_backup: driveBackup, pos_enabled: Number(user.pos_enabled) === 1,
        pos_staff_enabled: Number(user.pos_staff_enabled) === 1,
        pos_notes_enabled: Number(user.pos_notes_enabled) === 1,
      },
    });
  })
);

// Catch-all error handler (async route rejections land here).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

export default app;
