import app from './app.js';
import config from './config/index.js';
import whatsappService from './services/whatsappClient.js';

const server = app.listen(config.port, () => {
  console.log(`[SERVER] ${config.appName} berjalan di port ${config.port} (${config.env})`);
  console.log(`[SERVER] Health check tersedia di http://localhost:${config.port}${config.apiPrefix}/health`);
  console.log(`[SERVER] WhatsApp status di http://localhost:${config.port}${config.apiPrefix}/whatsapp/status`);
});

// Penanganan graceful shutdown
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[SERVER] Menerima ${signal}. Memulai proses graceful shutdown...`);

  // 1. Hentikan client WhatsApp dan browser Chromium secara terkontrol
  try {
    await whatsappService.disconnect();
  } catch (err) {
    console.error('[SERVER] Terjadi kesalahan saat menutup WhatsApp client:', err?.message || err);
  }

  // 2. Tutup server HTTP
  server.close(() => {
    console.log('[SERVER] Server HTTP berhasil ditutup.');
    process.exit(0);
  });

  // Timeout paksa jika penutupan memakan waktu terlalu lama
  setTimeout(() => {
    console.error('[SERVER] Penutupan paksa karena batas waktu terlampaui.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] pada:', promise, 'alasan:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]:', error);
  process.exit(1);
});

export default server;
