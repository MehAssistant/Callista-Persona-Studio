import express from 'express';
import config from './config/index.js';
import routes from './routes/index.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// Parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root endpoint info
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: config.appName,
      status: 'online',
      message: 'Callista Persona Studio Backend API is running.',
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
