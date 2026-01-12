import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { prisma } from '@ninjapay/database';
import { createLogger } from '@ninjapay/logger';

const logger = createLogger('settlement');

// USDC Token addresses
const USDC_MINT = {
  mainnet: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  devnet: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), // Devnet USDC
};

interface PaymentInfo {
  recipient: string;
  amount: number; // in smallest units (lamports for SOL, base units for tokens)
}

interface SettlementResult {
  success: boolean;
  signature?: string;
  error?: string;
  payments: Array<{
    recipient: string;
    status: 'success' | 'failed';
    signature?: string;
    error?: string;
  }>;
}

interface BatchConfig {
  maxPaymentsPerTx: number;
  priorityFee: number; // in microlamports
  maxRetries: number;
  retryDelay: number; // in ms
}

const DEFAULT_CONFIG: BatchConfig = {
  maxPaymentsPerTx: 10, // Versioned transactions can handle more
  priorityFee: 1000, // 0.001 SOL priority fee
  maxRetries: 3,
  retryDelay: 2000,
};

/**
 * Settlement Service for Solana L1 transactions
 * Handles batching, retries, and transaction management
 */
export class SettlementService {
  private connection: Connection;
  private payerKeypair: Keypair;
  private config: BatchConfig;
  private isMainnet: boolean;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.isMainnet = rpcUrl.includes('mainnet');

    // Load payer keypair from environment
    const keypairPath = process.env.SOLANA_KEYPAIR_PATH;
    if (keypairPath) {
      const fs = require('fs');
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      this.payerKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    } else {
      // For development, generate a temporary keypair
      this.payerKeypair = Keypair.generate();
      logger.warn('Using temporary keypair - fund it for transactions to work');
    }

    this.config = {
      ...DEFAULT_CONFIG,
      priorityFee: parseInt(process.env.SOLANA_PRIORITY_FEE || '1000'),
    };

