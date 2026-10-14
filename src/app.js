import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import routes from './routes/index.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Realtime Dashboard UI
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Root endpoint: alihkan ke dashboard jika dibuka di browser (HTML), atau kembalikan JSON jika diminta API client
app.get('/', (req, res) => {
  const acceptsHtml = req.accepts(['html', 'json']) === 'html';
  if (acceptsHtml) {
    return res.redirect('/dashboard');
  }

  res.status(200).json({
    success: true,
    data: {
      name: config.appName,
      status: 'online',
      message: 'Callista Persona Studio Backend API is running.',
      dashboard: '/dashboard',
      healthCheck: `${config.apiPrefix}/health`,
    },
  });
});

// API Routes
app.use(config.apiPrefix, routes);

// 404 Not Found Handler
app.use(notFoundHandler);

// Centralized Error Handler
app.use(errorHandler);

export default app;
