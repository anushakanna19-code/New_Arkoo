import { Router } from 'express';

const router = Router();

/**
 * Liveness probe — returns 200 if the process is running.
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness probe — checks critical dependencies.
 */
router.get('/readiness', async (_req, res) => {
  const checks: Record<string, string> = {};

  // Check Firebase
  try {
    const { getFirestore } = await import('../config/firebase.js');
    const db = getFirestore();
    checks.firestore = db ? 'connected' : 'unavailable';
  } catch {
    checks.firestore = 'error';
  }

  // Check Gemini API key
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  checks.gemini = hasGeminiKey ? 'configured' : 'not_configured';

  // Check SMTP
  const hasSmtp = !!(process.env.GMAIL_APP_PASSWORD && process.env.GMAIL_APP_PASSWORD.trim());
  checks.smtp = hasSmtp ? 'configured' : 'not_configured';

  const allHealthy = checks.firestore !== 'error';

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
