import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger } from '@ninjapay/logger';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { rateLimiter } from './middleware/rate-limiter.js';

// Routes
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import apiKeyRoutes from './routes/api-keys.js';
import paymentIntentRoutes from './routes/payment-intents.js';
import paymentLinkRoutes from './routes/payment-links.js';
import webhookRoutes from './routes/webhooks.js';
import payrollRoutes from './routes/payroll.js';
import arciumCallbackRoutes from './routes/arcium-callbacks.js';

const logger = createLogger('api-gateway');
const app = express();
const PORT = process.env.API_PORT || 8001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true,
}));

// Body parsing with raw body for webhook verification
const rawBodySaver = (req: Request & { rawBody?: string }, _res: Response, buf: Buffer) => {
  if (buf?.length) {
    req.rawBody = buf.toString('utf8');
  }
};

app.use(express.json({ limit: '10mb', verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Rate limiting
app.use(rateLimiter);

// Routes
app.use('/health', healthRoutes);
app.use('/v1/auth', authRoutes);
app.use('/v1/api_keys', apiKeyRoutes);
app.use('/v1/payment_intents', paymentIntentRoutes);
app.use('/v1/payment_links', paymentLinkRoutes);
app.use('/v1/webhooks', webhookRoutes);
app.use('/v1/payroll', payrollRoutes);
app.use('/v1/arcium/callbacks', arciumCallbackRoutes);

// Error handling (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`NinjaPay API Gateway running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`CORS enabled for: ${process.env.CORS_ORIGIN || '*'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

export default app;
