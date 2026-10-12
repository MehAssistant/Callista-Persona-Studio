import messageStore from '../services/messageStore.js';

export const chatsController = {
  /**
   * GET /api/chats/:chatId/context
   * Mengambil buffer konteks (maksimal 10 pesan terbaru) untuk grup tertentu
   */
  async getGroupContext(req, res, next) {
    try {
      const rawChatId = req.params.chatId;

      if (!rawChatId || typeof rawChatId !== 'string') {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Parameter chatId wajib disertakan.',
            statusCode: 400,
          },
        });
      }

      // Dekode chatId secara aman
      const chatId = decodeURIComponent(rawChatId).trim();

      const contextMessages = messageStore.getGroupContext(chatId);

      res.status(200).json({
        success: true,
        data: {
          chatId,
          count: contextMessages.length,
          maxBufferSize: 10,
          messages: contextMessages,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
