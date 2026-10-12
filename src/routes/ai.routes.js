import { Router } from 'express';
import { aiController } from '../controllers/ai.controller.js';

const router = Router();

// POST /api/ai/classify - Klasifikasi intent dan analisis pesan menggunakan Vertex AI
router.post('/classify', aiController.classify);

export default router;
