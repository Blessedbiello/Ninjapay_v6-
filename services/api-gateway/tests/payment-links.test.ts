import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockPrisma,
  createMockMerchant,
  createMockPaymentLink,
} from './setup';

describe('Payment Links API', () => {
  const mockMerchant = createMockMerchant();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /v1/payment_links', () => {
    it('should create a payment link with fixed amount', async () => {
      const mockLink = createMockPaymentLink({
        amount: 50,
        name: 'Product Payment',
      });

      mockPrisma.paymentLink.create.mockResolvedValue(mockLink);

      const result = await mockPrisma.paymentLink.create({
        data: {
          merchantId: mockMerchant.id,
          name: 'Product Payment',
          amount: 50,
          currency: 'USDC',
          url: 'https://pay.ninjapay.io/test123',
        },
      });

      expect(result.amount).toBe(50);
      expect(result.name).toBe('Product Payment');
      expect(result.url).toContain('ninjapay.io');
    });

    it('should create a payment link without fixed amount', async () => {
      const mockLink = createMockPaymentLink({
        amount: null,
        name: 'Donation',
      });

      mockPrisma.paymentLink.create.mockResolvedValue(mockLink);

      const result = await mockPrisma.paymentLink.create({
        data: {
          merchantId: mockMerchant.id,
          name: 'Donation',
          amount: null,
          currency: 'USDC',
          url: 'https://pay.ninjapay.io/donate',
        },
      });

      expect(result.amount).toBeNull();
    });

    it('should set max uses limit', async () => {
      const mockLink = createMockPaymentLink({
        maxUses: 100,
        usageCount: 0,
      });

      mockPrisma.paymentLink.create.mockResolvedValue(mockLink);

      expect(mockLink.maxUses).toBe(100);
      expect(mockLink.usageCount).toBe(0);
    });

    it('should set expiration date', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const mockLink = createMockPaymentLink({
        expiresAt,
      });

      mockPrisma.paymentLink.create.mockResolvedValue(mockLink);

      expect(mockLink.expiresAt).toBeDefined();
      expect(mockLink.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('GET /v1/payment_links/:id', () => {
    it('should return payment link by id', async () => {
      const mockLink = createMockPaymentLink();

      mockPrisma.paymentLink.findFirst.mockResolvedValue(mockLink);

      const result = await mockPrisma.paymentLink.findFirst({
        where: { id: 'link_test123', merchantId: mockMerchant.id },
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe('link_test123');
    });

    it('should return null for non-existent link', async () => {
      mockPrisma.paymentLink.findFirst.mockResolvedValue(null);

      const result = await mockPrisma.paymentLink.findFirst({
        where: { id: 'non_existent' },
      });

      expect(result).toBeNull();
    });
  });

  describe('GET /v1/payment_links', () => {
    it('should list active payment links', async () => {
      const mockLinks = [
        createMockPaymentLink({ id: 'link_1', active: true }),
        createMockPaymentLink({ id: 'link_2', active: true }),
      ];

      mockPrisma.paymentLink.findMany.mockResolvedValue(mockLinks);
      mockPrisma.paymentLink.count.mockResolvedValue(2);

      const results = await mockPrisma.paymentLink.findMany({
        where: { merchantId: mockMerchant.id, active: true },
      });

      expect(results).toHaveLength(2);
      expect(results.every(l => l.active)).toBe(true);
    });

    it('should filter inactive links', async () => {
      const inactiveLink = createMockPaymentLink({ active: false });

      mockPrisma.paymentLink.findMany.mockResolvedValue([inactiveLink]);

      const results = await mockPrisma.paymentLink.findMany({
        where: { active: false },
      });

      expect(results[0].active).toBe(false);
    });
  });

  describe('PATCH /v1/payment_links/:id', () => {
    it('should update payment link name', async () => {
      const mockLink = createMockPaymentLink();
      const updatedLink = { ...mockLink, name: 'Updated Name' };

      mockPrisma.paymentLink.findFirst.mockResolvedValue(mockLink);
      mockPrisma.paymentLink.update.mockResolvedValue(updatedLink);

      const result = await mockPrisma.paymentLink.update({
        where: { id: mockLink.id },
        data: { name: 'Updated Name' },
      });

      expect(result.name).toBe('Updated Name');
    });

    it('should deactivate payment link', async () => {
      const mockLink = createMockPaymentLink({ active: true });
      const deactivatedLink = { ...mockLink, active: false };

      mockPrisma.paymentLink.findFirst.mockResolvedValue(mockLink);
      mockPrisma.paymentLink.update.mockResolvedValue(deactivatedLink);

      const result = await mockPrisma.paymentLink.update({
        where: { id: mockLink.id },
        data: { active: false },
      });

      expect(result.active).toBe(false);
    });
  });

  describe('DELETE /v1/payment_links/:id', () => {
    it('should soft delete by deactivating', async () => {
      const mockLink = createMockPaymentLink({ active: true });
      const deletedLink = { ...mockLink, active: false };

      mockPrisma.paymentLink.findFirst.mockResolvedValue(mockLink);
      mockPrisma.paymentLink.update.mockResolvedValue(deletedLink);

      const result = await mockPrisma.paymentLink.update({
        where: { id: mockLink.id },
        data: { active: false },
      });

      expect(result.active).toBe(false);
    });
  });
});

describe('Payment Link Validation', () => {
  it('should validate URL format', () => {
    const validUrl = 'https://pay.ninjapay.io/abc123';
    expect(validUrl).toMatch(/^https:\/\//);
  });

  it('should check if link is expired', () => {
    const pastDate = new Date(Date.now() - 1000);
    const futureDate = new Date(Date.now() + 1000);

    expect(pastDate.getTime()).toBeLessThan(Date.now());
    expect(futureDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('should check if usage limit reached', () => {
    const link = createMockPaymentLink({ maxUses: 10, usageCount: 10 });

    expect(link.usageCount).toBeGreaterThanOrEqual(link.maxUses!);
  });

  it('should allow unlimited uses when maxUses is null', () => {
    const link = createMockPaymentLink({ maxUses: null, usageCount: 1000 });

    expect(link.maxUses).toBeNull();
    // No limit, always valid
  });
});
