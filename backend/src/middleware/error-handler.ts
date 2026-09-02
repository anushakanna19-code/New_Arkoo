import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Global error handler middleware.
 * Catches unhandled errors from route handlers and sends a clean response.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('ErrorHandler', `Unhandled error on ${req.method} ${req.path}`, err);

  const statusCode = (err as any).statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An internal server error occurred'
    : err.message || 'An internal server error occurred';

  res.status(statusCode).json({
    success: false,
    error: message,
  });
}

/**
 * Request logging middleware.
 * Logs incoming requests with method, path, and response time.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('HTTP', `${req.method} ${req.path} ${res.statusCode}`, {
      duration: `${duration}ms`,
      ip: req.ip,
      contentLength: res.get('Content-Length'),
    });
  });

  next();
}
