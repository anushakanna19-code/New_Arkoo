import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// ─── Resolve Directories ───────────────────────────────────
const __filenameResolved = typeof import.meta !== 'undefined' && import.meta.url
  ? fileURLToPath(import.meta.url)
  : (typeof __filename !== 'undefined' ? __filename : '');

const __dirnameResolved = typeof __dirname !== 'undefined' && __dirname !== ''
  ? __dirname
  : (__filenameResolved ? path.dirname(__filenameResolved) : process.cwd());

// Load .env from multiple possible locations
dotenv.config({ path: path.join(__dirnameResolved, '..', '.env'), override: true });
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env'), override: true });
dotenv.config({ override: true });

// ─── Directory Resolution ──────────────────────────────────
export const BACKEND_DIR = fs.existsSync(path.join(__dirnameResolved, '..'))
  ? path.resolve(__dirnameResolved, '..')
  : path.join(process.cwd(), 'backend');

export const CONFIG_DIR = fs.existsSync(path.join(BACKEND_DIR, 'config'))
  ? path.join(BACKEND_DIR, 'config')
  : path.join(process.cwd(), 'backend', 'config');

export const UPLOADS_DIR = (() => {
  const dir = fs.existsSync(path.join(BACKEND_DIR, 'uploads'))
    ? path.join(BACKEND_DIR, 'uploads')
    : path.join(process.cwd(), 'backend', 'uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
})();

// ─── Environment Variables ─────────────────────────────────
export const env = {
  // Server
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),

  // CORS
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),

  // Gemini AI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  // SMTP / Email
  SMTP_HOST: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '465', 10),
  GMAIL_USER: (process.env.GMAIL_USER || process.env.SMTP_USER || '').trim(),
  GMAIL_APP_PASSWORD: (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '').trim(),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
  CLOUDINARY_API_KEY: (process.env.CLOUDINARY_API_KEY || '').trim(),
  CLOUDINARY_API_SECRET: (process.env.CLOUDINARY_API_SECRET || '').trim(),

  // Google OAuth
  GOOGLE_CLIENT_ID: (process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || '').trim(),
  GOOGLE_CLIENT_SECRET: (process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || '').trim(),
} as const;

// ─── Settings File Paths ───────────────────────────────────
export const GDRIVE_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, 'gdrive-settings.json'))
  ? path.join(CONFIG_DIR, 'gdrive-settings.json')
  : path.join(process.cwd(), 'gdrive-settings.json');

export const GEMINI_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, 'gemini-settings.json'))
  ? path.join(CONFIG_DIR, 'gemini-settings.json')
  : path.join(process.cwd(), 'gemini-settings.json');

export const CLOUDINARY_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, 'cloudinary-settings.json'))
  ? path.join(CONFIG_DIR, 'cloudinary-settings.json')
  : path.join(process.cwd(), 'cloudinary-settings.json');
