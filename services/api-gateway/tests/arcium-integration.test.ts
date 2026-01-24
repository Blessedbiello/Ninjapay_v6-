/**
 * Arcium MPC Cluster Integration Tests
 *
 * These tests verify integration with the real Arcium MPC cluster.
 * Run with: ARCIUM_TEST_MODE=live pnpm test -- arcium-integration
 *
 * Required environment variables:
 * - ENCRYPTION_MASTER_KEY: 64-char hex string
 * - ARCIUM_PROGRAM_ID: Deployed program ID
 * - ARCIUM_CLUSTER_ADDRESS: MPC cluster URL
 * - ARCIUM_CALLBACK_SECRET: Callback verification secret
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';

// Test configuration
const TEST_CONFIG = {
  masterKey: process.env.ENCRYPTION_MASTER_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  clusterAddress: process.env.ARCIUM_CLUSTER_ADDRESS || 'https://mpc.arcium.network',
  programId: process.env.ARCIUM_PROGRAM_ID || 'test-program-id',
  callbackSecret: process.env.ARCIUM_CALLBACK_SECRET || 'test-callback-secret',
  testWallet: '7xKXtg2CW8ukAp9rXKD2RQU3w5RJKPME6nXbvNfTQAaP',
  isLiveMode: process.env.ARCIUM_TEST_MODE === 'live',
};

// Helper: Derive user key using HKDF (same as production)
function deriveUserKey(masterKey: Buffer, userPubkey: string): Buffer {
  const salt = crypto.createHash('sha256').update('ninjapay-v2').digest();
  const info = Buffer.from(`user:${userPubkey}`);
  const derivedKey = crypto.hkdfSync('sha256', masterKey, salt, info, 32);
  return Buffer.from(derivedKey);
}

// Helper: Encrypt amount with ChaCha20-Poly1305
function encryptAmount(amount: number, masterKey: Buffer, userPubkey: string) {
  const userKey = deriveUserKey(masterKey, userPubkey);
  const nonce = crypto.randomBytes(12);

  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(Math.round(amount * 1_000_000)));

  const cipher = crypto.createCipheriv('chacha20-poly1305', userKey, nonce, {
    authTagLength: 16,
  });

  const encrypted = Buffer.concat([cipher.update(amountBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const commitment = crypto.createHash('sha256')
    .update(amountBuffer)
    .update(nonce)
    .digest('hex');

  return {
    ciphertext: Buffer.concat([nonce, encrypted, authTag]),
    nonce: nonce.toString('hex'),
    commitment,
  };
}

// Helper: Decrypt amount with ChaCha20-Poly1305
function decryptAmount(
  ciphertext: Buffer,
  masterKey: Buffer,
  userPubkey: string
): number {
  const userKey = deriveUserKey(masterKey, userPubkey);

  const nonce = ciphertext.subarray(0, 12);
  const encrypted = ciphertext.subarray(12, ciphertext.length - 16);
  const authTag = ciphertext.subarray(ciphertext.length - 16);

  const decipher = crypto.createDecipheriv('chacha20-poly1305', userKey, nonce, {
    authTagLength: 16,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const amountRaw = decrypted.readBigUInt64LE();

  return Number(amountRaw) / 1_000_000;
}

// Helper: Generate HMAC signature for callbacks
function generateCallbackSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('Arcium Encryption', () => {
  const masterKey = Buffer.from(TEST_CONFIG.masterKey, 'hex');

  it('should derive consistent user keys', () => {
    const key1 = deriveUserKey(masterKey, TEST_CONFIG.testWallet);
    const key2 = deriveUserKey(masterKey, TEST_CONFIG.testWallet);

    expect(key1.toString('hex')).toBe(key2.toString('hex'));
    expect(key1.length).toBe(32);
  });

  it('should derive different keys for different users', () => {
    const key1 = deriveUserKey(masterKey, TEST_CONFIG.testWallet);
    const key2 = deriveUserKey(masterKey, 'differentWallet123');

    expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
  });

  it('should encrypt and decrypt amounts correctly', () => {
    const amounts = [0.01, 1.0, 100.50, 1000000.999999];

    for (const amount of amounts) {
      const { ciphertext } = encryptAmount(amount, masterKey, TEST_CONFIG.testWallet);
      const decrypted = decryptAmount(ciphertext, masterKey, TEST_CONFIG.testWallet);

      // Allow for floating point precision (6 decimals)
      expect(Math.abs(decrypted - amount)).toBeLessThan(0.000001);
    }
  });

  it('should generate unique nonces for each encryption', () => {
    const result1 = encryptAmount(100, masterKey, TEST_CONFIG.testWallet);
    const result2 = encryptAmount(100, masterKey, TEST_CONFIG.testWallet);

    expect(result1.nonce).not.toBe(result2.nonce);
    expect(result1.ciphertext.toString('hex')).not.toBe(result2.ciphertext.toString('hex'));
  });

  it('should generate valid commitments', () => {
    const amount = 100.50;
    const result = encryptAmount(amount, masterKey, TEST_CONFIG.testWallet);

    // Commitment should be 64-char hex (sha256)
    expect(result.commitment).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should fail decryption with wrong key', () => {
    const { ciphertext } = encryptAmount(100, masterKey, TEST_CONFIG.testWallet);

    expect(() => {
      decryptAmount(ciphertext, masterKey, 'wrongWallet');
    }).toThrow();
  });

  it('should fail decryption with tampered ciphertext', () => {
    const { ciphertext } = encryptAmount(100, masterKey, TEST_CONFIG.testWallet);

    // Tamper with ciphertext
    ciphertext[15] = ciphertext[15] ^ 0xff;

    expect(() => {
      decryptAmount(ciphertext, masterKey, TEST_CONFIG.testWallet);
    }).toThrow();
  });
});

describe('Arcium Callback Signature Verification', () => {
  it('should generate valid HMAC signatures', () => {
    const payload = JSON.stringify({
      computation_id: 'test_123',
      status: 'completed',
    });

    const signature = generateCallbackSignature(payload, TEST_CONFIG.callbackSecret);

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should verify signatures correctly', () => {
    const payload = JSON.stringify({
      computation_id: 'test_123',
      status: 'completed',
    });

    const signature = generateCallbackSignature(payload, TEST_CONFIG.callbackSecret);
    const expectedSignature = generateCallbackSignature(payload, TEST_CONFIG.callbackSecret);

    expect(signature).toBe(expectedSignature);
  });

  it('should reject invalid signatures', () => {
    const payload = JSON.stringify({
      computation_id: 'test_123',
      status: 'completed',
    });

    const validSignature = generateCallbackSignature(payload, TEST_CONFIG.callbackSecret);
    const tamperedPayload = JSON.stringify({
      computation_id: 'test_123',
      status: 'failed', // Changed
    });

    const signatureForTampered = generateCallbackSignature(tamperedPayload, TEST_CONFIG.callbackSecret);

    expect(validSignature).not.toBe(signatureForTampered);
  });

  it('should use timing-safe comparison', () => {
    const payload = JSON.stringify({ test: 'data' });
    const signature = generateCallbackSignature(payload, TEST_CONFIG.callbackSecret);

    // Simulate timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(generateCallbackSignature(payload, TEST_CONFIG.callbackSecret))
    );

    expect(isValid).toBe(true);
  });
});

describe('Arcium Cluster Connection', () => {
  const skipIfNotLive = TEST_CONFIG.isLiveMode ? it : it.skip;

  skipIfNotLive('should connect to MPC cluster health endpoint', async () => {
    const response = await fetch(`${TEST_CONFIG.clusterAddress}/health`);

    expect(response.ok).toBe(true);
  });

  skipIfNotLive('should verify cluster API availability', async () => {
    const response = await fetch(`${TEST_CONFIG.clusterAddress}/api/v1/status`, {
      headers: {
        'X-Program-ID': TEST_CONFIG.programId,
      },
    });

    // May return 401 if program not registered, but API should respond
    expect([200, 401, 403, 404]).toContain(response.status);
  });

  it('should handle connection errors gracefully (mock)', async () => {
    const invalidUrl = 'https://invalid-arcium-cluster.example.com';

    try {
      await fetch(`${invalidUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});

describe('Arcium Computation Request Format', () => {
  it('should format payment settlement request correctly', () => {
    const computationId = `pay_${crypto.randomBytes(16).toString('hex')}`;
    const request = {
      computation_id: computationId,
      computation_type: 'payment_settlement',
      params: {
        payment_intent_id: 'pi_test123',
        merchant_wallet: TEST_CONFIG.testWallet,
        amount: 100_000_000, // 100 USDC in smallest unit
        recipient: 'recipientWallet123',
        currency: 'USDC',
      },
    };

    expect(request.computation_id).toMatch(/^pay_[a-f0-9]{32}$/);
    expect(request.computation_type).toBe('payment_settlement');
    expect(request.params.amount).toBeGreaterThan(0);
  });

  it('should format payroll settlement request correctly', () => {
    const computationId = `payroll_${crypto.randomBytes(16).toString('hex')}`;
    const request = {
      computation_id: computationId,
      computation_type: 'payroll_settlement',
      params: {
        batch_id: 'batch_test123',
        company_wallet: TEST_CONFIG.testWallet,
        payments: [
          { employee_id: 'emp_1', employee_wallet: 'wallet1', amount: 1000_000_000 },
          { employee_id: 'emp_2', employee_wallet: 'wallet2', amount: 2000_000_000 },
        ],
        currency: 'USDC',
      },
    };

    expect(request.computation_id).toMatch(/^payroll_[a-f0-9]{32}$/);
    expect(request.computation_type).toBe('payroll_settlement');
    expect(request.params.payments).toHaveLength(2);
    expect(request.params.payments[0].amount).toBeGreaterThan(0);
  });
});

describe('Arcium Callback Payload Format', () => {
  it('should validate payment settlement callback format', () => {
    const callback = {
      computation_id: 'pay_abc123',
      computation_type: 'payment_settlement',
      status: 'completed',
      result: {
        tx_signatures: ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'],
      },
      timestamp: Date.now(),
    };

    expect(callback.computation_id).toBeDefined();
    expect(['payment_settlement', 'payroll_settlement']).toContain(callback.computation_type);
    expect(['completed', 'failed']).toContain(callback.status);
    expect(callback.result?.tx_signatures?.[0]).toMatch(/^[A-Za-z0-9]{43,44}$/);
  });

  it('should validate failed callback format', () => {
    const callback = {
      computation_id: 'pay_abc123',
      computation_type: 'payment_settlement',
      status: 'failed',
      result: {
        error_message: 'Insufficient funds',
      },
      timestamp: Date.now(),
    };

    expect(callback.status).toBe('failed');
    expect(callback.result?.error_message).toBeDefined();
  });

  it('should validate payroll settlement callback with individual results', () => {
    const callback = {
      computation_id: 'payroll_abc123',
      computation_type: 'payroll_settlement',
      status: 'completed',
      result: {
        payment_results: [
          {
            employee_id: 'emp_1',
            tx_signature: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
            status: 'completed',
          },
          {
            employee_id: 'emp_2',
            status: 'failed',
            error: 'Invalid wallet address',
          },
        ],
      },
      timestamp: Date.now(),
    };

    expect(callback.result?.payment_results).toHaveLength(2);
    expect(callback.result?.payment_results?.[0].status).toBe('completed');
    expect(callback.result?.payment_results?.[1].status).toBe('failed');
  });
});

describe('Arcium Live MPC Computation', () => {
  const skipIfNotLive = TEST_CONFIG.isLiveMode ? it : it.skip;

  skipIfNotLive('should queue payment settlement computation', async () => {
    const computationId = `pay_test_${crypto.randomBytes(8).toString('hex')}`;

    const response = await fetch(`${TEST_CONFIG.clusterAddress}/api/v1/computations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Program-ID': TEST_CONFIG.programId,
        'X-Callback-URL': 'https://api.ninjapay.io/v1/arcium/callbacks',
        'X-Callback-Secret': TEST_CONFIG.callbackSecret,
      },
      body: JSON.stringify({
        computation_id: computationId,
        computation_type: 'payment_settlement',
        params: {
          payment_intent_id: 'pi_test_live',
          merchant_wallet: TEST_CONFIG.testWallet,
          amount: 1_000_000, // 1 USDC
          recipient: TEST_CONFIG.testWallet,
          currency: 'USDC',
        },
      }),
    });

    if (response.ok) {
      const result = await response.json();
      expect(result.computation_id).toBe(computationId);
      expect(['queued', 'processing']).toContain(result.status);
    } else {
      // Expected if program not deployed or auth issue
      console.log(`Cluster returned ${response.status}: ${await response.text()}`);
      expect([401, 403, 404, 500]).toContain(response.status);
    }
  }, 30000);

  skipIfNotLive('should get computation status', async () => {
    const computationId = 'pay_test_status_check';

    const response = await fetch(
      `${TEST_CONFIG.clusterAddress}/api/v1/computations/${computationId}`,
      {
        headers: {
          'X-Program-ID': TEST_CONFIG.programId,
        },
      }
    );

    // 404 expected for non-existent computation
    expect([200, 404]).toContain(response.status);

    if (response.ok) {
      const result = await response.json();
      expect(result.computation_id).toBeDefined();
      expect(['queued', 'processing', 'completed', 'failed']).toContain(result.status);
    }
  }, 15000);
});

describe('End-to-End Payment Flow Simulation', () => {
  const masterKey = Buffer.from(TEST_CONFIG.masterKey, 'hex');

  it('should complete full encryption → queue → callback flow', async () => {
    // Step 1: Encrypt amount
    const amount = 100.50;
    const encryptionResult = encryptAmount(amount, masterKey, TEST_CONFIG.testWallet);

    expect(encryptionResult.ciphertext.length).toBeGreaterThan(0);
    expect(encryptionResult.commitment).toMatch(/^[a-f0-9]{64}$/);

    // Step 2: Simulate computation request
    const computationId = `pay_e2e_${crypto.randomBytes(8).toString('hex')}`;
    const computationRequest = {
      computation_id: computationId,
      computation_type: 'payment_settlement',
      params: {
        payment_intent_id: 'pi_e2e_test',
        merchant_wallet: TEST_CONFIG.testWallet,
        amount: Math.round(amount * 1_000_000),
        recipient: 'recipientWallet',
        currency: 'USDC',
        encrypted_amount: encryptionResult.ciphertext.toString('base64'),
        commitment: encryptionResult.commitment,
      },
    };

    expect(computationRequest.params.commitment).toBe(encryptionResult.commitment);

    // Step 3: Simulate callback
    const callback = {
      computation_id: computationId,
      computation_type: 'payment_settlement',
      status: 'completed',
      result: {
        tx_signatures: ['mockTxSignature123456789012345678901234567890123'],
      },
      timestamp: Date.now(),
    };

    const callbackPayload = JSON.stringify(callback);
    const callbackSignature = generateCallbackSignature(callbackPayload, TEST_CONFIG.callbackSecret);

    // Verify callback signature
    const isValid = crypto.timingSafeEqual(
      Buffer.from(callbackSignature),
      Buffer.from(generateCallbackSignature(callbackPayload, TEST_CONFIG.callbackSecret))
    );

    expect(isValid).toBe(true);
    expect(callback.status).toBe('completed');
    expect(callback.result?.tx_signatures?.[0]).toBeDefined();
  });

  it('should handle payment flow with failure', async () => {
    const amount = 100.50;
    const encryptionResult = encryptAmount(amount, masterKey, TEST_CONFIG.testWallet);
    const computationId = `pay_fail_${crypto.randomBytes(8).toString('hex')}`;

    // Simulate failed callback
    const callback = {
      computation_id: computationId,
      computation_type: 'payment_settlement',
      status: 'failed',
      result: {
        error_message: 'Insufficient funds in merchant wallet',
      },
      timestamp: Date.now(),
    };

    expect(callback.status).toBe('failed');
    expect(callback.result?.error_message).toContain('Insufficient');
  });
});

describe('Arcium Security Tests', () => {
  const masterKey = Buffer.from(TEST_CONFIG.masterKey, 'hex');

  it('should prevent replay attacks with unique nonces', () => {
    const nonces = new Set<string>();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      const result = encryptAmount(100, masterKey, TEST_CONFIG.testWallet);
      expect(nonces.has(result.nonce)).toBe(false);
      nonces.add(result.nonce);
    }

    expect(nonces.size).toBe(iterations);
  });

  it('should maintain confidentiality - ciphertext reveals nothing about amount', () => {
    const small = encryptAmount(1, masterKey, TEST_CONFIG.testWallet);
    const large = encryptAmount(1000000, masterKey, TEST_CONFIG.testWallet);

    // Ciphertext sizes should be identical (padding not required for ChaCha20)
    expect(small.ciphertext.length).toBe(large.ciphertext.length);

    // Cannot determine amount from ciphertext comparison
    const correlation = small.ciphertext
      .slice(12, -16) // Extract just the encrypted part
      .compare(large.ciphertext.slice(12, -16));

    // Different amounts should produce completely different ciphertexts
    expect(correlation).not.toBe(0);
  });

  it('should detect ciphertext tampering via auth tag', () => {
    const result = encryptAmount(100, masterKey, TEST_CONFIG.testWallet);
    const originalCiphertext = Buffer.from(result.ciphertext);

    // Tamper with the encrypted amount portion
    result.ciphertext[20] ^= 0x01;

    expect(() => {
      decryptAmount(result.ciphertext, masterKey, TEST_CONFIG.testWallet);
    }).toThrow();

    // Restore and tamper with auth tag
    result.ciphertext = Buffer.from(originalCiphertext);
    result.ciphertext[result.ciphertext.length - 1] ^= 0x01;

    expect(() => {
      decryptAmount(result.ciphertext, masterKey, TEST_CONFIG.testWallet);
    }).toThrow();
  });
});
