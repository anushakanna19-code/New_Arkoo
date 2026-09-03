import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import { env, GEMINI_SETTINGS_FILE } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ─── Gemini AI Service ─────────────────────────────────────

let aiClient: GoogleGenAI | null = null;
let lastUsedApiKey = '';
let isPrimaryKeyDenied = false;

// ─── Settings Persistence ──────────────────────────────────

export function loadGeminiSettings(): any {
  try {
    if (fs.existsSync(GEMINI_SETTINGS_FILE)) {
      const content = fs.readFileSync(GEMINI_SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.apiKey) return parsed;
    }
  } catch (err) {
    logger.error('GeminiService', 'Failed to read gemini settings', err);
  }
  if (env.GEMINI_API_KEY) {
    return { apiKey: env.GEMINI_API_KEY };
  }
  return null;
}

export function saveGeminiSettings(data: any): void {
  try {
    fs.writeFileSync(GEMINI_SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    logger.info('GeminiService', `Saved Gemini settings to ${GEMINI_SETTINGS_FILE}`);
  } catch (err) {
    logger.error('GeminiService', 'Failed to write gemini settings', err);
  }
}

// ─── Client Initialization ─────────────────────────────────

export function getGenAI(): GoogleGenAI {
  const localSettings = loadGeminiSettings();
  let apiKey = localSettings?.apiKey || env.GEMINI_API_KEY || '';

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    apiKey = env.GEMINI_API_KEY || '';
  }

  if (!aiClient || lastUsedApiKey !== apiKey) {
    lastUsedApiKey = apiKey;
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'arkoo-backend' },
      },
    });
  }
  return aiClient;
}

// ─── Resilient Generation ──────────────────────────────────

const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

export async function generateContentWithResilience(ai: GoogleGenAI, params: any): Promise<any> {
  let lastError: any = null;

  // 1. Try with the primary AI client
  if (!isPrimaryKeyDenied) {
    for (const model of MODEL_CANDIDATES) {
      if (isPrimaryKeyDenied) break;

      logger.info('GeminiService', `Trying model: ${model}`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const callPromise = ai.models.generateContent({ ...params, model });
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Model processing timeout')), 55000)
          );
          return await Promise.race([callPromise, timeout]);
        } catch (err: any) {
          lastError = err;
          const errMsg = (err.message || String(err) || '').toLowerCase();
          logger.warn('GeminiService', `${model} attempt ${attempt} failed: ${err.message || err}`);

          if (errMsg.includes('permission_denied') || errMsg.includes('403') || errMsg.includes('disabled')) {
            isPrimaryKeyDenied = true;
            break;
          }
          if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('resource_exhausted') || errMsg.includes('503')) {
            break; // try next model
          }

          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
    }
  }

  // 2. Fallback with env key
  const fallbackKey = env.GEMINI_API_KEY || '';
  logger.info('GeminiService', 'Routing through fallback API gateway...');

  try {
    const fallbackAI = new GoogleGenAI({
      apiKey: fallbackKey,
      httpOptions: { headers: { 'User-Agent': 'arkoo-backend-fallback' } },
    });

    for (const model of MODEL_CANDIDATES) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const callPromise = fallbackAI.models.generateContent({ ...params, model });
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Model processing timeout')), 55000)
          );
          return await Promise.race([callPromise, timeout]);
        } catch (err: any) {
          lastError = err;
          const errMsg = (err.message || String(err) || '').toLowerCase();
          logger.warn('GeminiService', `Fallback ${model} attempt ${attempt} failed: ${err.message || err}`);

          if (errMsg.includes('permission_denied') || errMsg.includes('403') || errMsg.includes('disabled')) {
            break;
          }
          if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('resource_exhausted') || errMsg.includes('503')) {
            break;
          }

          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
    }
  } catch (fallbackInitErr) {
    logger.error('GeminiService', 'Failed to initialize fallback client', fallbackInitErr);
  }

  throw lastError;
}

// ─── Transcription ─────────────────────────────────────────

export async function transcribeWithGemini(fileBuffer: Buffer, mimeType: string, _meetingId: string): Promise<string> {
  const ai = getGenAI();
  const chunkBase64 = fileBuffer.toString('base64');

  const result = await generateContentWithResilience(ai, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: chunkBase64,
            },
          },
          { text: 'Listen to this audio clip. If it is spoken in Marathi, Hindi, or Hinglish, translate it accurately into clear English text. Output only the English translation without any commentary.' },
        ],
      },
    ],
  });
  return (result.text || '').trim();
}
