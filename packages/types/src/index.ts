// ===========================================
// NinjaPay v2 - Shared Type Definitions
// ===========================================

// ===========================================
// API Response Types
// ===========================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// ===========================================
// Payment Intent Types
// ===========================================

export interface CreatePaymentIntentRequest {
  amount: number;
  currency?: string;
  recipient: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentIntentResponse {
  id: string;
  merchantId: string;
  recipient: string;
  amountCommitment: string;
  encryptedAmount?: string; // Base64 encoded
  currency: string;
  status: PaymentStatus;
  description?: string;
  txSignature?: string;
  computationId?: string;
  computationStatus: ComputationStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'CONFIRMED'
  | 'FINALIZED'
  | 'FAILED'
  | 'CANCELLED';

export type ComputationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

// ===========================================
// Payment Link Types
// ===========================================

export interface CreatePaymentLinkRequest {
  name: string;
  amount?: number;
  currency?: string;
  maxUses?: number;
  expiresAt?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentLinkResponse {
  id: string;
  merchantId: string;
  url: string;
  name: string;
  amount?: number;
  currency: string;
  active: boolean;
  maxUses?: number;
  usageCount: number;
  expiresAt?: string;
  successUrl?: string;
  cancelUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// ===========================================
// Webhook Types
// ===========================================

export interface CreateWebhookRequest {
  url: string;
  events: WebhookEvent[];
  description?: string;
}

export interface WebhookResponse {
  id: string;
  merchantId: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  enabled: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type WebhookEvent =
  | 'payment.created'
  | 'payment.processing'
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'payroll.created'
  | 'payroll.processing'
  | 'payroll.completed'
  | 'payroll.failed';

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
  timestamp: string;
}

// ===========================================
// Payroll Types
// ===========================================

export interface CreateEmployeeRequest {
  walletAddress: string;
  name: string;
  email?: string;
  department?: string;
}

export interface EmployeeResponse {
  id: string;
  companyId: string;
  walletAddress: string;
  name: string;
  email?: string;
  department?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePayrollBatchRequest {
  scheduledDate?: string;
  payments: PayrollPaymentInput[];
  metadata?: Record<string, unknown>;
}

export interface PayrollPaymentInput {
  employeeId: string;
  amount: number;
}

export interface PayrollBatchResponse {
  id: string;
  companyId: string;
  status: PayrollStatus;
  employeeCount: number;
  processedCount: number;
  computationId?: string;
  scheduledDate?: string;
  executedDate?: string;
  errorMessage?: string;
  payments?: PayrollPaymentResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface PayrollPaymentResponse {
  id: string;
  employeeId: string;
  amountCommitment: string;
  txSignature?: string;
  status: PayrollStatus;
  errorMessage?: string;
  employee?: {
    name: string;
    walletAddress: string;
  };
}

export type PayrollStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

// ===========================================
// Arcium Types
// ===========================================

export interface ArciumEncryptionResult {
  ciphertext: Buffer;
  commitment: string;
  nonce: Buffer;
  publicKey: Buffer;
}

export interface ArciumComputationRequest {
  computationType: string;
  encryptedInputs: string[];
  userPubkey: string;
  callbackUrl: string;
  entityType: 'payment_intent' | 'payroll_batch';
  referenceId: string;
  metadata?: Record<string, unknown>;
}

export interface ArciumComputationResult {
  computationId: string;
  status: ComputationStatus;
  result?: string;
  error?: string;
  signature?: string;
}

export interface ArciumCallbackPayload {
  computationId: string;
  status: ComputationStatus;
  entityType: 'payment_intent' | 'payroll_batch';
  referenceId: string;
  result?: string;
  error?: string;
  signature?: string;
  timestamp: string;
}

// ===========================================
// Merchant Types
// ===========================================

export interface MerchantResponse {
  id: string;
  walletAddress: string;
  businessName: string;
  email: string;
  kycStatus: KYCStatus;
  createdAt: string;
  updatedAt: string;
}

export type KYCStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface CreateApiKeyRequest {
  name: string;
  permissions?: string[];
  expiresAt?: string;
}

export interface ApiKeyResponse {
  id: string;
  merchantId: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  active: boolean;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
  // Note: The actual key is only returned once on creation
  key?: string;
}

// ===========================================
// Company Types
// ===========================================

export interface CompanyResponse {
  id: string;
  walletAddress: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}
