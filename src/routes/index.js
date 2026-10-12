import { Router } from 'express';
import healthRoutes from './health.routes.js';
import whatsappRoutes from './whatsapp.routes.js';
import messagesRoutes from './messages.routes.js';
import chatsRoutes from './chats.routes.js';
import eventsRoutes from './events.routes.js';
import aiRoutes from './ai.routes.js';

const router = Router();

// Mounting sub-routes
router.use('/health', healthRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/messages', messagesRoutes);
router.use('/chats', chatsRoutes);
router.use('/events', eventsRoutes);
router.use('/ai', aiRoutes);

export default router;
