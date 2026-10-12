import { Router } from 'express';
import { eventsController } from '../controllers/events.controller.js';

const router = Router();

// GET /api/events - Server-Sent Events (SSE) stream
router.get('/', eventsController.streamEvents);

export default router;
