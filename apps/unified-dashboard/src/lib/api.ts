/**
 * API Client for NinjaPay Dashboard
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, any>;
  token?: string;
}

class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(
      data.error?.message || 'API request failed',
      response.status,
      data.error?.code || 'UNKNOWN_ERROR'
    );
  }

  return data;
}

// Auth API
export const authApi = {
  requestNonce: (walletAddress: string, type: 'merchant' | 'company' = 'merchant') =>
    api<{
      success: boolean;
      data: { nonce: string; message: string; expiresIn: number };
    }>('/v1/auth/nonce', {
      method: 'POST',
      body: { walletAddress, type },
    }),

  verify: (walletAddress: string, signature: string, type: 'merchant' | 'company' = 'merchant') =>
    api<{
      success: boolean;
      data: { token: string; expiresIn: number; entityId: string; type: string };
    }>('/v1/auth/verify', {
      method: 'POST',
      body: { walletAddress, signature, type },
    }),
};

// Payment Intents API
export const paymentIntentsApi = {
  list: (token: string, params?: { status?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return api<any>(`/v1/payment_intents?${query}`, { token });
  },

  get: (token: string, id: string) =>
    api<any>(`/v1/payment_intents/${id}`, { token }),

  create: (token: string, data: { amount: number; recipient: string; description?: string }) =>
    api<any>('/v1/payment_intents', { method: 'POST', body: data, token }),

  confirm: (token: string, id: string) =>
    api<any>(`/v1/payment_intents/${id}/confirm`, { method: 'POST', token }),

  cancel: (token: string, id: string) =>
    api<any>(`/v1/payment_intents/${id}/cancel`, { method: 'POST', token }),
};

// Payment Links API
export const paymentLinksApi = {
  list: (token: string, params?: { active?: boolean; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.active !== undefined) query.set('active', params.active.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return api<any>(`/v1/payment_links?${query}`, { token });
  },

  get: (token: string, id: string) =>
    api<any>(`/v1/payment_links/${id}`, { token }),

  create: (token: string, data: { name: string; amount?: number; currency?: string }) =>
    api<any>('/v1/payment_links', { method: 'POST', body: data, token }),

  update: (token: string, id: string, data: { name?: string; active?: boolean }) =>
    api<any>(`/v1/payment_links/${id}`, { method: 'PATCH', body: data, token }),

  delete: (token: string, id: string) =>
    api<any>(`/v1/payment_links/${id}`, { method: 'DELETE', token }),
};

// Webhooks API
export const webhooksApi = {
  list: (token: string, params?: { enabled?: boolean; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.enabled !== undefined) query.set('enabled', params.enabled.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return api<any>(`/v1/webhooks?${query}`, { token });
  },

  create: (token: string, data: { url: string; events: string[] }) =>
    api<any>('/v1/webhooks', { method: 'POST', body: data, token }),

  delete: (token: string, id: string) =>
    api<any>(`/v1/webhooks/${id}`, { method: 'DELETE', token }),

  rotateSecret: (token: string, id: string) =>
    api<any>(`/v1/webhooks/${id}/rotate-secret`, { method: 'POST', token }),
};

// API Keys API
export const apiKeysApi = {
  list: (token: string, params?: { active?: boolean; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.active !== undefined) query.set('active', params.active.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return api<any>(`/v1/api_keys?${query}`, { token });
  },

  create: (token: string, data: { name: string }) =>
    api<any>('/v1/api_keys', { method: 'POST', body: data, token }),

  revoke: (token: string, id: string) =>
    api<any>(`/v1/api_keys/${id}`, { method: 'DELETE', token }),

  roll: (token: string, id: string) =>
    api<any>(`/v1/api_keys/${id}/roll`, { method: 'POST', token }),
};

// Payroll API
export const payrollApi = {
  // Employees
  listEmployees: (token: string, params?: { active?: boolean; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.active !== undefined) query.set('active', params.active.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return api<any>(`/v1/payroll/employees?${query}`, { token });
  },

  addEmployee: (token: string, data: { name: string; email: string; walletAddress: string }) =>
    api<any>('/v1/payroll/employees', { method: 'POST', body: data, token }),

  updateEmployee: (token: string, id: string, data: { name?: string; email?: string; active?: boolean }) =>
    api<any>(`/v1/payroll/employees/${id}`, { method: 'PATCH', body: data, token }),

  deleteEmployee: (token: string, id: string) =>
    api<any>(`/v1/payroll/employees/${id}`, { method: 'DELETE', token }),

  // Batches
  listBatches: (token: string, params?: { status?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return api<any>(`/v1/payroll/batches?${query}`, { token });
  },

  getBatch: (token: string, id: string) =>
    api<any>(`/v1/payroll/batches/${id}`, { token }),

  createBatch: (token: string, data: { payments: Array<{ employeeId: string; amount: number }>; currency?: string }) =>
    api<any>('/v1/payroll/batches', { method: 'POST', body: data, token }),

  executeBatch: (token: string, id: string) =>
    api<any>(`/v1/payroll/batches/${id}/execute`, { method: 'POST', token }),

  settleBatch: (token: string, id: string) =>
    api<any>(`/v1/payroll/batches/${id}/settle`, { method: 'POST', token }),

  cancelBatch: (token: string, id: string) =>
    api<any>(`/v1/payroll/batches/${id}/cancel`, { method: 'POST', token }),

  getBalance: (token: string) =>
    api<any>('/v1/payroll/balance', { token }),
};

export { ApiError };
