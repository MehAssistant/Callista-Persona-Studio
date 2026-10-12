/**
 * MessageStore
 * Manajemen in-memory untuk pesan, deduplikasi, buffer konteks grup (maksimal 10 pesan),
 * dan log aktivitas penerimaan/pengiriman.
 */
class MessageStore {
  constructor() {
    // Riwayat pesan keseluruhan (maksimal 500 pesan terakhir)
    this.messages = [];
    this.maxTotalMessages = 500;

    // Set ID pesan untuk pencegahan duplikasi secara instan
    this.processedMessageIds = new Set();
    this.maxTrackedIds = 2000;

    // Buffer konteks per grup: Map<chatId, Array<Message>> (maksimal 10 pesan terbaru per grup)
    this.groupBuffers = new Map();
    this.maxGroupBufferSize = 10;

    // Log aktivitas pesan
    this.activityLogs = [];
    this.maxLogs = 200;
  }

  /**
   * Cek apakah pesan dengan ID ini sudah pernah diproses
   */
  hasMessage(id) {
    if (!id) return false;
    return this.processedMessageIds.has(id);
  }

  /**
   * Tandai ID pesan sebagai telah diproses
   */
  _trackMessageId(id) {
    if (!id) return;
    this.processedMessageIds.add(id);

    // Bersihkan entri lama jika set melebihi kapasitas
    if (this.processedMessageIds.size > this.maxTrackedIds) {
      const firstEntries = Array.from(this.processedMessageIds).slice(0, 500);
      for (const oldId of firstEntries) {
        this.processedMessageIds.delete(oldId);
      }
    }
  }

  /**
   * Tambahkan log aktivitas
   */
  _addActivityLog(type, details) {
    const logEntry = {
      type, // 'message_received' | 'message_sent' | 'message_send_failed'
      timestamp: new Date().toISOString(),
      details,
    };
    this.activityLogs.unshift(logEntry);
    if (this.activityLogs.length > this.maxLogs) {
      this.activityLogs.pop();
    }
  }

  /**
   * Tambahkan pesan masuk nyata
   */
  addIncomingMessage(message) {
    if (!message || !message.id) return null;

    // Cegah duplikasi
    if (this.hasMessage(message.id)) {
      return null;
    }

    this._trackMessageId(message.id);

    // Simpan ke riwayat utama
    this.messages.unshift(message);
    if (this.messages.length > this.maxTotalMessages) {
      this.messages.pop();
    }

    // Jika pesan berasal dari grup, tambahkan ke buffer konteks grup
    if (message.isGroup && message.chatId) {
      this._addToGroupBuffer(message.chatId, message);
    }

    this._addActivityLog('message_received', {
      messageId: message.id,
      chatId: message.chatId,
      isGroup: message.isGroup,
      senderId: message.senderId,
      type: message.type,
    });

    return message;
  }

  /**
   * Tambahkan pesan yang berhasil dikirim oleh bot
   */
  addOutgoingMessage(message) {
    if (!message || !message.id) return null;

    this._trackMessageId(message.id);

    // Simpan ke riwayat utama
    this.messages.unshift(message);
    if (this.messages.length > this.maxTotalMessages) {
      this.messages.pop();
    }

    // Jika dikirim ke grup, masukkan juga ke konteks grup
    if (message.isGroup && message.chatId) {
      this._addToGroupBuffer(message.chatId, message);
    }

    this._addActivityLog('message_sent', {
      messageId: message.id,
      chatId: message.chatId,
      isGroup: message.isGroup,
    });

    return message;
  }

  /**
   * Catat kegagalan pengiriman
   */
  recordSendFailure(chatId, text, error) {
    this._addActivityLog('message_send_failed', {
      chatId,
      textPreview: text ? text.substring(0, 30) : '',
      error: error?.message || String(error),
    });
  }

  /**
   * Masukkan pesan ke buffer grup (FIFO maksimal 10 item terbaru)
   */
  _addToGroupBuffer(chatId, message) {
    if (!this.groupBuffers.has(chatId)) {
      this.groupBuffers.set(chatId, []);
    }

    const buffer = this.groupBuffers.get(chatId);

    // Buat objek konteks yang bersih dan terstruktur
    const contextItem = {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      senderName: message.senderName || null,
      fromMe: message.fromMe || false,
      text: message.text || '',
      type: message.type || 'chat',
      timestamp: message.timestamp,
      quotedMessageId: message.quotedMessageId || null,
    };

    buffer.push(contextItem);

    // Pertahankan batas maksimal 10 pesan per grup
    while (buffer.length > this.maxGroupBufferSize) {
      buffer.shift(); // Keluarkan pesan paling lama
    }
  }

  /**
   * Ambil buffer konteks untuk grup tertentu
   */
  getGroupContext(chatId) {
    if (!chatId) return [];
    const buffer = this.groupBuffers.get(chatId);
    if (!buffer) return [];
    // Kembalikan salinan array untuk mencegah mutasi eksternal
    return [...buffer];
  }

  /**
   * Ambil daftar pesan dengan filter
   */
  getMessages({ limit = 50, chatId, type, fromMe } = {}) {
    let result = [...this.messages];

    if (chatId) {
      result = result.filter((m) => m.chatId === chatId);
    }

    if (type) {
      if (type === 'group') {
        result = result.filter((m) => m.isGroup === true);
      } else if (type === 'private') {
        result = result.filter((m) => m.isGroup === false);
      }
    }

    if (fromMe !== undefined && fromMe !== null) {
      const isFromMe = fromMe === 'true' || fromMe === true;
      result = result.filter((m) => m.fromMe === isFromMe);
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    return result.slice(0, parsedLimit);
  }

  /**
   * Cari pesan berdasarkan ID
   */
  getMessageById(id) {
    if (!id) return null;
    return this.messages.find((m) => m.id === id) || null;
  }

  /**
   * Ambil log aktivitas
   */
  getActivityLogs(limit = 50) {
    return this.activityLogs.slice(0, parsedLimit);
  }

  /**
   * Reset data in-memory (berguna untuk testing atau restart sesi)
   */
  clearAll() {
    this.messages = [];
    this.processedMessageIds.clear();
    this.groupBuffers.clear();
    this.activityLogs = [];
  }
}

const messageStore = new MessageStore();
export default messageStore;
