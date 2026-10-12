import { Router } from 'express';
import { messagesController } from '../controllers/messages.controller.js';

const router = Router();

// GET /api/messages - Daftar riwayat pesan (dengan query limit, chatId, type, fromMe)
router.get('/', messagesController.getMessages);

// GET /api/messages/logs - Log aktivitas pesan
router.get('/logs', messagesController.getLogs);

// GET /api/messages/:id - Detail pesan berdasarkan ID
router.get('/:id', messagesController.getMessageById);

// POST /api/messages/send - Pengiriman pesan manual
router.post('/send', messagesController.sendMessage);

export default router;
