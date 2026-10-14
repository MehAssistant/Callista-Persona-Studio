import messageStore from '../services/messageStore.js';
import whatsappService from '../services/whatsappClient.js';
import messageProcessor from '../services/messageProcessor.js';
import eventHub from '../services/eventHub.js';

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
      if (!currentStatus.isReady && currentStatus.status !== 'ready' && currentStatus.status !== 'connected') {
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
   * POST /api/messages/simulate
   * Menstimulasikan pesan masuk untuk pengujian realtime pipeline AI & trigger langsung dari UI
   */
  async simulateMessage(req, res, next) {
    try {
      const { text, chatId, isGroup, senderName, senderId } = req.body;

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Parameter text wajib diisi.',
            statusCode: 400,
          },
        });
      }

      const defaultGroup = '120363023456789@g.us';
      const defaultUser = '628123456789@s.whatsapp.net';
      const resolvedChatId = (chatId && typeof chatId === 'string' && chatId.trim())
        ? chatId.trim()
        : (isGroup ? defaultGroup : defaultUser);

      const resolvedIsGroup = typeof isGroup === 'boolean'
        ? isGroup
        : resolvedChatId.endsWith('@g.us');

      const resolvedSenderId = (senderId && typeof senderId === 'string' && senderId.trim())
        ? senderId.trim()
        : (resolvedIsGroup ? '628987654321@s.whatsapp.net' : resolvedChatId);

      const messageId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const simulatedMsg = {
        id: messageId,
        chatId: resolvedChatId,
        isGroup: resolvedIsGroup,
        senderId: resolvedSenderId,
        senderName: senderName || (resolvedIsGroup ? 'Anggota Grup' : 'Teman Chat'),
        text: text.trim(),
        type: 'chat',
        timestamp: new Date().toISOString(),
        quotedMessageId: null,
        quotedParticipant: null,
        fromMe: false,
      };

      const savedMessage = messageStore.addIncomingMessage(simulatedMsg);
      if (savedMessage) {
        eventHub.emitMessageReceived(savedMessage);

        // Jalankan pipeline (filter lokal -> Vertex AI -> balasan) tanpa memblokir respons HTTP
        messageProcessor.processIncomingMessage(savedMessage, whatsappService).catch((procErr) => {
          console.error('[SIMULASI] Kesalahan pemrosesan pipeline:', procErr?.message || procErr);
        });
      }

      res.status(200).json({
        success: true,
        message: 'Pesan simulasi berhasil dimasukkan ke pipeline real-time.',
        data: simulatedMsg,
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
