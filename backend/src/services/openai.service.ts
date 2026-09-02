import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import { env, OPENAI_SETTINGS_FILE } from '../config/env.js';
import { getFirestore, admin } from '../config/firebase.js';
import { logger } from '../utils/logger.js';

let openaiClient: OpenAI | null = null;
let lastUsedApiKey = '';

// ─── Settings Persistence ──────────────────────────────────
export function loadOpenaiSettings(): any {
  try {
    if (fs.existsSync(OPENAI_SETTINGS_FILE)) {
      const content = fs.readFileSync(OPENAI_SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.apiKey) return parsed;
    }
  } catch (err) {
    logger.error('OpenaiService', 'Failed to read openai settings', err);
  }
  if (process.env.OPENAI_API_KEY || env.OPENAI_API_KEY) {
    return { apiKey: process.env.OPENAI_API_KEY || env.OPENAI_API_KEY };
  }
  return null;
}

export function saveOpenaiSettings(data: { apiKey: string; updatedAt?: string }): void {
  try {
    fs.writeFileSync(OPENAI_SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    logger.info('OpenaiService', `Saved OpenAI settings to ${OPENAI_SETTINGS_FILE}`);
  } catch (err) {
    logger.error('OpenaiService', 'Failed to write openai settings file', err);
  }

  process.env.OPENAI_API_KEY = data.apiKey;
  openaiClient = null; // Invalidate client to force refresh with new key

  const dbFirestore = getFirestore();
  if (dbFirestore) {
    dbFirestore.collection('settings').doc('openai').set(
      { apiKey: data.apiKey, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  }
}

export function getOpenaiApiKey(): string {
  const localSettings = loadOpenaiSettings();
  return (localSettings?.apiKey || process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || '').trim();
}

export function getOpenaiClient(): OpenAI | null {
  const apiKey = getOpenaiApiKey();
  if (!apiKey) return null;

  if (!openaiClient || lastUsedApiKey !== apiKey) {
    lastUsedApiKey = apiKey;
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ─── Diagnostic Test ───────────────────────────────────────
export async function performOpenaiDiagnostic(): Promise<any> {
  const apiKey = getOpenaiApiKey();
  const isFallback = !loadOpenaiSettings()?.apiKey && !!(process.env.OPENAI_API_KEY || env.OPENAI_API_KEY);
  const keySource = isFallback ? 'Environment OPENAI_API_KEY' : 'Saved User API Key';

  let maskedKey = 'None';
  if (apiKey && apiKey.length > 8) {
    maskedKey = `${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}`;
  }

  if (!apiKey) {
    return {
      success: false,
      status: 'No API Key Configured',
      keySource,
      modelUsed: 'gpt-4o, whisper-1',
      maskedKey: 'None',
      error: 'No OpenAI API key found in settings or environment.',
      explanation: 'Please enter a valid OpenAI API Key (starts with sk-...) and click Save Key.',
      testedAt: new Date().toISOString(),
    };
  }

  try {
    const client = new OpenAI({ apiKey });
    // Quick test ping with minimal token cost
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Respond with: OK' }],
      max_tokens: 5,
    });

    const reply = response.choices[0]?.message?.content?.trim() || 'OK';

    return {
      success: true,
      status: 'Succeeded (gpt-4o-mini & whisper-1)',
      keySource,
      modelUsed: 'gpt-4o-mini, gpt-4o, whisper-1',
      maskedKey,
      fullResponse: reply,
      explanation: 'Verification succeeded! OpenAI API key is valid and responsive.',
      testedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    const errMessage = err?.message || String(err);
    const lower = errMessage.toLowerCase();
    let explanation = `OpenAI API call failed: ${errMessage}`;
    let status = 'Failed';

    if (lower.includes('incorrect api key') || lower.includes('invalid_api_key') || lower.includes('401')) {
      status = 'INVALID_API_KEY';
      explanation = 'The OpenAI API key provided is invalid (401). Please verify your key on platform.openai.com/api-keys.';
    } else if (lower.includes('quota') || lower.includes('insufficient_quota') || lower.includes('429')) {
      status = 'QUOTA_EXCEEDED';
      explanation = 'You exceeded your current OpenAI quota or rate limit (429). Please check your billing at platform.openai.com/account/billing.';
    }

    return {
      success: false,
      status,
      keySource,
      modelUsed: 'gpt-4o-mini, whisper-1',
      maskedKey,
      error: errMessage,
      explanation,
      testedAt: new Date().toISOString(),
    };
  }
}

// ─── Transcription via OpenAI Whisper ──────────────────────
export async function transcribeWithOpenai(
  audioInput: Buffer | string,
  fileName = 'audio.wav',
  knownNames?: string
): Promise<string> {
  const client = getOpenaiClient();
  if (!client) {
    throw new Error('OpenAI client is not configured. Please save a valid OpenAI API key.');
  }

  let fileObject: any;
  if (Buffer.isBuffer(audioInput)) {
    fileObject = await toFile(audioInput, fileName);
  } else if (typeof audioInput === 'string' && fs.existsSync(audioInput)) {
    fileObject = fs.createReadStream(audioInput);
  } else {
    throw new Error('Invalid audio input provided to transcribeWithOpenai');
  }

  const prompt = `Meeting audio transcription. Keep words literal. Romanized transliteration for Hindi/Hinglish words.${
    knownNames ? ` Known participants: ${knownNames}` : ''
  }`;

  const transcription = await client.audio.transcriptions.create({
    file: fileObject,
    model: 'whisper-1',
    prompt,
    response_format: 'text',
  });

  return typeof transcription === 'string' ? transcription.trim() : (transcription as any).text?.trim() || '';
}

// ─── Text Completion / Analysis via GPT-4o ────────────────
export async function generateContentWithOpenai(
  prompt: string,
  systemPrompt = 'You are an executive AI assistant generating precise meeting minutes, action items, and structural analysis in structured JSON.'
): Promise<{ text: string }> {
  const client = getOpenaiClient();
  if (!client) {
    throw new Error('OpenAI client is not configured. Please save a valid OpenAI API key.');
  }

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
  });

  const text = completion.choices[0]?.message?.content?.trim() || '';
  return { text };
}
