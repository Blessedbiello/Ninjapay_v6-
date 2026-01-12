/**
 * NinjaPay SDK
 * Official client library for NinjaPay API
 */

export interface NinjaPayConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface PaymentIntent {
  id: string;
  merchant_id: string;
  recipient: string;
  amount_commitment: string;
  encrypted_amount?: string;
  currency: string;
  status: string;
  description?: string;
  tx_signature?: string;
  computation_id?: string;
  computation_status?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface PaymentLink {
  id: string;
  merchant_id: string;
  url: string;
  name: string;
  amount?: number;
  currency: string;
  active: boolean;
  max_uses?: number;
  usage_count: number;
  expires_at?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Webhook {
  id: string;
  merchant_id: string;
  url: string;
  events: string[];
  enabled: boolean;
  secret?: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  merchant_id: string;
  name: string;
  key_prefix: string;
  key?: string;
  permissions: string[];
  active: boolean;
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  timestamp: number;
}

export interface SingleResponse<T> {
  success: boolean;
  data: T;
  timestamp: number;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, any>;
  query?: Record<string, any>;
}

class NinjaPayError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'NinjaPayError';
    this.code = code;
    this.status = status;
  }
}

/**
 * NinjaPay API Client
 */
export class NinjaPay {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  readonly paymentIntents: PaymentIntentsResource;
  readonly paymentLinks: PaymentLinksResource;
  readonly webhooks: WebhooksResource;
  readonly apiKeys: ApiKeysResource;

  constructor(config: NinjaPayConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.ninjapay.io';
    this.timeout = config.timeout || 30000;

    // Initialize resources
    this.paymentIntents = new PaymentIntentsResource(this);
    this.paymentLinks = new PaymentLinksResource(this);
    this.webhooks = new WebhooksResource(this);
    this.apiKeys = new ApiKeysResource(this);
  }

