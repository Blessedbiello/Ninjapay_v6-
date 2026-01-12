import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { authenticateMerchant } from '../middleware/authenticate.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('api-keys');

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default(['read', 'write']),
  expiresAt: z.string().datetime().optional(),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

const listApiKeysSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function serializeApiKey(key: any, rawKey?: string) {
  return {
    id: key.id,
    merchant_id: key.merchantId,
    name: key.name,
    key_prefix: key.keyPrefix,
    key: rawKey, // Only included on creation
    permissions: key.permissions,
    active: key.active,
    last_used_at: key.lastUsedAt,
    expires_at: key.expiresAt,
    created_at: key.createdAt,
  };
}

/**
 * POST /v1/api_keys - Create new API key
 */
router.post('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = createApiKeySchema.parse(req.body);
  const merchantId = req.merchantId!;

  // Check API key limit (max 10 per merchant)
  const existingCount = await prisma.apiKey.count({
    where: { merchantId, active: true },
  });

  if (existingCount >= 10) {
    throw new AppError('Maximum API key limit reached (10)', 400, 'API_KEY_LIMIT');
  }

  // Generate API key: sk_live_<random>
  const keyPrefix = 'sk_live_';
  const keyRandom = crypto.randomBytes(24).toString('hex');
  const rawKey = `${keyPrefix}${keyRandom}`;

  // Hash the key for storage
  const keyHash = await bcrypt.hash(rawKey, 12);

  const apiKey = await prisma.apiKey.create({
    data: {
      merchantId,
      keyHash,
      keyPrefix,
      name: body.name,
      permissions: body.permissions,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });

  logger.info('API key created', { apiKeyId: apiKey.id, merchantId });

  // Return raw key only once
  res.status(201).json({
    success: true,
    data: serializeApiKey(apiKey, rawKey),
    message: 'Store this key securely. It will not be shown again.',
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/api_keys - List API keys
 */
router.get('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const query = listApiKeysSchema.parse(req.query);
  const merchantId = req.merchantId!;

  const where: any = { merchantId };
  if (query.active !== undefined) {
    where.active = query.active === 'true';
  }

  const [apiKeys, total] = await Promise.all([
    prisma.apiKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.apiKey.count({ where }),
  ]);

  res.json({
    success: true,
    data: apiKeys.map(k => serializeApiKey(k)),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      has_more: query.offset + apiKeys.length < total,
    },
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/api_keys/:id - Get API key details
 */
router.get('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!apiKey) {
    throw new AppError('API key not found', 404, 'API_KEY_NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializeApiKey(apiKey),
    timestamp: Date.now(),
  });
}));

/**
 * PATCH /v1/api_keys/:id - Update API key
 */
router.patch('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = updateApiKeySchema.parse(req.body);

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!apiKey) {
    throw new AppError('API key not found', 404, 'API_KEY_NOT_FOUND');
  }

  const updated = await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: {
      name: body.name,
      permissions: body.permissions,
      active: body.active,
    },
  });

  logger.info('API key updated', { apiKeyId: apiKey.id });

  res.json({
    success: true,
    data: serializeApiKey(updated),
    timestamp: Date.now(),
  });
}));

/**
 * DELETE /v1/api_keys/:id - Revoke API key
 */
router.delete('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!apiKey) {
    throw new AppError('API key not found', 404, 'API_KEY_NOT_FOUND');
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { active: false },
  });

  logger.info('API key revoked', { apiKeyId: apiKey.id });

  res.json({
    success: true,
    data: { id: apiKey.id, revoked: true },
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/api_keys/:id/roll - Roll (regenerate) API key
 */
router.post('/:id/roll', authenticateMerchant, asyncHandler(async (req, res) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
      active: true,
    },
  });

  if (!apiKey) {
    throw new AppError('API key not found or inactive', 404, 'API_KEY_NOT_FOUND');
  }

  // Generate new key
  const keyRandom = crypto.randomBytes(24).toString('hex');
  const rawKey = `${apiKey.keyPrefix}${keyRandom}`;
  const keyHash = await bcrypt.hash(rawKey, 12);

  const updated = await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { keyHash },
  });

  logger.info('API key rolled', { apiKeyId: apiKey.id });

  res.json({
    success: true,
    data: serializeApiKey(updated, rawKey),
    message: 'API key regenerated. Store this key securely.',
    timestamp: Date.now(),
  });
}));

export default router;
