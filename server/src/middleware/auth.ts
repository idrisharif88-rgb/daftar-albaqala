import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Requests that passed requireAuth carry the authenticated user's id.
export interface AuthedRequest extends Request {
  userId?: string;
}

// Verifies the Bearer JWT and attaches req.userId. Reject otherwise.
// Every protected route MUST sit behind this, and every query MUST filter
// by req.userId (tenant isolation — see CLAUDE.md).
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing or invalid Authorization header' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'server misconfigured: JWT_SECRET not set' });
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, secret) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}
