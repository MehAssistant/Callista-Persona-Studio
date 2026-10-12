import vertexAiClassifier from '../services/vertexAiClassifier.js';
import messageStore from '../services/messageStore.js';
import config from '../config/index.js';

export const aiController = {
  /**
   * POST /api/ai/classify
   * Menganalisis pesan dan mengklasifikasikan intent menggunakan Google Cloud Vertex AI
   */
  async classify(req, res, next) {
    try {
      const {
        messageId,
        text,
        chatId,
        context: customContext,
        senderId,
        senderName,
        isGroup,
        quotedMessageId,
        personaName = config.persona.name,
      } = req.body;

      let messageToAnalyze = null;

      // 1. Jika messageId diberikan, coba ambil dari messageStore
      if (messageId && typeof messageId === 'string') {
        const storedMessage = messageStore.getMessageById(messageId.trim());
        if (storedMessage) {
          messageToAnalyze = { ...storedMessage };
        }
      }

      // 2. Jika tidak ditemukan atau text eksplisit diberikan dalam body
      if (!messageToAnalyze) {
        if (!text || typeof text !== 'string' || !text.trim()) {
          return res.status(400).json({
            success: false,
            error: {
              message: 'Parameter `text` atau `messageId` yang valid wajib disertakan dalam request body.',
              statusCode: 400,
            },
          });
        }

        const resolvedChatId = chatId && typeof chatId === 'string' ? chatId.trim() : null;
        const resolvedIsGroup = typeof isGroup === 'boolean'
          ? isGroup
          : Boolean(resolvedChatId && resolvedChatId.endsWith('@g.us'));

        messageToAnalyze = {
          id: messageId || `manual-${Date.now()}`,
          text: text.trim(),
          chatId: resolvedChatId,
          isGroup: resolvedIsGroup,
          senderId: senderId || 'user',
          senderName: senderName || null,
          quotedMessageId: quotedMessageId || null,
          type: 'chat',
          timestamp: new Date().toISOString(),
        };
      } else if (text && typeof text === 'string' && text.trim()) {
        // Override text jika disediakan
        messageToAnalyze.text = text.trim();
      }

      // 3. Tentukan konteks percakapan (maksimal 10 pesan, terisolasi per grup)
      let resolvedContext = [];
      if (Array.isArray(customContext)) {
        // Batasi konteks kustom maksimal 10 pesan terakhir
        resolvedContext = customContext.slice(-10);
      } else if (messageToAnalyze.chatId && messageToAnalyze.isGroup) {
        // Ambil konteks 10 pesan terakhir dari buffer grup
        resolvedContext = messageStore.getGroupContext(messageToAnalyze.chatId);
      }

      // 4. Panggil service klasifikasi Google Cloud Vertex AI
      const classificationResult = await vertexAiClassifier.classifyMessage({
        message: messageToAnalyze,
        context: resolvedContext,
        personaName,
      });

      // 5. Kembalikan respons terstruktur JSON konsisten (tanpa mengirim pesan WhatsApp)
      res.status(200).json({
        success: true,
        data: classificationResult,
      });
    } catch (err) {
      next(err);
    }
  },
};
