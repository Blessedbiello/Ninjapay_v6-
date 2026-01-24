import { z } from 'zod';
import { logger } from '@ninjapay/logger';

/**
 * Environment variable schema with validation rules
 */
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // API Server
  API_PORT: z.string().regex(/^\d+$/).transform(Number).default('8080'),
  API_HOST: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis (optional in development)
  REDIS_URL: z.string().optional(),

  // Authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // Encryption
  ENCRYPTION_MASTER_KEY: z.string().length(64, 'ENCRYPTION_MASTER_KEY must be 64 hex characters'),

  // Arcium MPC
  MPC_MODE: z.enum(['local', 'cluster']).default('cluster'),
  ARCIUM_PROGRAM_ID: z.string().min(1, 'ARCIUM_PROGRAM_ID is required'),
  ARCIUM_CLUSTER_ADDRESS: z.string().url().optional(),
  ARCIUM_CALLBACK_SECRET: z.string().min(32).optional(),
  ARCIUM_CLUSTER_OFFSET: z.string().regex(/^\d+$/).transform(Number).optional(),
  ARCIUM_CLUSTER_MAX_SIZE: z.string().regex(/^\d+$/).transform(Number).optional(),
  ARCIUM_CLUSTER_CU_PRICE: z.string().regex(/^\d+$/).transform(Number).optional(),

  // Solana
  SOLANA_RPC_URL: z.string().url('SOLANA_RPC_URL must be a valid URL'),
  SOLANA_KEYPAIR_PATH: z.string().optional(),
  SOLANA_NETWORK: z.enum(['mainnet-beta', 'devnet', 'testnet', 'localnet']).default('devnet'),

  // USDC
  USDC_MINT: z.string().optional(),

  // Fees
  FEE_BASIS_POINTS: z.string().regex(/^\d+$/).transform(Number).optional(),
  FEE_COLLECTOR_ADDRESS: z.string().optional(),

  // Webhooks
  WEBHOOK_SIGNING_SECRET: z.string().min(32).optional(),

  // Rate Limiting
  RATE_LIMIT_WINDOW: z.string().regex(/^\d+$/).transform(Number).optional(),
  RATE_LIMIT_MAX_REQUESTS: z.string().regex(/^\d+$/).transform(Number).optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
});

/**
 * Production-specific required fields
 */
const productionRequiredFields = [
  'REDIS_URL',
  'ARCIUM_CLUSTER_ADDRESS',
  'ARCIUM_CALLBACK_SECRET',
  'SOLANA_KEYPAIR_PATH',
  'WEBHOOK_SIGNING_SECRET',
  'FEE_COLLECTOR_ADDRESS',
];

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validated environment configuration
 */
let validatedEnv: EnvConfig | null = null;

/**
 * Validates environment variables and returns typed config
 * Throws if validation fails
 */
export function validateEnv(): EnvConfig {
  if (validatedEnv) {
    return validatedEnv;
  }

  try {
    // Parse environment variables
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
      const errors = result.error.errors.map(err => {
        return `  - ${err.path.join('.')}: ${err.message}`;
      }).join('\n');

      logger.error('Environment validation failed', { errors: result.error.errors });
      throw new Error(`Environment validation failed:\n${errors}`);
    }

    const env = result.data;

    // Additional production checks
    if (env.NODE_ENV === 'production') {
      const missingFields: string[] = [];

      for (const field of productionRequiredFields) {
        if (!process.env[field]) {
          missingFields.push(field);
        }
      }

      if (missingFields.length > 0) {
        throw new Error(
          `Missing required environment variables for production:\n${missingFields.map(f => `  - ${f}`).join('\n')}`
        );
      }

      // Warn about insecure settings
      if (env.SOLANA_RPC_URL.includes('api.mainnet-beta.solana.com')) {
        logger.warn('Using public Solana RPC. Consider using a private RPC for production.');
      }
    }

    // Validate encryption key format (should be hex)
    if (!/^[0-9a-fA-F]+$/.test(env.ENCRYPTION_MASTER_KEY)) {
      throw new Error('ENCRYPTION_MASTER_KEY must be a valid hex string');
    }

    validatedEnv = env;

    logger.info('Environment validated successfully', {
      nodeEnv: env.NODE_ENV,
      apiPort: env.API_PORT,
      mpcMode: env.MPC_MODE,
      solanaNetwork: env.SOLANA_NETWORK,
    });

    return env;
  } catch (error) {
    // Log error details
    if (error instanceof Error) {
      logger.error('Environment validation error', { message: error.message });
    }
    throw error;
  }
}

/**
 * Get validated environment config
 * Returns null if not validated yet
 */
export function getEnv(): EnvConfig | null {
  return validatedEnv;
}

/**
 * Get validated environment config or throw
 */
export function requireEnv(): EnvConfig {
  if (!validatedEnv) {
    return validateEnv();
  }
  return validatedEnv;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

/**
 * Check if running in test environment
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * Generate a secure random string for secrets
 */
export function generateSecureSecret(length: number = 32): string {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Print current environment configuration (sanitized)
 */
export function printEnvConfig(): void {
  const env = getEnv();
  if (!env) {
    console.log('Environment not validated yet');
    return;
  }

  const sanitized = {
    NODE_ENV: env.NODE_ENV,
    API_PORT: env.API_PORT,
    MPC_MODE: env.MPC_MODE,
    SOLANA_NETWORK: env.SOLANA_NETWORK,
    DATABASE_URL: env.DATABASE_URL.replace(/\/\/.*@/, '//***:***@'),
    REDIS_URL: env.REDIS_URL?.replace(/\/\/.*@/, '//***:***@') || 'not set',
    JWT_SECRET: '***',
    ENCRYPTION_MASTER_KEY: '***',
    SOLANA_RPC_URL: env.SOLANA_RPC_URL,
  };

  console.log('Environment Configuration:');
  console.log(JSON.stringify(sanitized, null, 2));
}
