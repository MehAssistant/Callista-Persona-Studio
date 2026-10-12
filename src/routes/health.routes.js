import { Router } from 'express';
import config from '../config/index.js';

const router = Router();

/**
 * GET /api/health
 * Endpoint pemeriksaan status kesehatan server
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      service: config.appName,
      environment: config.env,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
