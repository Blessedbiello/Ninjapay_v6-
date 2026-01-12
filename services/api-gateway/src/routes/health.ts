import { Router, Request, Response } from 'express';
import { prisma } from '@ninjapay/database';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'ninjapay-api-gateway',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.get('/detailed', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

  // Database check
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'healthy', latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = { status: 'unhealthy', error: (error as Error).message };
  }

  // Arcium service check
  const arciumUrl = process.env.ARCIUM_SERVICE_URL || 'http://localhost:8002';
  const arciumStart = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${arciumUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    checks.arcium = {
      status: response.ok ? 'healthy' : 'unhealthy',
      latency: Date.now() - arciumStart,
    };
  } catch (error) {
    checks.arcium = { status: 'unhealthy', error: (error as Error).message };
  }

  const overallStatus = Object.values(checks).every(c => c.status === 'healthy')
    ? 'healthy'
    : 'degraded';

  res.json({
    status: overallStatus,
    service: 'ninjapay-api-gateway',
    version: '2.0.0',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
