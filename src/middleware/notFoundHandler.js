/**
 * Middleware untuk menangani request ke endpoint yang tidak terdaftar (404)
 */
export const notFoundHandler = (req, res, _next) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan`,
      statusCode: 404,
    },
  });
};
