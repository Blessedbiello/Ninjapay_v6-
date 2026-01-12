import rateLimit from 'express-rate-limit';

// Global rate limiter
export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'), // 1 minute default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // 100 requests per window
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
    },
    timestamp: Date.now(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for API key endpoints
export const apiKeyRateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 200, // 200 requests per minute for authenticated requests
  keyGenerator: (req) => {
    return req.headers['x-api-key'] as string || req.ip || 'unknown';
  },
  message: {
    success: false,
    error: {
      code: 'API_RATE_LIMIT_EXCEEDED',
      message: 'API rate limit exceeded.',
    },
    timestamp: Date.now(),
  },
});
