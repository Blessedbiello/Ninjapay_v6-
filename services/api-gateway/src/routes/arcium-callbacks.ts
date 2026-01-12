import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { ArciumClientService } from '../services/arcium-client.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('arcium-callbacks');

let arciumClient: ArciumClientService | null = null;
function getArciumClient(): ArciumClientService {
  if (!arciumClient) {
    arciumClient = new ArciumClientService();
  }
  return arciumClient;
}

const callbackSchema = z.object({
  computation_id: z.string(),
  computation_type: z.enum(['payment_settlement', 'payroll_settlement']),
  status: z.enum(['completed', 'failed']),
  result: z.object({
    tx_signatures: z.array(z.string()).optional(),
    error_message: z.string().optional(),
    payment_results: z.array(z.object({
      employee_id: z.string(),
      tx_signature: z.string().optional(),
      status: z.enum(['completed', 'failed']),
      error: z.string().optional(),
    })).optional(),
  }).optional(),
  timestamp: z.number(),
});

/**
 * POST /v1/arcium/callbacks - Receive computation results from Arcium cluster
 */
router.post('/', asyncHandler(async (req, res) => {
  // Verify callback signature
  const signature = req.headers['x-arcium-signature'] as string;
  if (!signature) {
    throw new AppError('Missing callback signature', 401, 'MISSING_SIGNATURE');
  }

  const arcium = getArciumClient();
  const payload = JSON.stringify(req.body);

  if (!arcium.verifyCallbackSignature(payload, signature)) {
    logger.warn('Invalid callback signature received');
    throw new AppError('Invalid callback signature', 401, 'INVALID_SIGNATURE');
  }

  const body = callbackSchema.parse(req.body);

  logger.info('Arcium callback received', {
    computationId: body.computation_id,
    type: body.computation_type,
    status: body.status,
  });

  if (body.computation_type === 'payment_settlement') {
    await handlePaymentSettlement(body);
  } else if (body.computation_type === 'payroll_settlement') {
    await handlePayrollSettlement(body);
  }

  res.json({
    success: true,
    message: 'Callback processed',
    timestamp: Date.now(),
  });
}));

/**
 * Handle payment settlement callback
 */
async function handlePaymentSettlement(callback: z.infer<typeof callbackSchema>) {
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: { computationId: callback.computation_id },
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
    logger.warn('Payment intent not found for computation', {
      computationId: callback.computation_id,
    });
    return;
  }

  const newStatus = callback.status === 'completed' ? 'FINALIZED' : 'FAILED';
  const txSignature = callback.result?.tx_signatures?.[0];

  await prisma.paymentIntent.update({
    where: { id: paymentIntent.id },
    data: {
      status: newStatus,
      computationStatus: callback.status === 'completed' ? 'COMPLETED' : 'FAILED',
      txSignature,
      metadata: {
        ...(paymentIntent.metadata as object || {}),
        settlementTimestamp: callback.timestamp,
        errorMessage: callback.result?.error_message,
      },
    },
  });

  logger.info('Payment intent updated from callback', {
    paymentIntentId: paymentIntent.id,
    status: newStatus,
    txSignature,
  });

  // Send webhooks
  const eventType = callback.status === 'completed'
    ? 'payment_intent.confirmed'
    : 'payment_intent.failed';

  await sendWebhooks(paymentIntent.merchant.webhooks, eventType, {
    payment_intent_id: paymentIntent.id,
    status: newStatus.toLowerCase(),
    tx_signature: txSignature,
    timestamp: callback.timestamp,
  });
}

/**
 * Handle payroll settlement callback
 */
async function handlePayrollSettlement(callback: z.infer<typeof callbackSchema>) {
  const batch = await prisma.payrollBatch.findFirst({
    where: { computationId: callback.computation_id },
    include: {
      payments: true,
    },
  });

  if (!batch) {
    logger.warn('Payroll batch not found for computation', {
      computationId: callback.computation_id,
    });
    return;
  }

  const newStatus = callback.status === 'completed' ? 'COMPLETED' : 'FAILED';

  // Update batch
  await prisma.payrollBatch.update({
    where: { id: batch.id },
    data: {
      status: newStatus,
      metadata: {
        ...(batch.metadata as object || {}),
        settlementTimestamp: callback.timestamp,
        errorMessage: callback.result?.error_message,
      },
    },
  });

  // Update individual payments if results provided
  if (callback.result?.payment_results) {
    for (const result of callback.result.payment_results) {
      await prisma.payrollPayment.updateMany({
        where: {
          batchId: batch.id,
          employeeId: result.employee_id,
        },
        data: {
          status: result.status === 'completed' ? 'COMPLETED' : 'FAILED',
          txSignature: result.tx_signature,
        },
      });
    }
  } else {
    // Bulk update all payments
    await prisma.payrollPayment.updateMany({
      where: { batchId: batch.id },
      data: { status: newStatus },
    });
  }

  logger.info('Payroll batch updated from callback', {
    batchId: batch.id,
    status: newStatus,
    paymentsProcessed: callback.result?.payment_results?.length || batch.payments.length,
  });
}

/**
 * Send webhook notifications
 */
async function sendWebhooks(
  webhooks: any[],
  eventType: string,
  payload: Record<string, any>
) {
  const crypto = await import('crypto');

  for (const webhook of webhooks) {
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

    // Create delivery record
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType,
        payload: webhookPayload,
        attempts: 0,
        status: 'PENDING',
      },
    });

    // Send webhook (fire and forget with retry logic)
    deliverWebhook(webhook.url, payloadString, signature, delivery.id).catch(err => {
      logger.error('Webhook delivery failed', { error: err, deliveryId: delivery.id });
    });
  }
}

/**
 * Deliver webhook with retry logic
 */
async function deliverWebhook(
  url: string,
  payload: string,
  signature: string,
  deliveryId: string,
  attempt = 1
) {
  const maxAttempts = 3;
  const retryDelays = [0, 5000, 30000]; // immediate, 5s, 30s

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': Date.now().toString(),
      },
      body: payload,
    });

    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: attempt,
        status: response.ok ? 'DELIVERED' : 'FAILED',
        responseCode: response.status,
        respondedAt: new Date(),
      },
    });

    if (!response.ok && attempt < maxAttempts) {
      // Schedule retry
      setTimeout(() => {
        deliverWebhook(url, payload, signature, deliveryId, attempt + 1);
      }, retryDelays[attempt]);
    }

    logger.debug('Webhook delivered', { deliveryId, status: response.status, attempt });
  } catch (error) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: attempt,
        status: attempt >= maxAttempts ? 'FAILED' : 'PENDING',
      },
    });

    if (attempt < maxAttempts) {
      setTimeout(() => {
        deliverWebhook(url, payload, signature, deliveryId, attempt + 1);
      }, retryDelays[attempt]);
    }

    logger.warn('Webhook delivery error', { deliveryId, error, attempt });
  }
}

export default router;
