import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { authenticateMerchant } from '../middleware/authenticate.js';
import { ArciumClientService } from '../services/arcium-client.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('payment-intents');

// Lazy-load Arcium service
let arciumClient: ArciumClientService | null = null;
function getArciumClient(): ArciumClientService {
  if (!arciumClient) {
    arciumClient = new ArciumClientService();
  }
  return arciumClient;
}

// Validation schemas
const createPaymentIntentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('USDC'),
  recipient: z.string().min(32).max(64),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const updatePaymentIntentSchema = z.object({
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const listPaymentIntentsSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'CONFIRMED', 'FINALIZED', 'FAILED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Serialize payment intent for API response (hide sensitive data)
 */
function serializePaymentIntent(pi: any) {
  return {
    id: pi.id,
    merchant_id: pi.merchantId,
    recipient: pi.recipient,
    amount: null, // Never expose plaintext amount
    amount_commitment: pi.amountCommitment,
    encrypted_amount: pi.encryptedAmount ? Buffer.from(pi.encryptedAmount).toString('base64') : null,
    currency: pi.currency,
    status: pi.status.toLowerCase(),
    description: pi.description,
    tx_signature: pi.txSignature,
    computation_id: pi.computationId,
    computation_status: pi.computationStatus?.toLowerCase(),
    metadata: pi.metadata,
    created_at: pi.createdAt,
    updated_at: pi.updatedAt,
  };
}

/**
 * POST /v1/payment_intents - Create payment intent
 */
router.post('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = createPaymentIntentSchema.parse(req.body);
  const merchantId = req.merchantId!;

  logger.info('Creating payment intent', { merchantId, recipient: body.recipient });

  // Get merchant wallet for encryption
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { walletAddress: true },
  });

  if (!merchant) {
    throw new AppError('Merchant not found', 404, 'MERCHANT_NOT_FOUND');
  }

  // Encrypt amount using Arcium
  const arcium = getArciumClient();
  const encryptionResult = await arcium.encryptAmount(body.amount, {
    userPubkey: merchant.walletAddress,
    metadata: {
      merchantId,
      recipient: body.recipient,
    },
  });

  // Create payment intent in database
  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      merchantId,
      recipient: body.recipient,
      encryptedAmount: encryptionResult.ciphertext,
      amountCommitment: encryptionResult.commitment,
      currency: body.currency,
      status: 'PENDING',
      description: body.description,
      computationStatus: 'QUEUED',
      metadata: {
        ...(body.metadata || {}),
        encrypted: true,
        encryptionKey: merchant.walletAddress,
        amount: body.amount, // Store for later settlement
      },
    },
  });

  logger.info('Payment intent created', { paymentIntentId: paymentIntent.id });

  res.status(201).json({
    success: true,
    data: serializePaymentIntent(paymentIntent),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payment_intents/:id - Retrieve payment intent
 */
router.get('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!paymentIntent) {
    throw new AppError('Payment intent not found', 404, 'PAYMENT_INTENT_NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializePaymentIntent(paymentIntent),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payment_intents - List payment intents
 */
router.get('/', authenticateMerchant, asyncHandler(async (req, res) => {
  const query = listPaymentIntentsSchema.parse(req.query);
  const merchantId = req.merchantId!;

  const where: any = { merchantId };
  if (query.status) {
    where.status = query.status;
  }

  const [paymentIntents, total] = await Promise.all([
    prisma.paymentIntent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.paymentIntent.count({ where }),
  ]);

  res.json({
    success: true,
    data: paymentIntents.map(serializePaymentIntent),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      has_more: query.offset + paymentIntents.length < total,
    },
    timestamp: Date.now(),
  });
}));

/**
 * PATCH /v1/payment_intents/:id - Update payment intent
 */
router.patch('/:id', authenticateMerchant, asyncHandler(async (req, res) => {
  const body = updatePaymentIntentSchema.parse(req.body);

  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!paymentIntent) {
    throw new AppError('Payment intent not found', 404, 'PAYMENT_INTENT_NOT_FOUND');
  }

  if (paymentIntent.status !== 'PENDING') {
    throw new AppError('Can only update pending payment intents', 400, 'INVALID_STATUS');
  }

  const updated = await prisma.paymentIntent.update({
    where: { id: paymentIntent.id },
    data: {
      description: body.description,
      metadata: body.metadata ? { ...paymentIntent.metadata as object, ...body.metadata } : undefined,
    },
  });

  res.json({
    success: true,
    data: serializePaymentIntent(updated),
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/payment_intents/:id/confirm - Confirm payment intent
 */
router.post('/:id/confirm', authenticateMerchant, asyncHandler(async (req, res) => {
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!paymentIntent) {
    throw new AppError('Payment intent not found', 404, 'PAYMENT_INTENT_NOT_FOUND');
  }

  if (paymentIntent.status !== 'PENDING') {
    throw new AppError(`Cannot confirm payment intent in status: ${paymentIntent.status}`, 400, 'INVALID_STATUS');
  }

  logger.info('Confirming payment intent', { paymentIntentId: paymentIntent.id });

  // Get merchant wallet
  const merchant = await prisma.merchant.findUnique({
    where: { id: req.merchantId! },
    select: { walletAddress: true },
  });

  // Queue computation to Arcium
  const arcium = getArciumClient();
  const metadata = paymentIntent.metadata as Record<string, any> || {};

  const computationResult = await arcium.queuePaymentSettlement({
    paymentIntentId: paymentIntent.id,
    merchantWallet: merchant!.walletAddress,
    amount: metadata.amount,
    recipient: paymentIntent.recipient,
    currency: paymentIntent.currency,
  });

  // Update payment intent status
  const updated = await prisma.paymentIntent.update({
    where: { id: paymentIntent.id },
    data: {
      status: 'PROCESSING',
      computationId: computationResult.computationId,
      computationStatus: 'QUEUED',
    },
  });

  logger.info('Payment intent confirmed', {
    paymentIntentId: paymentIntent.id,
    computationId: computationResult.computationId
  });

  res.json({
    success: true,
    data: serializePaymentIntent(updated),
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/payment_intents/:id/cancel - Cancel payment intent
 */
router.post('/:id/cancel', authenticateMerchant, asyncHandler(async (req, res) => {
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: req.params.id,
      merchantId: req.merchantId!,
    },
  });

  if (!paymentIntent) {
    throw new AppError('Payment intent not found', 404, 'PAYMENT_INTENT_NOT_FOUND');
  }

  if (!['PENDING', 'PROCESSING'].includes(paymentIntent.status)) {
    throw new AppError(`Cannot cancel payment intent in status: ${paymentIntent.status}`, 400, 'INVALID_STATUS');
  }

  const updated = await prisma.paymentIntent.update({
    where: { id: paymentIntent.id },
    data: { status: 'CANCELLED' },
  });

  logger.info('Payment intent cancelled', { paymentIntentId: paymentIntent.id });

  res.json({
    success: true,
    data: serializePaymentIntent(updated),
    timestamp: Date.now(),
  });
}));

export default router;
