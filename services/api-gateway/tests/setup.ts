import { beforeAll, afterAll, beforeEach } from 'vitest';

// Test environment setup
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ARCIUM_PROGRAM_ID = 'test-program-id';
process.env.API_PORT = '8099';

// Mock Prisma
export const mockPrisma = {
  merchant: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  apiKey: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  paymentIntent: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  paymentLink: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  webhook: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  webhookDelivery: {
    create: vi.fn(),
    update: vi.fn(),
  },
  company: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  employee: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  payrollBatch: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  payrollPayment: {
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn((fn) => fn(mockPrisma)),
};

// Mock the database module
vi.mock('@ninjapay/database', () => ({
  prisma: mockPrisma,
}));

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Test utilities
export function createMockMerchant(overrides = {}) {
  return {
    id: 'merchant_test123',
    walletAddress: '7xKXtg2CW8ukAp9rXKD2RQU3w5RJKPME6nXbvNfTQAaP',
    businessName: 'Test Merchant',
    email: 'test@merchant.com',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockApiKey(overrides = {}) {
  return {
    id: 'apikey_test123',
    merchantId: 'merchant_test123',
    keyHash: '$2b$12$test.hash.value',
    keyPrefix: 'sk_live_',
    name: 'Test Key',
    permissions: ['read', 'write'],
    active: true,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function createMockPaymentIntent(overrides = {}) {
  return {
    id: 'pi_test123',
    merchantId: 'merchant_test123',
    recipient: '7xKXtg2CW8ukAp9rXKD2RQU3w5RJKPME6nXbvNfTQAaP',
    encryptedAmount: Buffer.from('encrypted'),
    amountCommitment: 'commitment123',
    currency: 'USDC',
    status: 'PENDING',
    description: 'Test payment',
    txSignature: null,
    computationId: null,
    computationStatus: 'QUEUED',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockPaymentLink(overrides = {}) {
  return {
    id: 'link_test123',
    merchantId: 'merchant_test123',
    url: 'https://pay.ninjapay.io/abc123',
    name: 'Test Link',
    amount: 100,
    currency: 'USDC',
    active: true,
    maxUses: null,
    usageCount: 0,
    expiresAt: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockWebhook(overrides = {}) {
  return {
    id: 'webhook_test123',
    merchantId: 'merchant_test123',
    url: 'https://example.com/webhook',
    events: ['payment_intent.confirmed'],
    secret: 'whsec_testsecret123',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Import vi for mocking
import { vi } from 'vitest';
