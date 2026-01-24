import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger } from '@ninjapay/logger';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { validateEnv, requireEnv } from './utils/env-validator.js';

// Validate environment at startup
try {
  validateEnv();
} catch (error) {
  console.error('Failed to start: Environment validation failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Routes
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import apiKeyRoutes from './routes/api-keys.js';
import paymentIntentRoutes from './routes/payment-intents.js';
import paymentLinkRoutes from './routes/payment-links.js';
import webhookRoutes from './routes/webhooks.js';
import payrollRoutes from './routes/payroll.js';
import arciumCallbackRoutes from './routes/arcium-callbacks.js';
import checkoutRoutes from './routes/checkout.js';

const logger = createLogger('api-gateway');
const app = express();
const env = requireEnv();
const PORT = env.API_PORT;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN?.split(',') || '*',
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
app.use('/v1/checkout', checkoutRoutes);

// Error handling (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`NinjaPay API Gateway running on port ${PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);
  logger.info(`MPC Mode: ${env.MPC_MODE}`);
  logger.info(`Solana Network: ${env.SOLANA_NETWORK}`);
  logger.info(`CORS enabled for: ${env.CORS_ORIGIN || '*'}`);
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
