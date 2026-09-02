// ─── Arkoo Prebuild Backend Server ─────────────────────────
// Production-grade Express server with modular architecture.
// All business logic lives in services/, routes handle HTTP only.
// ────────────────────────────────────────────────────────────

import express from 'express';
import path from 'path';
import { env, UPLOADS_DIR } from './config/env.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler, requestLogger } from './middleware/error-handler.js';
import { apiRateLimiter } from './middleware/rate-limit.js';
import routes from './routes/index.js';
import { logger } from './utils/logger.js';

// ─── Initialize Firebase (side-effect: connects to Firestore)
import './config/firebase.js';

const app = express();

// ─── Global Middleware ─────────────────────────────────────
app.use(corsMiddleware);
app.use(requestLogger);

// Body parsers with safe limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Audio upload endpoint with higher limit
app.use('/api/process-meeting', express.json({ limit: '50mb' }));
app.use('/api/transcribe-chunk', express.json({ limit: '25mb' }));
app.use('/api/tasks/voice-note', express.json({ limit: '15mb' }));

// Rate limiting
app.use('/api', apiRateLimiter);

// Static file serving for uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Routes ────────────────────────────────────────────────
app.use(routes);

// ─── Global Error Handler ──────────────────────────────────
app.use(errorHandler);

// ─── Start Server ──────────────────────────────────────────
const PORT = env.PORT;
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Server', `Arkoo backend running on port ${PORT} (0.0.0.0)`, {
    env: env.NODE_ENV,
    corsOrigins: env.ALLOWED_ORIGINS.length || 'dev-wildcard',
  });
});

export default app;
