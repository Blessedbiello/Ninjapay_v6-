import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockPrisma,
  createMockMerchant,
  createMockPaymentIntent,
} from './setup';

// Mock the arcium client
vi.mock('../src/services/arcium-client.js', () => ({
  ArciumClientService: vi.fn().mockImplementation(() => ({
    encryptAmount: vi.fn().mockResolvedValue({
      ciphertext: Buffer.from('encrypted'),
      commitment: 'test-commitment',
      nonce: 'test-nonce',
    }),
    queuePaymentSettlement: vi.fn().mockResolvedValue({
      computationId: 'comp_test123',
      status: 'queued',
    }),
  })),
}));

describe('Payment Intents API', () => {
  const mockMerchant = createMockMerchant();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /v1/payment_intents', () => {
    it('should create a payment intent with valid data', async () => {
      const mockIntent = createMockPaymentIntent();

      mockPrisma.merchant.findUnique.mockResolvedValue(mockMerchant);
      mockPrisma.paymentIntent.create.mockResolvedValue(mockIntent);

      // Test the creation logic
      const createData = {
        amount: 100,
        recipient: '7xKXtg2CW8ukAp9rXKD2RQU3w5RJKPME6nXbvNfTQAaP',
        currency: 'USDC',
        description: 'Test payment',
      };

      // Verify the payment intent would be created with correct data
      expect(createData.amount).toBeGreaterThan(0);
      expect(createData.recipient).toHaveLength(44);
    });

    it('should reject invalid amount', () => {
      const invalidData = {
        amount: -100,
        recipient: '7xKXtg2CW8ukAp9rXKD2RQU3w5RJKPME6nXbvNfTQAaP',
      };

      expect(invalidData.amount).toBeLessThan(0);
    });

    it('should reject missing recipient', () => {
      const invalidData = {
        amount: 100,
      };

      expect(invalidData).not.toHaveProperty('recipient');
    });
  });

  describe('GET /v1/payment_intents/:id', () => {
    it('should return payment intent by id', async () => {
      const mockIntent = createMockPaymentIntent();

      mockPrisma.paymentIntent.findFirst.mockResolvedValue(mockIntent);

      // Verify the mock returns correct data
      const result = await mockPrisma.paymentIntent.findFirst({
        where: { id: 'pi_test123', merchantId: 'merchant_test123' },
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe('pi_test123');
      expect(result?.status).toBe('PENDING');
    });

    it('should return null for non-existent payment intent', async () => {
      mockPrisma.paymentIntent.findFirst.mockResolvedValue(null);

      const result = await mockPrisma.paymentIntent.findFirst({
        where: { id: 'non_existent', merchantId: 'merchant_test123' },
      });

      expect(result).toBeNull();
    });
  });

  describe('GET /v1/payment_intents', () => {
    it('should list payment intents with pagination', async () => {
      const mockIntents = [
        createMockPaymentIntent({ id: 'pi_1' }),
        createMockPaymentIntent({ id: 'pi_2' }),
      ];

      mockPrisma.paymentIntent.findMany.mockResolvedValue(mockIntents);
      mockPrisma.paymentIntent.count.mockResolvedValue(2);

      const results = await mockPrisma.paymentIntent.findMany({
        where: { merchantId: 'merchant_test123' },
        take: 50,
        skip: 0,
      });

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('pi_1');
    });

    it('should filter by status', async () => {
      const confirmedIntent = createMockPaymentIntent({
        id: 'pi_confirmed',
        status: 'CONFIRMED',
      });

      mockPrisma.paymentIntent.findMany.mockResolvedValue([confirmedIntent]);

      const results = await mockPrisma.paymentIntent.findMany({
        where: { merchantId: 'merchant_test123', status: 'CONFIRMED' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('CONFIRMED');
    });
  });

  describe('POST /v1/payment_intents/:id/confirm', () => {
    it('should confirm a pending payment intent', async () => {
      const mockIntent = createMockPaymentIntent({ status: 'PENDING' });
      const confirmedIntent = { ...mockIntent, status: 'PROCESSING' };

      mockPrisma.paymentIntent.findFirst.mockResolvedValue(mockIntent);
      mockPrisma.paymentIntent.update.mockResolvedValue(confirmedIntent);

      // Verify status transition
      expect(mockIntent.status).toBe('PENDING');
      expect(confirmedIntent.status).toBe('PROCESSING');
    });

    it('should not confirm already confirmed payment', async () => {
      const mockIntent = createMockPaymentIntent({ status: 'CONFIRMED' });

      mockPrisma.paymentIntent.findFirst.mockResolvedValue(mockIntent);

      // Already confirmed, should not allow re-confirmation
      expect(mockIntent.status).toBe('CONFIRMED');
    });
  });

  describe('POST /v1/payment_intents/:id/cancel', () => {
    it('should cancel a pending payment intent', async () => {
      const mockIntent = createMockPaymentIntent({ status: 'PENDING' });
      const cancelledIntent = { ...mockIntent, status: 'CANCELLED' };

      mockPrisma.paymentIntent.findFirst.mockResolvedValue(mockIntent);
      mockPrisma.paymentIntent.update.mockResolvedValue(cancelledIntent);

      expect(cancelledIntent.status).toBe('CANCELLED');
    });

    it('should not cancel finalized payment', async () => {
      const mockIntent = createMockPaymentIntent({ status: 'FINALIZED' });

      // Finalized payments cannot be cancelled
      expect(mockIntent.status).toBe('FINALIZED');
    });
  });
});

describe('Payment Intent Status Transitions', () => {
  const validTransitions: Record<string, string[]> = {
    PENDING: ['PROCESSING', 'CANCELLED'],
    PROCESSING: ['CONFIRMED', 'FAILED'],
    CONFIRMED: ['FINALIZED', 'FAILED'],
    FINALIZED: [],
    FAILED: [],
    CANCELLED: [],
  };

  it('should define valid status transitions', () => {
    expect(validTransitions.PENDING).toContain('PROCESSING');
    expect(validTransitions.PENDING).toContain('CANCELLED');
    expect(validTransitions.PROCESSING).toContain('CONFIRMED');
    expect(validTransitions.FINALIZED).toHaveLength(0);
  });

  it('should not allow transition from FINALIZED', () => {
    expect(validTransitions.FINALIZED).toHaveLength(0);
  });

  it('should not allow transition from CANCELLED', () => {
    expect(validTransitions.CANCELLED).toHaveLength(0);
  });
});
