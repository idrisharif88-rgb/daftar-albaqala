import { Request, Response, NextFunction } from 'express';
import {
  verifyCode, isUsed, markUsed, isLocked, recordFailure, totpSecret,
} from '../admin/totpGate';

// The second lock on every admin CHANGE (status, edit, delete, reverse): the
// owner's authenticator code, sent in the request body as `code`. Login checks
// the same secret and the replay counter is shared, so one code authorises
// exactly one thing — a login OR a single change, never two.
export function requireAdminCode(req: Request, res: Response, next: NextFunction) {
  if (!totpSecret()) {
    return res.status(503).json({ error: 'admin is not configured on this server' });
  }
  if (isLocked()) {
    return res.status(429).json({ error: 'too many attempts, try later' });
  }

  const step = verifyCode(req.body?.code);
  if (step === null || isUsed(step)) {
    recordFailure();
    // 403, not 401: a 401 would trip the client's session-expiry handler and
    // log the owner out for a mere mistyped code.
    return res.status(403).json({ error: 'invalid or used authenticator code' });
  }

  markUsed(step);
  next();
}
