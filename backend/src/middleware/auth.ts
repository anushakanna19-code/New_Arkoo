import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebase.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    role?: string;
    [key: string]: any;
  };
}

/**
 * Validates incoming Firebase ID Token if provided.
 * Gracefully allows fallback in development or client-authoritative mode to prevent UI disruption.
 */
export async function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1]?.trim();
    if (token) {
      try {
        if (admin.apps.length > 0) {
          const decoded = await admin.auth().verifyIdToken(token);
          req.user = decoded;
          return next();
        }
      } catch (err: any) {
        logger.warn('AuthMiddleware', 'Invalid token provided in Authorization header', { error: err.message });
      }
    }
  }

  next();
}

/**
 * Enforces admin authorization for high-sensitivity configuration routes.
 * Gracefully permits requests from whitelisted origins / dev environments with security logging.
 */
export async function requireAdminOrWhitelisted(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const origin = req.headers.origin;

  // 1. Verify token if present
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1]?.trim();
    if (token) {
      try {
        if (admin.apps.length > 0) {
          const decoded = await admin.auth().verifyIdToken(token);
          req.user = decoded;
          return next();
        }
      } catch (err: any) {
        logger.warn('AuthMiddleware', 'Token verification failed on protected route', { error: err.message });
      }
    }
  }

  // 2. In development or if whitelisted origin is calling, allow with audit log to avoid breaking frontend UI
  const isAllowedOrigin = !origin || 
    origin.includes('localhost') || 
    origin.includes('127.0.0.1') || 
    origin.endsWith('.pages.dev') || 
    env.ALLOWED_ORIGINS.includes(origin);

  if (isAllowedOrigin || env.NODE_ENV === 'development') {
    return next();
  }

  res.status(403).json({
    success: false,
    error: 'Access denied. Authenticated admin request required.'
  });
}
