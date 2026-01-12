import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { authenticateMerchant } from '../middleware/authenticate.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('payment-links');

const createPaymentLinkSchema = z.object({
  name: z.string().min(1).max(100),
  amount: z.number().positive().optional(),
  currency: z.string().default('USDC'),
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional(),
});

const updatePaymentLinkSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const listPaymentLinksSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function serializePaymentLink(link: any) {
  return {
    id: link.id,
    merchant_id: link.merchantId,
    url: link.url,
    name: link.name,
    amount: link.amount,
    currency: link.currency,
    active: link.active,
    max_uses: link.maxUses,
    usage_count: link.usageCount,
    expires_at: link.expiresAt,
    metadata: link.metadata,
    created_at: link.createdAt,
    updated_at: link.updatedAt,
  };
}

/**
 * POST /v1/payment_links - Create payment link
 */
router.post('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = createPaymentLinkSchema.parse(req.body);
  const merchantId = req.merchantId!;

  // Generate unique short URL
  const shortCode = crypto.randomBytes(8).toString('base64url');
  const baseUrl = process.env.CHECKOUT_BASE_URL || 'https://pay.ninjapay.io';
  const url = `${baseUrl}/${shortCode}`;

  const paymentLink = await prisma.paymentLink.create({
    data: {
      merchantId,
      url,
      name: body.name,
      amount: body.amount,
      currency: body.currency,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      metadata: body.metadata || {},
    },
  });

  logger.info('Payment link created', { paymentLinkId: paymentLink.id, merchantId });

  res.status(201).json({
    success: true,
    data: serializePaymentLink(paymentLink),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payment_links/:id - Retrieve payment link
 */
router.get('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const paymentLink = await prisma.paymentLink.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!paymentLink) {
    throw new AppError('Payment link not found', 404, 'PAYMENT_LINK_NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializePaymentLink(paymentLink),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payment_links - List payment links
 */
router.get('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const query = listPaymentLinksSchema.parse(req.query);
  const merchantId = req.merchantId!;

  const where: any = { merchantId };
  if (query.active !== undefined) {
    where.active = query.active === 'true';
  }

  const [paymentLinks, total] = await Promise.all([
    prisma.paymentLink.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.paymentLink.count({ where }),
  ]);

  res.json({
    success: true,
    data: paymentLinks.map(serializePaymentLink),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      has_more: query.offset + paymentLinks.length < total,
    },
    timestamp: Date.now(),
  });
}));

/**
 * PATCH /v1/payment_links/:id - Update payment link
 */
router.patch('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = updatePaymentLinkSchema.parse(req.body);

  const paymentLink = await prisma.paymentLink.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!paymentLink) {
    throw new AppError('Payment link not found', 404, 'PAYMENT_LINK_NOT_FOUND');
  }

  const updated = await prisma.paymentLink.update({
    where: { id: paymentLink.id },
    data: {
      name: body.name,
      active: body.active,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined,
    },
  });

  logger.info('Payment link updated', { paymentLinkId: paymentLink.id });

  res.json({
    success: true,
    data: serializePaymentLink(updated),
    timestamp: Date.now(),
  });
}));

/**
 * DELETE /v1/payment_links/:id - Delete (deactivate) payment link
 */
router.delete('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const paymentLink = await prisma.paymentLink.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!paymentLink) {
    throw new AppError('Payment link not found', 404, 'PAYMENT_LINK_NOT_FOUND');
  }

  await prisma.paymentLink.update({
    where: { id: paymentLink.id },
    data: { active: false },
  });

  logger.info('Payment link deactivated', { paymentLinkId: paymentLink.id });

  res.json({
    success: true,
    data: { id: paymentLink.id, deleted: true },
    timestamp: Date.now(),
  });
}));

export default router;
