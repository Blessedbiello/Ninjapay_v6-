import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';
import { createLogger } from '@ninjapay/logger';

const logger = createLogger('rate-limiter');

/**
 * Rate limit configurations per endpoint category
 */
interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Authentication - stricter limits
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    message: 'Too many authentication attempts. Please try again later.',
  },

  // API key operations - moderate limits
  apiKeys: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 requests per hour
    message: 'API key operation limit reached. Please try again later.',
  },

  // Payment operations - higher limits
  payments: {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: 'Payment request limit reached. Please slow down.',
  },

  // Read operations - generous limits
  read: {
    windowMs: 60 * 1000, // 1 minute
    max: 200, // 200 requests per minute
    message: 'Read request limit reached. Please slow down.',
  },

  // Write operations - moderate limits
  write: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: 'Write request limit reached. Please slow down.',
  },

  // Webhook callbacks - higher limits (from Arcium)
  callbacks: {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Callback limit reached.',
  },

  // Public checkout - moderate limits
  checkout: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: 'Checkout request limit reached. Please try again.',
  },

  // Payroll operations - stricter (sensitive)
  payroll: {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
    message: 'Payroll operation limit reached. Please slow down.',
  },

  // Health checks - very generous
  health: {
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // 1000 requests per minute
    message: 'Health check limit reached.',
  },
};

/**
 * Key generator for rate limiting
 * Uses API key if present, otherwise IP address
 */
function keyGenerator(req: Request): string {
  // Check for API key
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey) {
    // Use first 16 chars of API key as identifier
    return `apikey:${apiKey.substring(0, 16)}`;
  }

  // Check for authenticated user
  const merchantId = (req as any).merchantId;
  if (merchantId) {
    return `merchant:${merchantId}`;
  }

  const companyId = (req as any).companyId;
  if (companyId) {
    return `company:${companyId}`;
  }

  // Fallback to IP address
  const ip = req.ip ||
    req.headers['x-forwarded-for']?.toString().split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown';

  return `ip:${ip}`;
}

/**
 * Handler for rate limit exceeded
 */
function onLimitReached(req: Request, _res: Response): void {
  logger.warn('Rate limit exceeded', {
    key: keyGenerator(req),
    path: req.path,
    method: req.method,
  });
}

/**
 * Create a rate limiter for a specific category
 */
function createLimiter(category: keyof typeof RATE_LIMITS): RateLimitRequestHandler {
  const config = RATE_LIMITS[category];

  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: config.message,
      },
      timestamp: Date.now(),
    },
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res, _next, options) => {
      onLimitReached(req, res);
      res.status(429).json(options.message);
    },
    skipSuccessfulRequests: config.skipSuccessfulRequests,
    skipFailedRequests: config.skipFailedRequests,
  });
}

// Export pre-configured limiters
export const authLimiter = createLimiter('auth');
export const apiKeysLimiter = createLimiter('apiKeys');
export const paymentsLimiter = createLimiter('payments');
export const readLimiter = createLimiter('read');
export const writeLimiter = createLimiter('write');
export const callbacksLimiter = createLimiter('callbacks');
export const checkoutLimiter = createLimiter('checkout');
export const payrollLimiter = createLimiter('payroll');
export const healthLimiter = createLimiter('health');

/**
 * Dynamic rate limiter based on route
 */
export function dynamicRateLimiter(req: Request, res: Response, next: Function): void {
  const path = req.path.toLowerCase();

  // Determine category based on path
  let limiter: RateLimitRequestHandler;

  if (path.includes('/health')) {
    limiter = healthLimiter;
  } else if (path.includes('/auth')) {
    limiter = authLimiter;
  } else if (path.includes('/api_keys')) {
    limiter = apiKeysLimiter;
  } else if (path.includes('/checkout')) {
    limiter = checkoutLimiter;
  } else if (path.includes('/payroll')) {
    limiter = payrollLimiter;
  } else if (path.includes('/arcium/callbacks')) {
    limiter = callbacksLimiter;
  } else if (path.includes('/payment')) {
    limiter = paymentsLimiter;
  } else if (req.method === 'GET') {
    limiter = readLimiter;
  } else {
    limiter = writeLimiter;
  }

  limiter(req, res, next);
}

/**
 * Burst limiter for short-term spikes
 * More permissive but shorter window
 */
export const burstLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 10, // 10 requests per second
  message: {
    success: false,
    error: {
      code: 'BURST_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait a moment.',
    },
    timestamp: Date.now(),
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

export default dynamicRateLimiter;
