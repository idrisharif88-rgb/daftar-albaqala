import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Guards the /admin routes (the Watcher app). These are the ONLY routes that
// read across tenants, on purpose — so the door is separate from the
// shopkeepers' one in every way that matters:
//
//  - a DIFFERENT signing secret (ADMIN_JWT_SECRET, not JWT_SECRET), so no
//    shopkeeper token can ever verify here, and an admin token can never pass
//    requireAuth as some user;
//  - a role claim checked on top of the signature;
//  - a short lifetime (see routes/admin.ts), so a lost phone is not a key for
//    a month.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing or invalid Authorization header' });
  }
  const secret = adminJwtSecret();
  if (!secret) {
    return res.status(503).json({ error: 'admin is not configured on this server' });
  }
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), secret) as { role?: string };
    if (payload.role !== 'admin') throw new Error('not admin');
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired admin token' });
  }
}

/**
 * The admin signing secret — or null when it is missing, too short, or the
 * same as the shopkeepers' secret (which would let one kind of token pass for
 * the other).
 */
export function adminJwtSecret(): string | null {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32 || s === process.env.JWT_SECRET) return null;
  return s;
}
