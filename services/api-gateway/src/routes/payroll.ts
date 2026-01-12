import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@ninjapay/database';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { authenticateCompany } from '../middleware/authenticate.js';
import { ArciumClientService } from '../services/arcium-client.js';
import { getSettlementService } from '../services/settlement.js';
import { createLogger } from '@ninjapay/logger';

const router = Router();
const logger = createLogger('payroll');

let arciumClient: ArciumClientService | null = null;
function getArciumClient(): ArciumClientService {
  if (!arciumClient) {
    arciumClient = new ArciumClientService();
  }
  return arciumClient;
}

// Employee schemas
const addEmployeeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

const updateEmployeeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  active: z.boolean().optional(),
});

const listEmployeesSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// Batch schemas
const createBatchSchema = z.object({
  payments: z.array(z.object({
    employeeId: z.string(),
    amount: z.number().positive(),
  })).min(1).max(200),
  currency: z.string().default('USDC'),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const listBatchesSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function serializeEmployee(emp: any) {
  return {
    id: emp.id,
    company_id: emp.companyId,
    wallet_address: emp.walletAddress,
    name: emp.name,
    email: emp.email,
    active: emp.active,
    created_at: emp.createdAt,
    updated_at: emp.updatedAt,
  };
}

function serializeBatch(batch: any, payments?: any[]) {
  return {
    id: batch.id,
    company_id: batch.companyId,
    status: batch.status.toLowerCase(),
    employee_count: batch.employeeCount,
    total_amount: batch.totalAmount,
    currency: batch.currency,
    computation_id: batch.computationId,
    description: batch.description,
    metadata: batch.metadata,
    payments: payments?.map(p => ({
      id: p.id,
      employee_id: p.employeeId,
      amount_commitment: p.amountCommitment,
      status: p.status.toLowerCase(),
      tx_signature: p.txSignature,
    })),
    created_at: batch.createdAt,
    updated_at: batch.updatedAt,
  };
}

// ============ EMPLOYEE ROUTES ============

/**
 * POST /v1/payroll/employees - Add employee
 */
router.post('/employees', authenticateCompany, asyncHandler(async (req, res) => {
  const body = addEmployeeSchema.parse(req.body);
  const companyId = req.companyId!;

  // Check if employee already exists
  const existing = await prisma.employee.findFirst({
    where: {
      companyId,
      walletAddress: body.walletAddress,
    },
  });

  if (existing) {
    throw new AppError('Employee with this wallet already exists', 400, 'EMPLOYEE_EXISTS');
  }

  const employee = await prisma.employee.create({
    data: {
      companyId,
      walletAddress: body.walletAddress,
      name: body.name,
      email: body.email,
    },
  });

  logger.info('Employee added', { employeeId: employee.id, companyId });

  res.status(201).json({
    success: true,
    data: serializeEmployee(employee),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payroll/employees - List employees
 */
router.get('/employees', authenticateCompany, asyncHandler(async (req, res) => {
  const query = listEmployeesSchema.parse(req.query);
  const companyId = req.companyId!;

  const where: any = { companyId };
  if (query.active !== undefined) {
    where.active = query.active === 'true';
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      orderBy: { name: 'asc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.employee.count({ where }),
  ]);

  res.json({
    success: true,
    data: employees.map(serializeEmployee),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      has_more: query.offset + employees.length < total,
    },
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payroll/employees/:id - Get employee
 */
router.get('/employees/:id', authenticateCompany, asyncHandler(async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: {
      id: req.params.id,
      companyId: req.companyId!,
    },
  });

  if (!employee) {
    throw new AppError('Employee not found', 404, 'EMPLOYEE_NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializeEmployee(employee),
    timestamp: Date.now(),
  });
}));

/**
 * PATCH /v1/payroll/employees/:id - Update employee
 */
router.patch('/employees/:id', authenticateCompany, asyncHandler(async (req, res) => {
  const body = updateEmployeeSchema.parse(req.body);

  const employee = await prisma.employee.findFirst({
    where: {
      id: req.params.id,
      companyId: req.companyId!,
    },
  });

  if (!employee) {
    throw new AppError('Employee not found', 404, 'EMPLOYEE_NOT_FOUND');
  }

  const updated = await prisma.employee.update({
    where: { id: employee.id },
    data: {
      name: body.name,
      email: body.email,
      active: body.active,
    },
  });

  logger.info('Employee updated', { employeeId: employee.id });

  res.json({
    success: true,
    data: serializeEmployee(updated),
    timestamp: Date.now(),
  });
}));

/**
 * DELETE /v1/payroll/employees/:id - Deactivate employee
 */
router.delete('/employees/:id', authenticateCompany, asyncHandler(async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: {
      id: req.params.id,
      companyId: req.companyId!,
    },
  });

  if (!employee) {
    throw new AppError('Employee not found', 404, 'EMPLOYEE_NOT_FOUND');
  }

  await prisma.employee.update({
    where: { id: employee.id },
    data: { active: false },
  });

  logger.info('Employee deactivated', { employeeId: employee.id });

  res.json({
    success: true,
    data: { id: employee.id, deactivated: true },
    timestamp: Date.now(),
  });
}));

// ============ BATCH ROUTES ============

/**
 * POST /v1/payroll/batches - Create payroll batch
 */
router.post('/batches', authenticateCompany, asyncHandler(async (req, res) => {
  const body = createBatchSchema.parse(req.body);
  const companyId = req.companyId!;

  // Get company wallet
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { walletAddress: true },
  });

  if (!company) {
    throw new AppError('Company not found', 404, 'COMPANY_NOT_FOUND');
  }

  // Verify all employees exist and are active
  const employeeIds = body.payments.map(p => p.employeeId);
  const employees = await prisma.employee.findMany({
    where: {
      id: { in: employeeIds },
      companyId,
      active: true,
    },
  });

  if (employees.length !== employeeIds.length) {
    throw new AppError('Some employees not found or inactive', 400, 'INVALID_EMPLOYEES');
  }

  const employeeMap = new Map(employees.map(e => [e.id, e]));
  const arcium = getArciumClient();

  // Calculate total amount
  const totalAmount = body.payments.reduce((sum, p) => sum + p.amount, 0);

  // Create batch
  const batch = await prisma.payrollBatch.create({
    data: {
      companyId,
      status: 'PENDING',
      employeeCount: body.payments.length,
      totalAmount,
      currency: body.currency,
      description: body.description,
      metadata: body.metadata || {},
    },
  });

  // Create encrypted payments
  const payrollPayments = await Promise.all(
    body.payments.map(async (payment) => {
      const employee = employeeMap.get(payment.employeeId)!;

      // Encrypt amount
      const encryptionResult = await arcium.encryptAmount(payment.amount, {
        userPubkey: employee.walletAddress,
        metadata: {
          batchId: batch.id,
          employeeId: payment.employeeId,
        },
      });

      return prisma.payrollPayment.create({
        data: {
          batchId: batch.id,
          employeeId: payment.employeeId,
          encryptedAmount: encryptionResult.ciphertext,
          amountCommitment: encryptionResult.commitment,
          status: 'PENDING',
        },
      });
    })
  );

  logger.info('Payroll batch created', {
    batchId: batch.id,
    companyId,
    employeeCount: body.payments.length,
    totalAmount,
  });

  res.status(201).json({
    success: true,
    data: serializeBatch(batch, payrollPayments),
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payroll/batches - List batches
 */
router.get('/batches', authenticateCompany, asyncHandler(async (req, res) => {
  const query = listBatchesSchema.parse(req.query);
  const companyId = req.companyId!;

  const where: any = { companyId };
  if (query.status) {
    where.status = query.status;
  }

  const [batches, total] = await Promise.all([
    prisma.payrollBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.payrollBatch.count({ where }),
  ]);

  res.json({
    success: true,
    data: batches.map(b => serializeBatch(b)),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      has_more: query.offset + batches.length < total,
    },
    timestamp: Date.now(),
  });
}));

/**
 * GET /v1/payroll/batches/:id - Get batch status
 */
router.get('/batches/:id', authenticateCompany, asyncHandler(async (req, res) => {
  const batch = await prisma.payrollBatch.findFirst({
    where: {
      id: req.params.id,
      companyId: req.companyId!,
    },
    include: {
      payments: {
        include: {
          employee: {
            select: { id: true, name: true, walletAddress: true },
          },
        },
      },
    },
  });

  if (!batch) {
    throw new AppError('Batch not found', 404, 'BATCH_NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializeBatch(batch, batch.payments),
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/payroll/batches/:id/execute - Execute payroll batch
 */
router.post('/batches/:id/execute', authenticateCompany, asyncHandler(async (req, res) => {
  const batch = await prisma.payrollBatch.findFirst({
    where: {
      id: req.params.id,
      companyId: req.companyId!,
    },
    include: {
      payments: {
        include: {
          employee: {
            select: { id: true, walletAddress: true },
          },
        },
      },
    },
  });

  if (!batch) {
    throw new AppError('Batch not found', 404, 'BATCH_NOT_FOUND');
  }

  if (batch.status !== 'PENDING') {
    throw new AppError(`Cannot execute batch in status: ${batch.status}`, 400, 'INVALID_STATUS');
  }

  // Get company wallet
  const company = await prisma.company.findUnique({
    where: { id: req.companyId! },
    select: { walletAddress: true },
  });

  // Queue settlement to Arcium
  const arcium = getArciumClient();
  const metadata = batch.metadata as Record<string, any> || {};

  const computationResult = await arcium.queuePayrollSettlement({
    batchId: batch.id,
    companyWallet: company!.walletAddress,
    payments: batch.payments.map(p => {
      const paymentMeta = (p as any).metadata as Record<string, any> || {};
      return {
        employeeId: p.employeeId,
        employeeWallet: p.employee.walletAddress,
        amount: paymentMeta.amount || 0,
      };
    }),
    currency: batch.currency,
  });

  // Update batch status
  const updated = await prisma.payrollBatch.update({
    where: { id: batch.id },
    data: {
      status: 'PROCESSING',
      computationId: computationResult.computationId,
    },
  });

  // Update all payment statuses
  await prisma.payrollPayment.updateMany({
    where: { batchId: batch.id },
    data: { status: 'PROCESSING' },
  });

  logger.info('Payroll batch execution started', {
    batchId: batch.id,
    computationId: computationResult.computationId,
  });

  res.json({
    success: true,
    data: serializeBatch(updated),
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/payroll/batches/:id/cancel - Cancel pending batch
 */
router.post('/batches/:id/cancel', authenticateCompany, asyncHandler(async (req, res) => {
  const batch = await prisma.payrollBatch.findFirst({
    where: {
      id: req.params.id,
      companyId: req.companyId!,
    },
  });

  if (!batch) {
    throw new AppError('Batch not found', 404, 'BATCH_NOT_FOUND');
  }

  if (batch.status !== 'PENDING') {
    throw new AppError(`Cannot cancel batch in status: ${batch.status}`, 400, 'INVALID_STATUS');
  }

  const updated = await prisma.payrollBatch.update({
    where: { id: batch.id },
    data: { status: 'CANCELLED' },
  });

  await prisma.payrollPayment.updateMany({
    where: { batchId: batch.id },
    data: { status: 'CANCELLED' },
  });

  logger.info('Payroll batch cancelled', { batchId: batch.id });

  res.json({
    success: true,
    data: serializeBatch(updated),
    timestamp: Date.now(),
  });
}));

/**
 * POST /v1/payroll/batches/:id/settle - Direct L1 settlement (bypass MPC)
 * Use this for faster processing when privacy is not required
 */
router.post('/batches/:id/settle', authenticateCompany, asyncHandler(async (req, res) => {
  const batch = await prisma.payrollBatch.findFirst({
    where: {
      id: req.params.id,
      companyId: req.companyId!,
    },
    include: {
      payments: {
        include: {
          employee: {
            select: { id: true, walletAddress: true },
          },
        },
      },
    },
  });

  if (!batch) {
    throw new AppError('Batch not found', 404, 'BATCH_NOT_FOUND');
  }

  if (batch.status !== 'PENDING') {
    throw new AppError(`Cannot settle batch in status: ${batch.status}`, 400, 'INVALID_STATUS');
  }

  // Update batch to processing
  await prisma.payrollBatch.update({
    where: { id: batch.id },
    data: { status: 'PROCESSING' },
  });

  // Update all payment statuses
  await prisma.payrollPayment.updateMany({
    where: { batchId: batch.id },
    data: { status: 'PROCESSING' },
  });

  // Process settlement via L1
  const settlementService = getSettlementService();

  try {
    const result = await settlementService.processPayrollBatch(batch.id);

    logger.info('Payroll batch settlement completed', {
      batchId: batch.id,
      success: result.success,
      successCount: result.payments.filter(p => p.status === 'success').length,
      failCount: result.payments.filter(p => p.status === 'failed').length,
    });

    // Fetch updated batch
    const updatedBatch = await prisma.payrollBatch.findUnique({
      where: { id: batch.id },
      include: {
        payments: {
          include: {
            employee: {
              select: { id: true, name: true, walletAddress: true },
            },
          },
        },
      },
    });

    res.json({
      success: true,
      data: {
        ...serializeBatch(updatedBatch, updatedBatch?.payments),
        settlement_result: {
          success: result.success,
          payments: result.payments,
        },
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    // Revert batch status on error
    await prisma.payrollBatch.update({
      where: { id: batch.id },
      data: { status: 'FAILED' },
    });

    await prisma.payrollPayment.updateMany({
      where: { batchId: batch.id },
      data: { status: 'FAILED' },
    });

    throw new AppError(`Settlement failed: ${error.message}`, 500, 'SETTLEMENT_FAILED');
  }
}));

/**
 * GET /v1/payroll/balance - Get settlement wallet balance
 */
router.get('/balance', authenticateCompany, asyncHandler(async (_req, res) => {
  const settlementService = getSettlementService();
  const balance = await settlementService.getPayerBalance();

  res.json({
    success: true,
    data: {
      sol: balance.sol,
      usdc: balance.usdc,
    },
    timestamp: Date.now(),
  });
}));

export default router;
