import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  transport,
  base: {
    service: process.env.SERVICE_NAME || 'ninjapay',
  },
});

/**
 * Create a logger instance with a specific context/module name
 */
export function createLogger(context: string) {
  return baseLogger.child({ context });
}

/**
 * Default logger instance
 */
export const logger = baseLogger;

export type Logger = pino.Logger;
