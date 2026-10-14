import { EventEmitter } from 'events';

/**
 * EventHub Singleton
 * Mengelola event internal backend dan penerusan ke Server-Sent Events (SSE)
 */
class EventHub extends EventEmitter {
  constructor() {
    super();
    // Tingkatkan limit listener agar banyak klien SSE dapat terhubung
    this.setMaxListeners(50);
  }

  /**
   * Publikasikan perubahan status WhatsApp
   */
  emitStatusChange(status, data = {}) {
    this.emit('whatsapp_status', {
      status,
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  /**
   * Publikasikan penerimaan pesan masuk
   */
  emitMessageReceived(message) {
    this.emit('message_received', message);
  }

  /**
   * Publikasikan pengecekan filter lokal / trigger nama
   */
  emitFilterCheck(data) {
    this.emit('filter_check', {
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  /**
   * Publikasikan mulainya pemrosesan Vertex AI
   */
  emitAiProcessing(data) {
    this.emit('ai_processing', {
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  /**
   * Publikasikan hasil klasifikasi pesan AI
   */
  emitMessageClassified(data) {
    this.emit('message_classified', {
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  /**
   * Publikasikan pengiriman pesan berhasil
   */
  emitMessageSent(message) {
    this.emit('message_sent', message);
  }
}

const eventHub = new EventHub();
export default eventHub;
