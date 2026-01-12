import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { authenticateMerchant } from '../middleware/authenticate.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('webhooks');

const WEBHOOK_EVENTS = [
  'payment_intent.created',
  'payment_intent.confirmed',
  'payment_intent.failed',
  'payment_intent.cancelled',
  'payment_link.payment_completed',
] as const;

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  enabled: z.boolean().default(true),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  enabled: z.boolean().optional(),
});

const listWebhooksSchema = z.object({
  enabled: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function serializeWebhook(webhook: any, includeSecret = false) {
  return {
    id: webhook.id,
    merchant_id: webhook.merchantId,
    url: webhook.url,
    events: webhook.events,
    enabled: webhook.enabled,
    secret: includeSecret ? webhook.secret : undefined,
    created_at: webhook.createdAt,
    updated_at: webhook.updatedAt,
  };
}

/**
 * POST /v1/webhooks - Create webhook endpoint
 */
router.post('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = createWebhookSchema.parse(req.body);
  const merchantId = req.merchantId!;

  // Generate webhook secret
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  const webhook = await prisma.webhook.create({
    data: {
      merchantId,
      url: body.url,
      events: body.events,
      secret,
      enabled: body.enabled,
    },
  });

  logger.info('Webhook created', { webhookId: webhook.id, merchantId });

  // Return secret only on creation
  res.status(201).json({
    success: true,
    data: serializeWebhook(webhook, true),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/webhooks/:id - Retrieve webhook
 */
router.get('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const webhook = await prisma.webhook.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!webhook) {
    throw new AppError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializeWebhook(webhook),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/webhooks - List webhooks
 */
router.get('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const query = listWebhooksSchema.parse(req.query);
  const merchantId = req.merchantId!;

  const where: any = { merchantId };
  if (query.enabled !== undefined) {
    where.enabled = query.enabled === 'true';
  }

  const [webhooks, total] = await Promise.all([
    prisma.webhook.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.webhook.count({ where }),
  ]);

  res.json({
    success: true,
    data: webhooks.map(w => serializeWebhook(w)),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      has_more: query.offset + webhooks.length < total,
    },
    timestamp: Date.now(),
  });
}));

/**
 * PATCH /v1/webhooks/:id - Update webhook
 */
router.patch('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = updateWebhookSchema.parse(req.body);

  const webhook = await prisma.webhook.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!webhook) {
    throw new AppError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
  }

  const updated = await prisma.webhook.update({
    where: { id: webhook.id },
    data: {
      url: body.url,
      events: body.events,
      enabled: body.enabled,
    },
  });

  logger.info('Webhook updated', { webhookId: webhook.id });

  res.json({
    success: true,
    data: serializeWebhook(updated),
    timestamp: Date.now(),
  });
}));

/**
 * DELETE /v1/webhooks/:id - Delete webhook
 */
router.delete('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const webhook = await prisma.webhook.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!webhook) {
    throw new AppError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
  }

  await prisma.webhook.delete({
    where: { id: webhook.id },
  });

  logger.info('Webhook deleted', { webhookId: webhook.id });

  res.json({
    success: true,
    data: { id: webhook.id, deleted: true },
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/webhooks/:id/rotate-secret - Rotate webhook secret
 */
router.post('/:id/rotate-secret', authenticateMerchant, asyncHandler(async (req, res) => {
  const webhook = await prisma.webhook.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!webhook) {
    throw new AppError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
  }

  const newSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  const updated = await prisma.webhook.update({
    where: { id: webhook.id },
    data: { secret: newSecret },
  });

  logger.info('Webhook secret rotated', { webhookId: webhook.id });

  res.json({
    success: true,
    data: serializeWebhook(updated, true),
    timestamp: Date.now(),
  });
}));

export default router;
