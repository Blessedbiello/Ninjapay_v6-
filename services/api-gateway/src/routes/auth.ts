import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { generateToken } from '../middleware/authenticate.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('auth');

// Store nonces temporarily (in production, use Redis)
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

const nonceRequestSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  type: z.enum(['merchant', 'company']).default('merchant'),
});

const verifySchema = z.object({
  walletAddress: z.string().min(32).max(64),
  signature: z.string(),
  type: z.enum(['merchant', 'company']).default('merchant'),
});

/**
 * Request authentication nonce
 */
router.post('/nonce', asyncHandler(async (req, res) => {
  const { walletAddress, type } = nonceRequestSchema.parse(req.body);

  // Generate nonce
  const nonce = crypto.randomBytes(32).toString('hex');
  const message = `Sign this message to authenticate with NinjaPay.\n\nNonce: ${nonce}\nTimestamp: ${Date.now()}`;

  // Store nonce with 5 minute expiry
  nonceStore.set(walletAddress, {
    nonce,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  logger.debug('Nonce generated', { walletAddress, type });

  res.json({
    success: true,
    data: {
      nonce,
      message,
      expiresIn: 300, // 5 minutes
    },
    timestamp: Date.now(),
  });
}));

/**
 * Verify signature and issue JWT
 */
router.post('/verify', asyncHandler(async (req, res) => {
  const { walletAddress, signature, type } = verifySchema.parse(req.body);

  // Check nonce
  const storedNonce = nonceStore.get(walletAddress);
  if (!storedNonce || storedNonce.expiresAt < Date.now()) {
    nonceStore.delete(walletAddress);
    throw new AppError('Nonce expired or not found. Request a new nonce.', 401, 'NONCE_EXPIRED');
  }

  // In production, verify the signature against the wallet address
  // For now, we accept any signature (implement Solana signature verification)
  // TODO: Implement proper Solana signature verification
  if (!signature || signature.length < 64) {
    throw new AppError('Invalid signature', 401, 'INVALID_SIGNATURE');
  }

  // Clear nonce
  nonceStore.delete(walletAddress);

  // Find or create entity
  let entity: { id: string; walletAddress: string };

  if (type === 'merchant') {
    let merchant = await prisma.merchant.findUnique({
      where: { walletAddress },
    });

    if (!merchant) {
      // Auto-register merchant
      merchant = await prisma.merchant.create({
        data: {
          walletAddress,
          businessName: `Merchant ${walletAddress.substring(0, 8)}`,
          email: `${walletAddress.substring(0, 8)}@placeholder.ninjapay.io`,
        },
      });
      logger.info('New merchant registered', { merchantId: merchant.id });
    }

    entity = merchant;
  } else {
    let company = await prisma.company.findUnique({
      where: { walletAddress },
    });

    if (!company) {
      company = await prisma.company.create({
        data: {
          walletAddress,
          name: `Company ${walletAddress.substring(0, 8)}`,
          email: `${walletAddress.substring(0, 8)}@placeholder.ninjapay.io`,
        },
      });
      logger.info('New company registered', { companyId: company.id });
    }

    entity = company;
  }

  // Generate JWT
  const token = generateToken({
    id: entity.id,
    walletAddress: entity.walletAddress,
    type,
  });

  logger.info('Authentication successful', { entityId: entity.id, type });

  res.json({
    success: true,
    data: {
      token,
      expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
      entityId: entity.id,
      type,
    },
    timestamp: Date.now(),
  });
}));

export default router;
