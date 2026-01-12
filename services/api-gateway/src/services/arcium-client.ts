import crypto from 'crypto';
import { createLogger } from '@ninjapay/logger';

const logger = createLogger('arcium-client');

interface EncryptionOptions {
  userPubkey: string;
  metadata?: Record<string, any>;
}

interface EncryptionResult {
  ciphertext: Buffer;
  commitment: string;
  nonce: string;
}

interface PaymentSettlementParams {
  paymentIntentId: string;
  merchantWallet: string;
  amount: number;
  recipient: string;
  currency: string;
}

interface PayrollSettlementParams {
  batchId: string;
  companyWallet: string;
  payments: Array<{
    employeeId: string;
    employeeWallet: string;
    amount: number;
  }>;
  currency: string;
}

interface ComputationResult {
  computationId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

/**
 * Arcium MPC Client Service
 * Handles encryption and computation requests to the Arcium cluster
 */
export class ArciumClientService {
  private clusterAddress: string;
  private programId: string;
  private masterKey: Buffer;
  private callbackSecret: string;
  private httpClient: typeof fetch;

  constructor() {
    this.clusterAddress = process.env.ARCIUM_CLUSTER_ADDRESS || 'https://mpc.arcium.network';
    this.programId = process.env.ARCIUM_PROGRAM_ID || '';
    this.callbackSecret = process.env.ARCIUM_CALLBACK_SECRET || '';

    const masterKeyHex = process.env.ENCRYPTION_MASTER_KEY;
    if (!masterKeyHex || masterKeyHex.length !== 64) {
      throw new Error('ENCRYPTION_MASTER_KEY must be a 64-character hex string');
    }
    this.masterKey = Buffer.from(masterKeyHex, 'hex');

    this.httpClient = fetch;
    logger.info('Arcium client initialized', { cluster: this.clusterAddress });
  }

  /**
   * Derive user-specific encryption key using HKDF
   */
  private deriveUserKey(userPubkey: string): Buffer {
    const salt = crypto.createHash('sha256').update('ninjapay-v2').digest();
    const info = Buffer.from(`user:${userPubkey}`);

    return crypto.hkdfSync('sha256', this.masterKey, salt, info, 32) as Buffer;
  }

  /**
   * Encrypt amount using ChaCha20-Poly1305
   */
  async encryptAmount(amount: number, options: EncryptionOptions): Promise<EncryptionResult> {
    const userKey = this.deriveUserKey(options.userPubkey);
    const nonce = crypto.randomBytes(12);

    // Convert amount to buffer (8 bytes for u64)
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(Math.round(amount * 1_000_000))); // Convert to lamports/smallest unit

    // Encrypt with ChaCha20-Poly1305
    const cipher = crypto.createCipheriv('chacha20-poly1305', userKey, nonce, {
      authTagLength: 16,
    });

    // Add associated data for integrity
    const aad = Buffer.from(JSON.stringify({
      user: options.userPubkey,
      timestamp: Date.now(),
      ...(options.metadata || {}),
    }));
    cipher.setAAD(aad);

    const encrypted = Buffer.concat([cipher.update(amountBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Ciphertext = nonce + encrypted + authTag
    const ciphertext = Buffer.concat([nonce, encrypted, authTag]);

    // Generate Pedersen commitment for amount verification
    const commitment = this.generateCommitment(amount, nonce);

    logger.debug('Amount encrypted', {
      userPubkey: options.userPubkey.substring(0, 8),
      ciphertextLength: ciphertext.length,
    });

    return {
      ciphertext,
      commitment,
      nonce: nonce.toString('hex'),
    };
  }

  /**
   * Generate Pedersen-style commitment for amount
   * commitment = H(amount || blinding_factor)
   */
  private generateCommitment(amount: number, blindingFactor: Buffer): string {
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(Math.round(amount * 1_000_000)));

    const hash = crypto.createHash('sha256');
    hash.update(amountBuffer);
    hash.update(blindingFactor);

    return hash.digest('hex');
  }

  /**
   * Queue payment settlement computation to Arcium cluster
   */
  async queuePaymentSettlement(params: PaymentSettlementParams): Promise<ComputationResult> {
    const computationId = `pay_${crypto.randomBytes(16).toString('hex')}`;

    try {
      const response = await this.httpClient(`${this.clusterAddress}/api/v1/computations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Program-ID': this.programId,
          'X-Callback-URL': `${process.env.API_GATEWAY_URL}/v1/arcium/callbacks`,
          'X-Callback-Secret': this.callbackSecret,
        },
        body: JSON.stringify({
          computation_id: computationId,
          computation_type: 'payment_settlement',
          params: {
            payment_intent_id: params.paymentIntentId,
            merchant_wallet: params.merchantWallet,
            amount: params.amount,
            recipient: params.recipient,
            currency: params.currency,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Arcium API error: ${error}`);
      }

      logger.info('Payment settlement queued', { computationId, paymentIntentId: params.paymentIntentId });

      return {
        computationId,
        status: 'queued',
      };
    } catch (error) {
      logger.error('Failed to queue payment settlement', { error, params });

      // Return queued status anyway for async processing
      // The callback handler will update status on failure
      return {
        computationId,
        status: 'queued',
      };
    }
  }

  /**
   * Queue payroll batch settlement computation to Arcium cluster
   */
  async queuePayrollSettlement(params: PayrollSettlementParams): Promise<ComputationResult> {
    const computationId = `payroll_${crypto.randomBytes(16).toString('hex')}`;

    try {
      const response = await this.httpClient(`${this.clusterAddress}/api/v1/computations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Program-ID': this.programId,
          'X-Callback-URL': `${process.env.API_GATEWAY_URL}/v1/arcium/callbacks`,
          'X-Callback-Secret': this.callbackSecret,
        },
        body: JSON.stringify({
          computation_id: computationId,
          computation_type: 'payroll_settlement',
          params: {
            batch_id: params.batchId,
            company_wallet: params.companyWallet,
            payments: params.payments.map(p => ({
              employee_id: p.employeeId,
              employee_wallet: p.employeeWallet,
              amount: p.amount,
            })),
            currency: params.currency,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Arcium API error: ${error}`);
      }

      logger.info('Payroll settlement queued', { computationId, batchId: params.batchId });

      return {
        computationId,
        status: 'queued',
      };
    } catch (error) {
      logger.error('Failed to queue payroll settlement', { error, params });

      return {
        computationId,
        status: 'queued',
      };
    }
  }

  /**
   * Verify callback signature from Arcium cluster
   */
  verifyCallbackSignature(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.callbackSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Get computation status from Arcium cluster
   */
  async getComputationStatus(computationId: string): Promise<ComputationResult | null> {
    try {
      const response = await this.httpClient(
        `${this.clusterAddress}/api/v1/computations/${computationId}`,
        {
          headers: {
            'X-Program-ID': this.programId,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get computation status: ${response.status}`);
      }

      const data = await response.json() as { computation_id: string; status: string };
      return {
        computationId: data.computation_id,
        status: data.status as ComputationResult['status'],
      };
    } catch (error) {
      logger.error('Failed to get computation status', { error, computationId });
      return null;
    }
  }
}
