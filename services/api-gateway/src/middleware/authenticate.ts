import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '@ninjapay/database';
import { AppError } from './error-handler.js';
import { createLogger } from '@ninjapay/logger';

const logger = createLogger('auth');

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      merchantId?: string;
      companyId?: string;
      user?: {
        id: string;
        walletAddress: string;
        type: 'merchant' | 'company';
      };
    }
  }
}

interface JWTPayload {
  id: string;
  walletAddress: string;
  type: 'merchant' | 'company';
  iat?: number;
  exp?: number;
}

/**
 * Authenticate merchant via API key or JWT
 */
export const authenticateMerchant = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    // Check for API key first
    const apiKey = req.headers['x-api-key'] as string;

    if (apiKey) {
      const merchant = await validateApiKey(apiKey);
      if (!merchant) {
        throw new AppError('Invalid API key', 401, 'INVALID_API_KEY');
      }
      req.merchantId = merchant.id;
      req.user = {
        id: merchant.id,
        walletAddress: merchant.walletAddress,
        type: 'merchant',
      };
      return next();
    }

    // Fall back to JWT
    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError('No authentication credentials provided', 401, 'NO_CREDENTIALS');
    }

    const decoded = verifyToken(token);
    if (decoded.type !== 'merchant') {
      throw new AppError('Invalid token type', 401, 'INVALID_TOKEN_TYPE');
    }

    const merchant = await prisma.merchant.findUnique({
      where: { id: decoded.id },
    });

    if (!merchant) {
      throw new AppError('Merchant not found', 404, 'MERCHANT_NOT_FOUND');
    }

    req.merchantId = merchant.id;
    req.user = {
      id: merchant.id,
      walletAddress: merchant.walletAddress,
      type: 'merchant',
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
    }
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError('Token expired', 401, 'TOKEN_EXPIRED'));
    }
    next(error);
  }
};

/**
 * Authenticate company via API key or JWT
 */
export const authenticateCompany = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (apiKey) {
      const company = await validateCompanyApiKey(apiKey);
      if (!company) {
        throw new AppError('Invalid API key', 401, 'INVALID_API_KEY');
      }
      req.companyId = company.id;
      req.user = {
        id: company.id,
        walletAddress: company.walletAddress,
        type: 'company',
      };
      return next();
    }

    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError('No authentication credentials provided', 401, 'NO_CREDENTIALS');
    }

    const decoded = verifyToken(token);
    if (decoded.type !== 'company') {
      throw new AppError('Invalid token type', 401, 'INVALID_TOKEN_TYPE');
    }

    const company = await prisma.company.findUnique({
      where: { id: decoded.id },
    });

    if (!company) {
      throw new AppError('Company not found', 404, 'COMPANY_NOT_FOUND');
    }

    req.companyId = company.id;
    req.user = {
      id: company.id,
      walletAddress: company.walletAddress,
      type: 'company',
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
    }
    next(error);
  }
};

/**
 * Validate merchant API key using prefix lookup + bcrypt verification
 */
async function validateApiKey(rawKey: string): Promise<{ id: string; walletAddress: string } | null> {
  // Extract prefix (first 8 chars: sk_live_ or sk_test_)
  const keyPrefix = rawKey.substring(0, 8);

  // Find API keys with matching prefix
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      keyPrefix,
      active: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      merchant: {
        select: {
          id: true,
          walletAddress: true,
        },
      },
    },
  });

  // Verify against each matching key
  for (const apiKey of apiKeys) {
    const isValid = await bcrypt.compare(rawKey, apiKey.keyHash);
    if (isValid) {
      // Update last used timestamp
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {}); // Best-effort update

      logger.debug('API key authenticated', { merchantId: apiKey.merchant.id });
      return apiKey.merchant;
    }
  }

  return null;
}

/**
 * Validate company API key
 */
async function validateCompanyApiKey(rawKey: string): Promise<{ id: string; walletAddress: string } | null> {
  const keyPrefix = rawKey.substring(0, 8);

  const companies = await prisma.company.findMany({
    where: {
      apiKeyPrefix: keyPrefix,
    },
    select: {
      id: true,
      walletAddress: true,
      apiKeyHash: true,
    },
  });

  for (const company of companies) {
    if (company.apiKeyHash) {
      const isValid = await bcrypt.compare(rawKey, company.apiKeyHash);
      if (isValid) {
        logger.debug('Company API key authenticated', { companyId: company.id });
        return { id: company.id, walletAddress: company.walletAddress };
      }
    }
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Verify JWT token
 */
function verifyToken(token: string): JWTPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }
  return jwt.verify(token, secret) as JWTPayload;
}

/**
 * Generate JWT token
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}