  /**
   * Make an API request
   */
  async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${options.path}`);

    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new NinjaPayError(
          data.error?.message || 'API request failed',
          data.error?.code || 'UNKNOWN_ERROR',
          response.status
        );
      }

      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new NinjaPayError('Request timeout', 'TIMEOUT', 408);
      }

      if (error instanceof NinjaPayError) {
        throw error;
      }

      throw new NinjaPayError(
        error.message || 'Network error',
        'NETWORK_ERROR',
        0
      );
    }
  }
}

/**
 * Payment Intents Resource
 */
class PaymentIntentsResource {
  constructor(private client: NinjaPay) {}

  /**
   * Create a new payment intent
   */
  async create(params: {
    amount: number;
    recipient: string;
    currency?: string;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<SingleResponse<PaymentIntent>> {
    return this.client.request({
      method: 'POST',
      path: '/v1/payment_intents',
      body: params,
    });
  }

  /**
   * Retrieve a payment intent
   */
  async retrieve(id: string): Promise<SingleResponse<PaymentIntent>> {
    return this.client.request({
      method: 'GET',
      path: `/v1/payment_intents/${id}`,
    });
  }

  /**
   * List payment intents
   */
  async list(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<PaymentIntent>> {
    return this.client.request({
      method: 'GET',
      path: '/v1/payment_intents',
      query: params,
    });
  }

  /**
   * Update a payment intent
   */
  async update(
    id: string,
    params: {
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<SingleResponse<PaymentIntent>> {
    return this.client.request({
      method: 'PATCH',
      path: `/v1/payment_intents/${id}`,
      body: params,
    });
  }

  /**
   * Confirm a payment intent
   */
  async confirm(id: string): Promise<SingleResponse<PaymentIntent>> {
    return this.client.request({
      method: 'POST',
      path: `/v1/payment_intents/${id}/confirm`,
    });
  }

  /**
   * Cancel a payment intent
   */
  async cancel(id: string): Promise<SingleResponse<PaymentIntent>> {
    return this.client.request({
      method: 'POST',
      path: `/v1/payment_intents/${id}/cancel`,
    });
  }
}

/**
 * Payment Links Resource
 */
class PaymentLinksResource {
  constructor(private client: NinjaPay) {}

  /**
   * Create a new payment link
   */
  async create(params: {
    name: string;
    amount?: number;
    currency?: string;
    maxUses?: number;
    expiresAt?: string;
    metadata?: Record<string, any>;
  }): Promise<SingleResponse<PaymentLink>> {
    return this.client.request({
      method: 'POST',
      path: '/v1/payment_links',
      body: params,
    });
  }

  /**
   * Retrieve a payment link
   */
  async retrieve(id: string): Promise<SingleResponse<PaymentLink>> {
    return this.client.request({
      method: 'GET',
      path: `/v1/payment_links/${id}`,
    });
  }

  /**
   * List payment links
   */
  async list(params?: {
    active?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<PaymentLink>> {
    return this.client.request({
      method: 'GET',
      path: '/v1/payment_links',
      query: params ? { ...params, active: params.active?.toString() } : undefined,
    });
  }

  /**
   * Update a payment link
   */
  async update(
    id: string,
    params: {
      name?: string;
      active?: boolean;
      maxUses?: number;
      expiresAt?: string | null;
    }
  ): Promise<SingleResponse<PaymentLink>> {
    return this.client.request({
      method: 'PATCH',
      path: `/v1/payment_links/${id}`,
      body: params,
    });
  }

  /**
   * Delete (deactivate) a payment link
   */
  async delete(id: string): Promise<SingleResponse<{ id: string; deleted: boolean }>> {
    return this.client.request({
      method: 'DELETE',
      path: `/v1/payment_links/${id}`,
    });
  }
}

/**
 * Webhooks Resource
 */
class WebhooksResource {
  constructor(private client: NinjaPay) {}

  /**
   * Create a new webhook endpoint
   */
  async create(params: {
    url: string;
    events: string[];
    enabled?: boolean;
  }): Promise<SingleResponse<Webhook>> {
    return this.client.request({
      method: 'POST',
      path: '/v1/webhooks',
      body: params,
    });
  }

  /**
   * Retrieve a webhook
   */
  async retrieve(id: string): Promise<SingleResponse<Webhook>> {
    return this.client.request({
      method: 'GET',
      path: `/v1/webhooks/${id}`,
    });
  }

  /**
   * List webhooks
   */
  async list(params?: {
    enabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Webhook>> {
    return this.client.request({
      method: 'GET',
      path: '/v1/webhooks',
      query: params ? { ...params, enabled: params.enabled?.toString() } : undefined,
    });
  }

  /**
   * Update a webhook
   */
  async update(
    id: string,
    params: {
      url?: string;
      events?: string[];
      enabled?: boolean;
    }
  ): Promise<SingleResponse<Webhook>> {
    return this.client.request({
      method: 'PATCH',
      path: `/v1/webhooks/${id}`,
      body: params,
    });
  }

  /**
   * Delete a webhook
   */
  async delete(id: string): Promise<SingleResponse<{ id: string; deleted: boolean }>> {
    return this.client.request({
      method: 'DELETE',
      path: `/v1/webhooks/${id}`,
    });
  }

  /**
   * Rotate webhook secret
   */
  async rotateSecret(id: string): Promise<SingleResponse<Webhook>> {
    return this.client.request({
      method: 'POST',
      path: `/v1/webhooks/${id}/rotate-secret`,
    });
  }
}

/**
 * API Keys Resource
 */
class ApiKeysResource {
  constructor(private client: NinjaPay) {}

  /**
   * Create a new API key
   */
  async create(params: {
    name: string;
    permissions?: string[];
    expiresAt?: string;
  }): Promise<SingleResponse<ApiKey>> {
    return this.client.request({
      method: 'POST',
      path: '/v1/api_keys',
      body: params,
    });
  }

  /**
   * Retrieve an API key
   */
  async retrieve(id: string): Promise<SingleResponse<ApiKey>> {
    return this.client.request({
      method: 'GET',
      path: `/v1/api_keys/${id}`,
    });
  }

  /**
   * List API keys
   */
  async list(params?: {
    active?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<ApiKey>> {
    return this.client.request({
      method: 'GET',
      path: '/v1/api_keys',
      query: params ? { ...params, active: params.active?.toString() } : undefined,
    });
  }

  /**
   * Update an API key
   */
  async update(
    id: string,
    params: {
      name?: string;
      permissions?: string[];
      active?: boolean;
    }
  ): Promise<SingleResponse<ApiKey>> {
    return this.client.request({
      method: 'PATCH',
      path: `/v1/api_keys/${id}`,
      body: params,
    });
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string): Promise<SingleResponse<{ id: string; revoked: boolean }>> {
    return this.client.request({
      method: 'DELETE',
      path: `/v1/api_keys/${id}`,
    });
  }

  /**
   * Roll (regenerate) an API key
   */
  async roll(id: string): Promise<SingleResponse<ApiKey>> {
    return this.client.request({
      method: 'POST',
      path: `/v1/api_keys/${id}/roll`,
    });
  }
}

// Export error class
export { NinjaPayError };

// Default export
export default NinjaPay;
