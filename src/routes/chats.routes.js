import { Router } from 'express';
import { chatsController } from '../controllers/chats.controller.js';

const router = Router();

// GET /api/chats/:chatId/context - Buffer konteks 10 pesan per grup
router.get('/:chatId/context', chatsController.getGroupContext);

export default router;
