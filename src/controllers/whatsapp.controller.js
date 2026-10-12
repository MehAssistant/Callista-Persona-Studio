import whatsappService from '../services/whatsappClient.js';

/**
 * Controller untuk endpoint WhatsApp
 */
export const whatsappController = {
  /**
   * GET /api/whatsapp/status
   * Mengembalikan status aktual koneksi WhatsApp
   */
  async getStatus(req, res, next) {
    try {
      const statusData = whatsappService.getStatus();
      res.status(200).json({
        success: true,
        data: statusData,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/whatsapp/connect
   * Memulai inisialisasi client WhatsApp jika belum berjalan
   */
  async connect(req, res, next) {
    try {
      const result = await whatsappService.connect();
      const statusCode = result.success ? 200 : 409;
      res.status(statusCode).json({
        success: result.success,
        message: result.message,
        data: {
          status: result.status,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/whatsapp/disconnect
   * Memutus koneksi client WhatsApp secara terkontrol
   */
  async disconnect(req, res, next) {
    try {
      const result = await whatsappService.disconnect();
      res.status(200).json({
        success: result.success,
        message: result.message,
        data: {
          status: result.status,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/whatsapp/qr
   * Mengambil data QR code aktual jika tersedia
   */
  async getQr(req, res, next) {
    try {
      const qrData = whatsappService.getQr();
      res.status(200).json({
        success: true,
        data: qrData,
      });
    } catch (err) {
      next(err);
    }
  },
};
