import config from '../config/index.js';
import vertexAiClassifier from './vertexAiClassifier.js';
import messageStore from './messageStore.js';
import eventHub from './eventHub.js';

/**
 * MessageProcessor
 * Mengorkestrasi alur otomatis dengan filter lokal sebelum Vertex AI:
 * Pesan Masuk → Filter Lokal (Trigger/Private/Tipe/Duplikasi) → Konteks → Klasifikasi Vertex AI → Keputusan Balas/Diam → Pengiriman Balasan Berpersona
 */
class MessageProcessor {
  constructor() {
    // Set untuk melacak ID pesan yang telah diproses guna mencegah balasan ganda
    this._processedMessageIds = new Set();
    this.maxTracked = 2000;
  }

  /**
   * Catat ID pesan yang diproses dan kelola batas memori
   */
  _trackProcessedId(id) {
    if (!id) return;
    this._processedMessageIds.add(id);
    if (this._processedMessageIds.size > this.maxTracked) {
      const firstItems = Array.from(this._processedMessageIds).slice(0, 500);
      for (const oldId of firstItems) {
        this._processedMessageIds.delete(oldId);
      }
    }
  }

  /**
   * Reset ID yang telah diproses (untuk pengujian)
   */
  clearProcessedIds() {
    this._processedMessageIds.clear();
  }

  /**
   * Pemeriksaan filter lokal untuk mendeteksi apakah pesan grup memenuhi syarat untuk dianalisis oleh AI
   *
   * @param {Object} message - Objek pesan
   * @param {Object} [whatsappClient] - Instance WhatsApp client
   * @returns {{ allowed: boolean, reason: string }}
   */
  checkLocalGroupFilter(message, whatsappClient = null) {
    const text = (message.text || '').trim();
    const triggerNames = config.persona?.triggerNames || ['Callista', 'Firka', 'Clarrisa'];

    // 1. Deteksi nama pemicu (Callista, Firka, Clarrisa) secara case-insensitive
    const hasTriggerName = triggerNames.some((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i');
      return regex.test(text);
    });

    // 2. Deteksi apakah pesan mengutip/membalas pesan yang sebelumnya dikirim oleh Callista
    let isReplyingToCallista = false;
    if (message.quotedMessageId) {
      const quotedMsg = messageStore.getMessageById(message.quotedMessageId);
      if (quotedMsg && quotedMsg.fromMe) {
        isReplyingToCallista = true;
      } else if (
        whatsappClient?.userInfo?.id &&
        message.quotedParticipant &&
        message.quotedParticipant === whatsappClient.userInfo.id
      ) {
        isReplyingToCallista = true;
      }
    }

    if (hasTriggerName) {
      return {
        allowed: true,
        reason: 'Pesan grup mengandung nama pemicu Callista/Firka/Clarrisa.',
      };
    }

    if (isReplyingToCallista) {
      return {
        allowed: true,
        reason: 'Pesan grup merupakan balasan langsung (quote) terhadap pesan Callista.',
      };
    }

    return {
      allowed: false,
      reason: `Pesan grup tidak menyebut nama pemicu (${triggerNames.join(', ')}) dan bukan balasan pesan Callista.`,
    };
  }

