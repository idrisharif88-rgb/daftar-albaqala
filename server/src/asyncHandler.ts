import { Request, Response, NextFunction } from 'express';

// Wraps an async route so a rejected promise is forwarded to Express's
// error handler instead of hanging the request (Express 4 doesn't catch these).
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
