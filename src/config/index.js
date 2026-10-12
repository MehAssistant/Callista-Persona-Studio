import dotenv from 'dotenv';
import path from 'path';
import personaConfig from './personaLoader.js';

// Load environment variables from .env file if available
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  appName: process.env.APP_NAME || 'Callista Persona Studio',
  apiPrefix: process.env.API_PREFIX || '/api',
  persona: {
    ...personaConfig.personaSettings,
    triggerNames: personaConfig.personaSettings.triggerNames || ['Callista', 'Firka', 'Clarrisa'],
  },
  whatsapp: {
    sessionPath: path.resolve(process.cwd(), process.env.WA_SESSION_PATH || './sessions'),
    clientId: process.env.WA_CLIENT_ID || 'callista-bot',
    puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: process.env.PUPPETEER_HEADLESS !== 'false',
    qrTimeoutMs: parseInt(process.env.WA_QR_TIMEOUT_MS, 10) || 60000,
  },
  vertexAi: {
    expressMode: true,
    apiKey: process.env.GOOGLE_API_KEY || '',
    project: process.env.GOOGLE_CLOUD_PROJECT || 'third-yeti-7cb1c',
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    model: process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash',
  },
};

export default config;
