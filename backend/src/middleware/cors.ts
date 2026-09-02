import { Request, Response, NextFunction } from 'express';
import { getCorsHeaders } from '../config/cors.js';

/**
 * CORS middleware.
 * Applies proper CORS headers based on the request origin and allowed origins config.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const headers = getCorsHeaders(origin);

  for (const [key, value] of Object.entries(headers)) {
    res.header(key, value);
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
}
