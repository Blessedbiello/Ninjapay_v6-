import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { ArciumClientService } from '../services/arcium-client.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('checkout');

let arciumClient: ArciumClientService | null = null;
function getArciumClient(): ArciumClientService {
  if (!arciumClient) {
    arciumClient = new ArciumClientService();
  }
  return arciumClient;
}

const createIntentSchema = z.object({
  amount: z.number().positive(),
  payer_wallet: z.string().min(32).max(64),
});

const confirmPaymentSchema = z.object({
  payment_intent_id: z.string(),
  tx_signature: z.string().min(64),
});

/**
 * GET /v1/checkout/:linkId - Get payment link details for checkout
 * This is a public endpoint (no auth required)
 */
router.get('/:linkId', asyncHandler(async (req, res) => {
  // Extract short code from URL or use linkId directly
  const linkId = req.params.linkId;

  // Try to find by ID first, then by URL suffix
  let paymentLink = await prisma.paymentLink.findUnique({
    where: { id: linkId },
    include: {
      merchant: {
        select: {
          id: true,
          businessName: true,
          walletAddress: true,
        },
      },
    },
  });

  // If not found by ID, try to find by URL containing the linkId
  if (!paymentLink) {
    paymentLink = await prisma.paymentLink.findFirst({
      where: {
        url: { contains: linkId },
      },
      include: {
        merchant: {
          select: {
            id: true,
            businessName: true,
            walletAddress: true,
          },
        },
      },
    });
  }

  if (!paymentLink) {
    throw new AppError('Payment link not found', 404, 'LINK_NOT_FOUND');
  }

  // Check if link is still valid
  if (!paymentLink.active) {
    throw new AppError('Payment link is no longer active', 410, 'LINK_INACTIVE');
  }

  if (paymentLink.expiresAt && paymentLink.expiresAt < new Date()) {
    throw new AppError('Payment link has expired', 410, 'LINK_EXPIRED');
  }

  if (paymentLink.maxUses && paymentLink.usageCount >= paymentLink.maxUses) {
    throw new AppError('Payment link usage limit reached', 410, 'LINK_LIMIT_REACHED');
  }

  res.json({
    success: true,
    data: {
      id: paymentLink.id,
      merchant_id: paymentLink.merchantId,
      url: paymentLink.url,
      name: paymentLink.name,
      amount: paymentLink.amount,
      currency: paymentLink.currency,
      active: paymentLink.active,
      merchant: {
        business_name: paymentLink.merchant.businessName,
        wallet_address: paymentLink.merchant.walletAddress,
      },
    },
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/checkout/:linkId/intent - Create payment intent from link
 * This is a public endpoint (no auth required)
 */
router.post('/:linkId/intent', asyncHandler(async (req, res) => {
  const body = createIntentSchema.parse(req.body);
  const linkId = req.params.linkId;

  // Find payment link
  let paymentLink = await prisma.paymentLink.findUnique({
    where: { id: linkId },
    include: {
      merchant: {
        select: {
          id: true,
          walletAddress: true,
        },
      },
    },
  });

  if (!paymentLink) {
    paymentLink = await prisma.paymentLink.findFirst({
      where: { url: { contains: linkId } },
      include: {
        merchant: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
    });
  }

  if (!paymentLink) {
    throw new AppError('Payment link not found', 404, 'LINK_NOT_FOUND');
  }

  // Validate link is active
  if (!paymentLink.active) {
    throw new AppError('Payment link is no longer active', 410, 'LINK_INACTIVE');
  }

  // Validate amount if fixed
  if (paymentLink.amount && paymentLink.amount !== body.amount) {
    throw new AppError('Amount does not match payment link', 400, 'AMOUNT_MISMATCH');
  }

  // Encrypt amount using Arcium
  const arcium = getArciumClient();
  const encryptionResult = await arcium.encryptAmount(body.amount, {
    userPubkey: body.payer_wallet,
    metadata: {
      paymentLinkId: paymentLink.id,
      merchantId: paymentLink.merchantId,
    },
  });

  // Create payment intent
  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      merchantId: paymentLink.merchantId,
      recipient: paymentLink.merchant.walletAddress,
      encryptedAmount: encryptionResult.ciphertext,
      amountCommitment: encryptionResult.commitment,
      currency: paymentLink.currency,
      status: 'PENDING',
      description: `Payment via ${paymentLink.name}`,
      computationStatus: 'QUEUED',
      metadata: {
        paymentLinkId: paymentLink.id,
        payerWallet: body.payer_wallet,
        amount: body.amount,
        encrypted: true,
      },
    },
  });

  logger.info('Payment intent created from link', {
    paymentIntentId: paymentIntent.id,
    paymentLinkId: paymentLink.id,
    payerWallet: body.payer_wallet.substring(0, 8),
  });

  res.status(201).json({
    success: true,
    data: {
      id: paymentIntent.id,
      merchant_wallet: paymentLink.merchant.walletAddress,
      amount: body.amount,
      currency: paymentLink.currency,
      commitment: encryptionResult.commitment,
    },
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/checkout/:linkId/confirm - Confirm payment with transaction signature
 * This is a public endpoint (no auth required)
 */
router.post('/:linkId/confirm', asyncHandler(async (req, res) => {
  const body = confirmPaymentSchema.parse(req.body);
  const linkId = req.params.linkId;

  // Find payment intent
  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: { id: body.payment_intent_id },
    include: {
      merchant: {
        include: {
          webhooks: {
            where: { enabled: true },
          },
        },
      },
    },
  });

  if (!paymentIntent) {
    throw new AppError('Payment intent not found', 404, 'INTENT_NOT_FOUND');
  }

  // Verify the payment intent is associated with this link
  const metadata = paymentIntent.metadata as Record<string, any> || {};
  if (metadata.paymentLinkId !== linkId && !metadata.paymentLinkId?.includes(linkId)) {
    throw new AppError('Payment intent does not match link', 400, 'INTENT_LINK_MISMATCH');
  }

  if (paymentIntent.status !== 'PENDING') {
    throw new AppError(`Cannot confirm payment in status: ${paymentIntent.status}`, 400, 'INVALID_STATUS');
  }

  // Update payment intent with transaction signature
  const updated = await prisma.paymentIntent.update({
    where: { id: paymentIntent.id },
    data: {
      status: 'CONFIRMED',
      txSignature: body.tx_signature,
      computationStatus: 'COMPLETED',
    },
  });

  // Increment payment link usage
  await prisma.paymentLink.update({
    where: { id: metadata.paymentLinkId },
    data: {
      usageCount: { increment: 1 },
    },
  });

  // Send webhooks
  await sendPaymentWebhooks(paymentIntent.merchant, 'payment_link.payment_completed', {
    payment_intent_id: paymentIntent.id,
    payment_link_id: metadata.paymentLinkId,
    tx_signature: body.tx_signature,
    amount: metadata.amount,
    currency: paymentIntent.currency,
    payer_wallet: metadata.payerWallet,
  });

  logger.info('Payment confirmed', {
    paymentIntentId: paymentIntent.id,
    txSignature: body.tx_signature,
  });

  res.json({
    success: true,
    data: {
      id: updated.id,
      status: updated.status.toLowerCase(),
      tx_signature: updated.txSignature,
    },
    timestamp: Date.now(),
  });
}));

/**
 * Send webhook notifications for payment events
 */
async function sendPaymentWebhooks(
  merchant: any,
  eventType: string,
  payload: Record<string, any>
) {
  const crypto = await import('crypto');

  for (const webhook of merchant.webhooks || []) {
    if (!webhook.events.includes(eventType)) {
      continue;
    }

    const webhookPayload = {
      id: `evt_${crypto.randomBytes(16).toString('hex')}`,
      type: eventType,
      created: Date.now(),
      data: payload,
    };

    const payloadString = JSON.stringify(webhookPayload);
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payloadString)
      .digest('hex');

    // Create delivery record and send
    try {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          eventType,
          payload: webhookPayload,
          attempts: 1,
          status: 'PENDING',
        },
      });

      // Fire and forget webhook delivery
      fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': Date.now().toString(),
        },
        body: payloadString,
      })
        .then(async (response) => {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: response.ok ? 'DELIVERED' : 'FAILED',
              responseCode: response.status,
              respondedAt: new Date(),
            },
          });
        })
        .catch(async () => {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: 'FAILED' },
          });
        });
    } catch (err) {
      logger.error('Failed to create webhook delivery', { error: err });
    }
  }
}

export default router;
