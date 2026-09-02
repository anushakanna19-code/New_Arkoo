import { Router } from 'express';

const router = Router();

/**
 * Root service status — returns 200 with service information.
 * Accessible at https://new-arkoo.onrender.com/
 */
router.get('/', (_req, res) => {
  res.json({
    service: 'arkoo-backend',
    name: 'Arkoo CRM Backend API',
    status: 'healthy',
    version: '2.0.0',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      apiHealth: '/api/health',
      readiness: '/readiness',
      apiReadiness: '/api/readiness',
    },
  });
});

/**
 * Liveness probes — returns 200 if the process is running.
 * Accessible at /health and /api/health
 */
router.get(['/health', '/api/health'], (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'arkoo-backend',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness probes — checks critical dependencies and active AI engines.
 * Accessible at /readiness and /api/readiness
 */
router.get(['/readiness', '/api/readiness'], async (_req, res) => {
  const checks: Record<string, string> = {};

  // Check Firebase
  try {
    const { getFirestore } = await import('../config/firebase.js');
    const db = getFirestore();
    checks.firestore = db ? 'connected' : 'unavailable';
  } catch {
    checks.firestore = 'error';
  }

  // Check OpenAI API key
  try {
    const { getOpenaiApiKey } = await import('../services/openai.service.js');
    const hasOpenaiKey = !!getOpenaiApiKey();
    checks.openai = hasOpenaiKey ? 'configured' : 'not_configured';
  } catch {
    checks.openai = 'not_configured';
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
