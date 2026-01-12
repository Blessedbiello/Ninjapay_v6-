import crypto from 'crypto';
import { prisma } from '@ninjapay/database';
import { createLogger } from '@ninjapay/logger';

const logger = createLogger('webhook-delivery');

interface WebhookPayload {
  id: string;
  type: string;
  created: number;
  data: Record<string, any>;
}

interface DeliveryConfig {
  maxRetries: number;
  retryDelays: number[]; // delays in ms for each retry
  timeout: number; // request timeout in ms
}

const DEFAULT_CONFIG: DeliveryConfig = {
  maxRetries: 5,
  retryDelays: [0, 5000, 30000, 120000, 600000], // immediate, 5s, 30s, 2min, 10min
  timeout: 30000,
};

/**
 * Webhook Delivery Service
 * Handles sending webhooks with retries, tracking, and signature verification
 */
export class WebhookDeliveryService {
  private config: DeliveryConfig;
  private processingQueue: Set<string> = new Set();

  constructor(config: Partial<DeliveryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Queue a webhook for delivery
   */
  async queueWebhook(
    webhookId: string,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook || !webhook.enabled) {
      logger.debug('Webhook not found or disabled', { webhookId });
      return;
    }

    if (!webhook.events.includes(eventType)) {
      logger.debug('Event not subscribed', { webhookId, eventType });
      return;
    }

    const webhookPayload: WebhookPayload = {
      id: `evt_${crypto.randomBytes(16).toString('hex')}`,
      type: eventType,
      created: Date.now(),
      data: payload,
    };

    // Create delivery record
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId,
        eventType,
        payload: webhookPayload,
        attempts: 0,
        status: 'PENDING',
      },
    });

    // Start delivery process
    this.deliverWebhook(delivery.id, webhook.url, webhook.secret, webhookPayload);
  }

  /**
   * Queue webhooks for all matching subscribers
   */
  async broadcastEvent(
    merchantId: string,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    const webhooks = await prisma.webhook.findMany({
      where: {
        merchantId,
        enabled: true,
        events: { has: eventType },
      },
    });

    logger.debug('Broadcasting event', {
      merchantId,
      eventType,
      webhookCount: webhooks.length,
    });

    for (const webhook of webhooks) {
      await this.queueWebhook(webhook.id, eventType, payload);
    }
  }

  /**
   * Deliver a webhook with retry logic
   */
  private async deliverWebhook(
    deliveryId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
    attempt: number = 1
  ): Promise<void> {
    // Prevent duplicate processing
    if (this.processingQueue.has(deliveryId)) {
      return;
    }
    this.processingQueue.add(deliveryId);

    try {
      const payloadString = JSON.stringify(payload);
      const timestamp = Date.now().toString();

      // Generate signature: HMAC-SHA256(timestamp.payload)
      const signaturePayload = `${timestamp}.${payloadString}`;
      const signature = crypto
        .createHmac('sha256', secret)
        .update(signaturePayload)
        .digest('hex');

      logger.debug('Attempting webhook delivery', {
        deliveryId,
        url: url.substring(0, 50),
        attempt,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-ID': payload.id,
            'X-Webhook-Timestamp': timestamp,
            'X-Webhook-Signature': `sha256=${signature}`,
            'User-Agent': 'NinjaPay-Webhook/2.0',
          },
          body: payloadString,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Update delivery record
        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            attempts: attempt,
            status: response.ok ? 'DELIVERED' : 'FAILED',
            responseCode: response.status,
            respondedAt: new Date(),
          },
        });

        if (response.ok) {
          logger.info('Webhook delivered successfully', {
            deliveryId,
            url: url.substring(0, 50),
            status: response.status,
          });
        } else {
          logger.warn('Webhook delivery failed', {
            deliveryId,
            status: response.status,
            attempt,
          });

          // Schedule retry if not max attempts
          await this.scheduleRetry(deliveryId, url, secret, payload, attempt);
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId);

        const errorMessage = fetchError.name === 'AbortError'
          ? 'Request timeout'
          : fetchError.message;

        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            attempts: attempt,
            status: attempt >= this.config.maxRetries ? 'FAILED' : 'PENDING',
          },
        });

        logger.warn('Webhook delivery error', {
          deliveryId,
          error: errorMessage,
          attempt,
        });

        // Schedule retry
        await this.scheduleRetry(deliveryId, url, secret, payload, attempt);
      }
    } finally {
      this.processingQueue.delete(deliveryId);
    }
  }

  /**
   * Schedule a retry for failed webhook
   */
  private async scheduleRetry(
    deliveryId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
    currentAttempt: number
  ): Promise<void> {
    if (currentAttempt >= this.config.maxRetries) {
      logger.error('Webhook delivery failed after max retries', {
        deliveryId,
        attempts: currentAttempt,
      });
      return;
    }

    const nextAttempt = currentAttempt + 1;
    const delay = this.config.retryDelays[Math.min(nextAttempt - 1, this.config.retryDelays.length - 1)];

    logger.debug('Scheduling webhook retry', {
      deliveryId,
      nextAttempt,
      delayMs: delay,
    });

    setTimeout(() => {
      this.deliverWebhook(deliveryId, url, secret, payload, nextAttempt);
    }, delay);
  }

  /**
   * Retry a failed delivery manually
   */
  async retryDelivery(deliveryId: string): Promise<boolean> {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });

    if (!delivery) {
      return false;
    }

    // Reset status
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING' },
    });

    // Trigger delivery
    this.deliverWebhook(
      deliveryId,
      delivery.webhook.url,
      delivery.webhook.secret,
      delivery.payload as WebhookPayload,
      1
    );

    return true;
  }

  /**
   * Get delivery statistics for a merchant
   */
  async getDeliveryStats(merchantId: string): Promise<{
    total: number;
    delivered: number;
    failed: number;
    pending: number;
  }> {
    const webhooks = await prisma.webhook.findMany({
      where: { merchantId },
      select: { id: true },
    });

    const webhookIds = webhooks.map((w) => w.id);

    const [delivered, failed, pending, total] = await Promise.all([
      prisma.webhookDelivery.count({
        where: { webhookId: { in: webhookIds }, status: 'DELIVERED' },
      }),
      prisma.webhookDelivery.count({
        where: { webhookId: { in: webhookIds }, status: 'FAILED' },
      }),
      prisma.webhookDelivery.count({
        where: { webhookId: { in: webhookIds }, status: 'PENDING' },
      }),
      prisma.webhookDelivery.count({
        where: { webhookId: { in: webhookIds } },
      }),
    ]);

    return { total, delivered, failed, pending };
  }

  /**
   * Generate webhook signature verification code for documentation
   */
  static getVerificationExample(): string {
    return `
// Node.js webhook signature verification
const crypto = require('crypto');

function verifyWebhookSignature(payload, timestamp, signature, secret) {
  const signaturePayload = timestamp + '.' + payload;
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Express middleware example
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  if (!verifyWebhookSignature(req.body.toString(), timestamp, signature, WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body);
  // Process event...

  res.status(200).send('OK');
});
`;
  }
}

// Singleton instance
let webhookService: WebhookDeliveryService | null = null;

export function getWebhookDeliveryService(): WebhookDeliveryService {
  if (!webhookService) {
    webhookService = new WebhookDeliveryService();
  }
  return webhookService;
}
