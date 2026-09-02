import { Router } from 'express';
import healthRoutes from './health.routes.js';
import emailRoutes from './email.routes.js';
import settingsRoutes from './settings.routes.js';
import transcriptionRoutes from './transcription.routes.js';
import meetingRoutes from './meeting.routes.js';
import gdriveRoutes from './gdrive.routes.js';

const router = Router();

// ─── Health Probes (root and /api) ─────────────────────────
router.use('/', healthRoutes);
router.use('/api', healthRoutes);

// ─── API Routes ────────────────────────────────────────────
router.use('/api', emailRoutes);
router.use('/api', settingsRoutes);
router.use('/api', transcriptionRoutes);
router.use('/api', meetingRoutes);
router.use('/api/gdrive', gdriveRoutes);

export default router;