    logger.info('Settlement service initialized', {
      rpc: rpcUrl.substring(0, 30),
      payer: this.payerKeypair.publicKey.toBase58().substring(0, 8),
      isMainnet: this.isMainnet,
    });
  }

  /**
   * Get USDC mint address based on network
   */
  private getUsdcMint(): PublicKey {
    return this.isMainnet ? USDC_MINT.mainnet : USDC_MINT.devnet;
  }

  /**
   * Process a single payment (SOL transfer)
   */
  async processSolPayment(
    recipient: string,
    amountLamports: number
  ): Promise<SettlementResult> {
    const recipientPubkey = new PublicKey(recipient);

    try {
      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFee,
        }),
        SystemProgram.transfer({
          fromPubkey: this.payerKeypair.publicKey,
          toPubkey: recipientPubkey,
          lamports: amountLamports,
        })
      );

      const signature = await this.sendAndConfirmTransaction(transaction);

      return {
        success: true,
        signature,
        payments: [{ recipient, status: 'success', signature }],
      };
    } catch (error: any) {
      logger.error('SOL payment failed', { error, recipient });
      return {
        success: false,
        error: error.message,
        payments: [{ recipient, status: 'failed', error: error.message }],
      };
    }
  }

  /**
   * Process a single USDC payment
   */
  async processUsdcPayment(
    recipient: string,
    amount: number // in USDC (will be converted to base units)
  ): Promise<SettlementResult> {
    const recipientPubkey = new PublicKey(recipient);
    const usdcMint = this.getUsdcMint();
    const amountBaseUnits = Math.round(amount * 1_000_000); // USDC has 6 decimals

    try {
      // Get token accounts
      const sourceAta = await getAssociatedTokenAddress(
        usdcMint,
        this.payerKeypair.publicKey
      );
      const destinationAta = await getAssociatedTokenAddress(
        usdcMint,
        recipientPubkey
      );

      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFee,
        }),
        createTransferInstruction(
          sourceAta,
          destinationAta,
          this.payerKeypair.publicKey,
          amountBaseUnits,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      const signature = await this.sendAndConfirmTransaction(transaction);

      return {
        success: true,
        signature,
        payments: [{ recipient, status: 'success', signature }],
      };
    } catch (error: any) {
      logger.error('USDC payment failed', { error, recipient });
      return {
        success: false,
        error: error.message,
        payments: [{ recipient, status: 'failed', error: error.message }],
      };
    }
  }

  /**
   * Process a batch of payments (for payroll)
   * Groups payments into batched transactions for efficiency
   */
  async processBatchPayments(
    payments: PaymentInfo[],
    currency: string = 'SOL'
  ): Promise<SettlementResult> {
    const results: SettlementResult['payments'] = [];
    const batches = this.chunkPayments(payments, this.config.maxPaymentsPerTx);

    logger.info('Processing batch payments', {
      totalPayments: payments.length,
      batches: batches.length,
      currency,
    });

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.debug(`Processing batch ${i + 1}/${batches.length}`, {
        payments: batch.length,
      });

      try {
        const signature = await this.processBatch(batch, currency);

        // Mark all payments in batch as successful
        for (const payment of batch) {
          results.push({
            recipient: payment.recipient,
            status: 'success',
            signature,
          });
        }
      } catch (error: any) {
        logger.error(`Batch ${i + 1} failed`, { error });

        // Mark all payments in batch as failed
        for (const payment of batch) {
          results.push({
            recipient: payment.recipient,
            status: 'failed',
            error: error.message,
          });
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await this.sleep(500);
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const failCount = results.filter((r) => r.status === 'failed').length;

    logger.info('Batch processing complete', { successCount, failCount });

    return {
      success: failCount === 0,
      payments: results,
    };
  }

  /**
   * Process a single batch of payments in one transaction
   */
  private async processBatch(
    payments: PaymentInfo[],
    currency: string
  ): Promise<string> {
    const instructions: TransactionInstruction[] = [];

    // Add priority fee
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: this.config.priorityFee,
      })
    );

    // Add compute units (estimate based on payment count)
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 200_000 + payments.length * 50_000,
      })
    );

    if (currency === 'SOL') {
      // SOL transfers
      for (const payment of payments) {
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: this.payerKeypair.publicKey,
            toPubkey: new PublicKey(payment.recipient),
            lamports: payment.amount,
          })
        );
      }
    } else if (currency === 'USDC') {
      // USDC transfers
      const usdcMint = this.getUsdcMint();
      const sourceAta = await getAssociatedTokenAddress(
        usdcMint,
        this.payerKeypair.publicKey
      );

      for (const payment of payments) {
        const destinationAta = await getAssociatedTokenAddress(
          usdcMint,
          new PublicKey(payment.recipient)
        );

        instructions.push(
          createTransferInstruction(
            sourceAta,
            destinationAta,
            this.payerKeypair.publicKey,
            payment.amount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }
    }

    // Create versioned transaction
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
      payerKey: this.payerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([this.payerKeypair]);

    // Send and confirm
    const signature = await this.connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      }
    );

    await this.connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      'confirmed'
    );

    return signature;
  }

  /**
   * Send and confirm a legacy transaction with retries
   */
  private async sendAndConfirmTransaction(
    transaction: Transaction
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.payerKeypair.publicKey;
    transaction.sign(this.payerKeypair);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const signature = await this.connection.sendRawTransaction(
          transaction.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          }
        );

        await this.connection.confirmTransaction(
          {
            signature,
            blockhash,
            lastValidBlockHeight,
          },
          'confirmed'
        );

        return signature;
      } catch (error: any) {
        lastError = error;
        logger.warn(`Transaction attempt ${attempt + 1} failed`, {
          error: error.message,
        });

        if (attempt < this.config.maxRetries - 1) {
          await this.sleep(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('Transaction failed after retries');
  }

  /**
   * Process payroll batch from database
   */
  async processPayrollBatch(batchId: string): Promise<SettlementResult> {
    const batch = await prisma.payrollBatch.findUnique({
      where: { id: batchId },
      include: {
        payments: {
          include: {
            employee: true,
          },
        },
        company: true,
      },
    });

    if (!batch) {
      throw new Error('Batch not found');
    }

    if (batch.status !== 'PROCESSING') {
      throw new Error(`Cannot process batch in status: ${batch.status}`);
    }

    // Extract payment info
    const payments: PaymentInfo[] = batch.payments.map((p) => {
      const metadata = p.metadata as Record<string, any> || {};
      return {
        recipient: p.employee.walletAddress,
        amount:
          batch.currency === 'SOL'
            ? Math.round((metadata.amount || 0) * LAMPORTS_PER_SOL)
            : Math.round((metadata.amount || 0) * 1_000_000), // USDC base units
      };
    });

    // Process batch
    const result = await this.processBatchPayments(payments, batch.currency);

    // Update individual payment records
    for (const paymentResult of result.payments) {
      const payment = batch.payments.find(
        (p) => p.employee.walletAddress === paymentResult.recipient
      );
      if (payment) {
        await prisma.payrollPayment.update({
          where: { id: payment.id },
          data: {
            status: paymentResult.status === 'success' ? 'COMPLETED' : 'FAILED',
            txSignature: paymentResult.signature,
          },
        });
      }
    }

    // Update batch status
    const allSuccess = result.payments.every((p) => p.status === 'success');
    await prisma.payrollBatch.update({
      where: { id: batchId },
      data: {
        status: allSuccess ? 'COMPLETED' : 'FAILED',
      },
    });

    logger.info('Payroll batch processed', {
      batchId,
      status: allSuccess ? 'COMPLETED' : 'FAILED',
      successCount: result.payments.filter((p) => p.status === 'success').length,
      failCount: result.payments.filter((p) => p.status === 'failed').length,
    });

    return result;
  }

  /**
   * Get payer balance
   */
  async getPayerBalance(): Promise<{ sol: number; usdc: number }> {
    const solBalance = await this.connection.getBalance(
      this.payerKeypair.publicKey
    );

    let usdcBalance = 0;
    try {
      const usdcMint = this.getUsdcMint();
      const ata = await getAssociatedTokenAddress(
        usdcMint,
        this.payerKeypair.publicKey
      );
      const tokenAccount = await this.connection.getTokenAccountBalance(ata);
      usdcBalance = tokenAccount.value.uiAmount || 0;
    } catch {
      // Token account may not exist
    }

    return {
      sol: solBalance / LAMPORTS_PER_SOL,
      usdc: usdcBalance,
    };
  }

  /**
   * Chunk payments into batches
   */
  private chunkPayments(
    payments: PaymentInfo[],
    size: number
  ): PaymentInfo[][] {
    const chunks: PaymentInfo[][] = [];
    for (let i = 0; i < payments.length; i += size) {
      chunks.push(payments.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let settlementService: SettlementService | null = null;

export function getSettlementService(): SettlementService {
  if (!settlementService) {
    settlementService = new SettlementService();
  }
  return settlementService;
}
