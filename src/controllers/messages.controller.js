import messageStore from '../services/messageStore.js';
import whatsappService from '../services/whatsappClient.js';

export const messagesController = {
  /**
   * GET /api/messages
   * Mengambil riwayat pesan masuk dan keluar yang tersimpan
   */
  async getMessages(req, res, next) {
    try {
      const { limit, chatId, type, fromMe } = req.query;
      const messages = messageStore.getMessages({ limit, chatId, type, fromMe });
      res.status(200).json({
        success: true,
        count: messages.length,
        data: messages,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/messages/:id
   * Mengambil detail pesan berdasarkan ID spesifik
   */
  async getMessageById(req, res, next) {
    try {
      const { id } = req.params;
      const message = messageStore.getMessageById(id);

      if (!message) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Pesan dengan ID '${id}' tidak ditemukan.`,
            statusCode: 404,
          },
        });
      }

      res.status(200).json({
        success: true,
        data: message,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/messages/send
   * Mengirim pesan teks manual ke akun / grup WhatsApp
   */
  async sendMessage(req, res, next) {
    try {
      const { chatId, text, quotedMessageId } = req.body;

      // Validasi input
      if (!chatId || typeof chatId !== 'string' || !chatId.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Parameter chatId wajib diisi dan harus berupa string.',
            statusCode: 400,
          },
        });
      }

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Parameter text wajib diisi dan tidak boleh kosong.',
            statusCode: 400,
          },
        });
      }

      // Validasi status koneksi WhatsApp
      const currentStatus = whatsappService.getStatus();
      if (currentStatus.status !== 'connected') {
        return res.status(409).json({
          success: false,
          error: {
            message: `WhatsApp belum terhubung (status saat ini: ${currentStatus.status}). Pesan tidak dapat dikirim.`,
            statusCode: 409,
          },
        });
      }

      const sentResult = await whatsappService.sendMessage(chatId, text, quotedMessageId);

      res.status(200).json({
        success: true,
        message: 'Pesan berhasil dikirim.',
        data: sentResult,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/messages/logs
   * Mengambil riwayat log aktivitas pengiriman/penerimaan pesan
   */
  async getLogs(req, res, next) {
    try {
      const limit = req.query.limit || 50;
      const logs = messageStore.getActivityLogs(limit);
      res.status(200).json({
        success: true,
        count: logs.length,
        data: logs,
      });
    } catch (err) {
      next(err);
    }
  },
};