  /**
   * Memproses pesan masuk yang telah divalidasi
   *
   * @param {Object} message - Objek pesan masuk terurai
   * @param {Object} whatsappClient - Instance WhatsApp client manager
   */
  async processIncomingMessage(message, whatsappClient) {
    if (!message || !message.id) return;

    // Filter 1: Hindari memproses pesan yang dibuat oleh bot sendiri (mencegah loop)
    if (message.fromMe) {
      console.log(`[FILTER LOKAL] Pesan ${message.id} dilewati: berasal dari akun sendiri (fromMe: true).`);
      return;
    }

    // Filter 2: Hindari pemrosesan berulang terhadap pesan dengan ID yang sama
    if (this._processedMessageIds.has(message.id)) {
      console.log(`[FILTER LOKAL] Pesan ${message.id} dilewati: sudah pernah diproses sebelumnya (anti-duplikasi).`);
      return;
    }
    this._trackProcessedId(message.id);

    // Filter 3: Hanya proses pesan bertipe 'chat' dengan isi teks yang tidak kosong
    if (message.type && message.type !== 'chat') {
      console.log(`[FILTER LOKAL] Pesan ${message.id} dilewati: tipe pesan bukan teks biasa (tipe: ${message.type}).`);
      return;
    }

    if (!message.text || typeof message.text !== 'string' || !message.text.trim()) {
      console.log(`[FILTER LOKAL] Pesan ${message.id} dilewati: isi teks kosong.`);
      return;
    }

    // Filter 4: Filter khusus untuk pesan grup vs chat pribadi
    if (message.isGroup) {
      const groupCheck = this.checkLocalGroupFilter(message, whatsappClient);
      eventHub.emitFilterCheck({
        messageId: message.id,
        chatId: message.chatId,
        isGroup: true,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        allowed: groupCheck.allowed,
        reason: groupCheck.reason,
      });

      if (!groupCheck.allowed) {
        console.log(`[FILTER LOKAL] Pesan grup ${message.id} dari ${message.senderName || message.senderId} di ${message.chatId} dilewati: ${groupCheck.reason} [Vertex AI TIDAK DIPANGGIL]`);
        return;
      }
      console.log(`[FILTER LOKAL] Pesan grup ${message.id} lolos filter lokal (${groupCheck.reason}). Melanjutkan ke analisis Vertex AI...`);
    } else {
      // Chat pribadi: Tidak mewajibkan nama pemicu agar percakapan lanjutan tetap mengalir
      eventHub.emitFilterCheck({
        messageId: message.id,
        chatId: message.chatId,
        isGroup: false,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        allowed: true,
        reason: 'Pesan chat pribadi langsung memiliki konteks penerima yang jelas.',
      });
      console.log(`[FILTER LOKAL] Pesan chat pribadi ${message.id} dari ${message.senderName || message.senderId} lolos filter lokal. Melanjutkan ke analisis Vertex AI...`);
    }

    try {
      // 1. Ambil konteks percakapan relevan (maksimal 10 pesan per grup)
      let context = [];
      if (message.isGroup && message.chatId) {
        context = messageStore.getGroupContext(message.chatId);
      } else if (message.chatId) {
        context = messageStore.getMessages({ chatId: message.chatId, limit: 10 }).reverse();
      }

      console.log(`[PIPELINE] Memulai analisis Vertex AI untuk pesan ${message.id} dari ${message.senderName || message.senderId} di ${message.chatId}...`);
      eventHub.emitAiProcessing({
        messageId: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        contextCount: context.length,
      });

      // 2. Klasifikasi intent dan penyusunan balasan persona menggunakan Vertex AI Express Mode
      const classification = await vertexAiClassifier.classifyMessage({
        message,
        context,
      });

      // 3. Emit event SSE message_classified untuk visibilitas klien/UI
      eventHub.emitMessageClassified({
        messageId: message.id,
        chatId: message.chatId,
        isGroup: message.isGroup,
        senderId: message.senderId,
        intent: classification.intent,
        shouldReply: classification.shouldReply,
        confidence: classification.confidence,
        reason: classification.reason,
        targetPerson: classification.targetPerson,
        suggestedReply: classification.suggestedReply || null,
      });

      console.log(`[PIPELINE] Klasifikasi selesai (${message.id}): Intent=${classification.intent}, shouldReply=${classification.shouldReply}, Confidence=${classification.confidence}`);

      // 4. Evaluasi keputusan membalas atau diam
      if (classification.shouldReply === true && classification.suggestedReply) {
        console.log(`[PIPELINE] Mengirim balasan Callista ke ${message.chatId}...`);

        try {
          // Kirim balasan melalui WhatsApp client dengan mengutip pesan sumber (quote)
          await whatsappClient.sendMessage(
            message.chatId,
            classification.suggestedReply,
            message.id
          );
          console.log(`[PIPELINE] Balasan Callista berhasil dikirim untuk pesan ${message.id}.`);
        } catch (sendErr) {
          console.error(`[PIPELINE] Gagal mengirim balasan ke ${message.chatId}:`, sendErr?.message || sendErr);
        }
      } else {
        console.log(`[PIPELINE] Callista diam (Alasan: ${classification.reason}).`);
      }
    } catch (err) {
      // Tangani error pemrosesan tanpa menjatuhkan server
      console.error(`[PIPELINE] Terjadi kesalahan saat memproses pesan ${message.id}:`, err?.message || err);
    }
  }
}

const messageProcessor = new MessageProcessor();
export default messageProcessor;
