/**
 * Middleware terpusat untuk menangani error pada aplikasi Express.
 * Memastikan tidak ada stack trace atau data sensitif yang bocor ke klien.
 */
export const errorHandler = (err, req, res, _next) => {
  const statusCode = err.status || err.statusCode || 500;
  
  // Catat error di internal console untuk debugging server-side
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message || err);
  }

  // Format pesan yang aman untuk pemanggil API
  let safeMessage = 'Terjadi kesalahan internal pada server';
  if ((statusCode < 500 || statusCode === 503 || err.isOperational || err.code === 'VERTEX_AI_KEY_MISSING' || err.code === 'VERTEX_AI_CONFIG_MISSING') && err.message) {
    safeMessage = err.message;
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message: safeMessage,
      statusCode,
    },
  });
};
