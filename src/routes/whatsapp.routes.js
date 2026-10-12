import { Router } from 'express';
import { whatsappController } from '../controllers/whatsapp.controller.js';

const router = Router();

// GET /api/whatsapp/status - Status aktual koneksi
router.get('/status', whatsappController.getStatus);

// POST /api/whatsapp/connect - Memulai proses koneksi
router.post('/connect', whatsappController.connect);

// POST /api/whatsapp/disconnect - Memutus koneksi terkontrol
router.post('/disconnect', whatsappController.disconnect);

// GET /api/whatsapp/qr - Mengambil data QR code aktif
router.get('/qr', whatsappController.getQr);

export default router;
