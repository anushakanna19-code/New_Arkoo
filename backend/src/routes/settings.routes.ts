import { Router } from 'express';
import { getGenAI, loadGeminiSettings, saveGeminiSettings } from '../services/gemini.service.js';
import { loadCloudinarySettings, saveCloudinarySettings } from '../services/cloudinary.service.js';
import { getFirestore, admin } from '../config/firebase.js';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';

const router = Router();

// ─── Save Gemini API Key ──────────────────────────────────
router.post('/gemini/save-key', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: 'API Key cannot be empty' });
    }

    const keyClean = apiKey.trim();
    process.env.GEMINI_API_KEY = keyClean;
    saveGeminiSettings({ apiKey: keyClean, updatedAt: new Date().toISOString() });

    const dbFirestore = getFirestore();
    if (dbFirestore) {
      dbFirestore.collection('settings').doc('gemini').set(
        { apiKey: keyClean, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      ).catch(() => {});
    }

    logger.info('SettingsRoutes', 'Gemini API Key updated successfully');
    res.json({ success: true, message: 'Gemini API Key updated successfully!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update Gemini API key' });
  }
});

// ─── Gemini Diagnostic ────────────────────────────────────
router.get('/gemini-diagnostic', async (_req, res) => {
  const localSettings = loadGeminiSettings();
  let activeKey = localSettings?.apiKey || process.env.GEMINI_API_KEY || '';
  let isFallback = false;

  if (!activeKey || activeKey === 'MY_GEMINI_API_KEY' || activeKey.trim() === '') {
    activeKey = process.env.GEMINI_API_KEY || '';
    isFallback = true;
  }

  const keySource = isFallback ? 'Environment GEMINI_API_KEY' : 'Saved User API Key';
  let maskedKey = 'None';
  if (activeKey && activeKey.length > 10) {
    maskedKey = `${activeKey.substring(0, 6)}...${activeKey.substring(activeKey.length - 4)}`;
  }

  const modelCandidates = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-lite'];
  const results: { model: string; status: string; error?: string }[] = [];
  let succeedingModel = '';
  let fullResponse = '';
  let success = false;
  let summaryStatus = 'Checking...';
  let explanation = '';

  const testGenAI = new GoogleGenAI({
    apiKey: activeKey,
    httpOptions: { headers: { 'User-Agent': 'arkoo-diagnostic' } },
  });

  for (const model of modelCandidates) {
    try {
      const response = await testGenAI.models.generateContent({
        model,
        contents: 'Respond with the word: OK',
      });

      if (response?.text) {
        results.push({ model, status: 'Succeeded' });
        if (!success) {
          success = true;
          succeedingModel = model;
          fullResponse = response.text.trim();
          summaryStatus = `Succeeding (${model})`;
        }
        break;
      } else {
        results.push({ model, status: 'Empty Response', error: 'API returned empty text' });
      }
    } catch (err: any) {
      results.push({ model, status: 'Failed', error: err.message || String(err) });
    }
  }

  if (success) {
    explanation = `Verification succeeded on ${succeedingModel}! Services are functional.`;
  } else {
    const lastError = results[results.length - 1]?.error || '';
    const errStr = lastError.toLowerCase();

    if (errStr.includes('429') || errStr.includes('quota') || errStr.includes('resource_exhausted')) {
      summaryStatus = 'RESOURCE_EXHAUSTED';
      explanation = 'API quota exhausted. Consider a higher-tier API key.';
    } else if (errStr.includes('403') || errStr.includes('permission_denied') || errStr.includes('disabled')) {
      summaryStatus = 'PERMISSION_DENIED';
      explanation = 'Access denied (403). Check API key and project permissions.';
    } else {
      summaryStatus = 'Failed';
      explanation = `All models failed: ${lastError}`;
    }
  }

  res.json({
    success,
    status: summaryStatus,
    keySource,
    modelUsed: success ? succeedingModel : modelCandidates.join(', '),
    maskedKey,
    error: success ? null : JSON.stringify(results, null, 2),
    explanation,
    fullResponse,
    results,
    testedAt: new Date().toISOString(),
  });
});

// ─── Save Cloudinary Keys ─────────────────────────────────
router.post('/cloudinary/save-keys', async (req, res) => {
  try {
    const { cloudName, apiKey, apiSecret } = req.body;
    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Missing Cloudinary Cloud Name, API Key, or API Secret' });
    }

    const payload = {
      cloudName: cloudName.trim(),
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      updatedAt: new Date().toISOString(),
    };

    saveCloudinarySettings(payload);

    const dbFirestore = getFirestore();
    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('cloudinary').set(payload, { merge: true });
      } catch (dbErr: any) {
        logger.warn('SettingsRoutes', 'Failed to save Cloudinary keys in Firestore', { error: dbErr.message });
      }
    }

    res.json({ success: true, message: 'Cloudinary credentials saved successfully!' });
  } catch (err: any) {
    logger.error('SettingsRoutes', 'Cloudinary save error', err);
    res.status(500).json({ error: err.message || 'Failed to save Cloudinary settings' });
  }
});

// ─── Compatibility Aliases ─────────────────────────────────
router.get('/openai-diagnostic', (req, res, next) => {
  req.url = '/gemini-diagnostic';
  router.handle(req, res, next);
});

router.post('/openai/save-key', (req, res, next) => {
  req.url = '/gemini/save-key';
  router.handle(req, res, next);
});

router.get('/openai/status', (_req, res) => {
  const localSettings = loadGeminiSettings();
  const hasKey = !!(localSettings?.apiKey || process.env.GEMINI_API_KEY);
  res.json({ connected: hasKey, active: hasKey });
});

export default router;
