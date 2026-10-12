import eventHub from '../services/eventHub.js';
import whatsappService from '../services/whatsappClient.js';

export const eventsController = {
  /**
   * GET /api/events
   * Server-Sent Events (SSE) endpoint untuk streaming pembaruan realtime ke calon frontend
   */
  streamEvents(req, res) {
    // Header wajib SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Fungsi pembantu untuk mengirim event berformat SSE
    const sendSSE = (eventName, data) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 1. Kirim status awal WhatsApp saat koneksi SSE pertama kali terbuka
    const initialStatus = whatsappService.getStatus();
    sendSSE('whatsapp_status', initialStatus);

    // 2. Listener untuk event-event aktual
    const onWhatsAppStatus = (data) => {
      sendSSE('whatsapp_status', data);
    };

    const onMessageReceived = (message) => {
      sendSSE('message_received', message);
    };

    const onMessageClassified = (classification) => {
      sendSSE('message_classified', classification);
    };

    const onMessageSent = (message) => {
      sendSSE('message_sent', message);
    };

    // Daftarkan listener ke EventHub
    eventHub.on('whatsapp_status', onWhatsAppStatus);
    eventHub.on('message_received', onMessageReceived);
    eventHub.on('message_classified', onMessageClassified);
    eventHub.on('message_sent', onMessageSent);

    // 3. Heartbeat berkala untuk menjaga koneksi tetap aktif melalui proxy/browser
    const heartbeatInterval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 20000);

    // 4. Bersihkan listener saat koneksi ditutup oleh klien
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      eventHub.removeListener('whatsapp_status', onWhatsAppStatus);
      eventHub.removeListener('message_received', onMessageReceived);
      eventHub.removeListener('message_classified', onMessageClassified);
      eventHub.removeListener('message_sent', onMessageSent);
    });
  },
};
