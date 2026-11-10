import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Requests that passed requireAuth carry the authenticated user's id.
export interface AuthedRequest extends Request {
  userId?: string;
}

/** What a verified token says. Owner tokens carry no `typ` (every token issued
 *  before staff existed looks like this); staff tokens carry `typ: 'staff'`. */
export interface TokenPayload { sub: string; typ?: string; tv?: number }

/** The Bearer token's payload, or a reason it was refused. Shared by
 *  requireAuth (owners) and requirePosActor (owners + staff), so there is ONE
 *  place that reads and verifies a token. */
export function readBearer(
  req: Request,
): { ok: true; payload: TokenPayload } | { ok: false; status: 401 | 500; error: string } {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'missing or invalid Authorization header' };
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) return { ok: false, status: 500, error: 'server misconfigured: JWT_SECRET not set' };
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), secret) as TokenPayload;
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
      return { ok: false, status: 401, error: 'invalid or expired token' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, status: 401, error: 'invalid or expired token' };
  }
}

// Verifies the Bearer JWT and attaches req.userId. Reject otherwise.
// Every protected route MUST sit behind this, and every query MUST filter
// by req.userId (tenant isolation — see CLAUDE.md).
//
// OWNERS ONLY. A staff token is refused here even though it is signed with the
// same secret: its `sub` is a staff id, and a route that read it as an owner id
// would be one typo away from treating a cashier as a shop. Staff reach the
// point of sale through requirePosActor, and nothing else.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const read = readBearer(req);
  if (!read.ok) return res.status(read.status).json({ error: read.error });
  if (read.payload.typ !== undefined) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
  req.userId = read.payload.sub;
  next();
}
