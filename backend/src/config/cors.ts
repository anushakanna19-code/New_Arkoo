import { env } from './env.js';
import type { CorsOptions } from '../types/common.js';

/**
 * CORS configuration.
 * Uses explicit origin whitelist from env. Falls back to same-origin only in production.
 */
export function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (env.ALLOWED_ORIGINS.length > 0 && origin && env.ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  } else if (env.NODE_ENV === 'development') {
    // Only allow wildcard in development
    headers['Access-Control-Allow-Origin'] = origin || '*';
    headers['Vary'] = 'Origin';
  }
  // In production with no matching origin: no Access-Control-Allow-Origin header → browser blocks

  return headers;
}
