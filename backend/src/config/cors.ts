import { env } from './env.js';

/**
 * Production-ready CORS configuration.
 * Safely whitelists production domain, Cloudflare Pages previews (*.pages.dev), and explicit origins.
 */
export function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400', // 24 hours preflight cache
  };

  if (!origin) {
    return headers;
  }

  const isWhitelisted = 
    env.ALLOWED_ORIGINS.includes(origin) ||
    origin === 'https://new-arkoo.pages.dev' ||
    origin.endsWith('.new-arkoo.pages.dev') ||
    origin.endsWith('.pages.dev') ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:');

  if (isWhitelisted) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  } else if (env.NODE_ENV === 'development') {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }

  return headers;
}
