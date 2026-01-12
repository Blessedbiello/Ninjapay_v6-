use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("NJPvau1tPBHrRxUqrLvhLq3zDpNZRGpNPdTpP1Dvq6C");

#[program]
pub mod ninjapay_vault {
    use super::*;

    /// Initialize the vault configuration
    pub fn initialize(ctx: Context<Initialize>, fee_basis_points: u16) -> Result<()> {
        let vault_config = &mut ctx.accounts.vault_config;
        vault_config.authority = ctx.accounts.authority.key();
        vault_config.fee_collector = ctx.accounts.fee_collector.key();
        vault_config.fee_basis_points = fee_basis_points;
        vault_config.total_volume = 0;
        vault_config.total_payments = 0;
        vault_config.bump = ctx.bumps.vault_config;

        emit!(VaultInitialized {
            authority: vault_config.authority,
            fee_collector: vault_config.fee_collector,
            fee_basis_points,
        });

        Ok(())
    }

    /// Process a payment from payer to merchant
    pub fn process_payment(
        ctx: Context<ProcessPayment>,
        amount: u64,
        payment_id: [u8; 32],
        commitment: [u8; 32],
    ) -> Result<()> {
        let vault_config = &ctx.accounts.vault_config;

        // Calculate fee
        let fee = (amount as u128)
            .checked_mul(vault_config.fee_basis_points as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64;

        let net_amount = amount.checked_sub(fee).unwrap();

        // Transfer net amount to merchant
        let cpi_accounts = Transfer {
            from: ctx.accounts.payer_token_account.to_account_info(),
            to: ctx.accounts.merchant_token_account.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, net_amount)?;

        // Transfer fee to collector (if any)
        if fee > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.payer_token_account.to_account_info(),
                to: ctx.accounts.fee_token_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            token::transfer(cpi_ctx, fee)?;
        }

        // Record payment
        let payment_record = &mut ctx.accounts.payment_record;
        payment_record.payment_id = payment_id;
        payment_record.payer = ctx.accounts.payer.key();
        payment_record.merchant = ctx.accounts.merchant.key();
        payment_record.amount = amount;
        payment_record.fee = fee;
        payment_record.commitment = commitment;
        payment_record.timestamp = Clock::get()?.unix_timestamp;
        payment_record.bump = ctx.bumps.payment_record;

        // Update vault stats
        let vault_config = &mut ctx.accounts.vault_config;
        vault_config.total_volume = vault_config.total_volume.checked_add(amount).unwrap();
        vault_config.total_payments = vault_config.total_payments.checked_add(1).unwrap();

        emit!(PaymentProcessed {
            payment_id,
            payer: ctx.accounts.payer.key(),
            merchant: ctx.accounts.merchant.key(),
            amount,
            fee,
            commitment,
            timestamp: payment_record.timestamp,
        });

        Ok(())
    }

    /// Process a batch of payroll payments
    pub fn process_payroll_batch(
        ctx: Context<ProcessPayrollBatch>,
        batch_id: [u8; 32],
        total_amount: u64,
        payment_count: u16,
    ) -> Result<()> {
        // Record batch on-chain
        let batch_record = &mut ctx.accounts.batch_record;
        batch_record.batch_id = batch_id;
        batch_record.company = ctx.accounts.company.key();
        batch_record.total_amount = total_amount;
        batch_record.payment_count = payment_count;
        batch_record.timestamp = Clock::get()?.unix_timestamp;
        batch_record.bump = ctx.bumps.batch_record;

        emit!(PayrollBatchProcessed {
            batch_id,
            company: ctx.accounts.company.key(),
            total_amount,
            payment_count,
            timestamp: batch_record.timestamp,
        });

        Ok(())
    }

    /// Update vault fee configuration
    pub fn update_fee(ctx: Context<UpdateFee>, new_fee_basis_points: u16) -> Result<()> {
        require!(new_fee_basis_points <= 1000, VaultError::FeeTooHigh); // Max 10%

        let vault_config = &mut ctx.accounts.vault_config;
        let old_fee = vault_config.fee_basis_points;
        vault_config.fee_basis_points = new_fee_basis_points;

        emit!(FeeUpdated {
            old_fee,
            new_fee: new_fee_basis_points,
        });

        Ok(())
    }

    /// Transfer vault authority
    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        let vault_config = &mut ctx.accounts.vault_config;
        let old_authority = vault_config.authority;
        vault_config.authority = ctx.accounts.new_authority.key();

        emit!(AuthorityTransferred {
            old_authority,
            new_authority: vault_config.authority,
        });

        Ok(())
    }
}

// ============ Accounts ============

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [b"vault_config"],
        bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Fee collector can be any account
    pub fee_collector: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, payment_id: [u8; 32])]
pub struct ProcessPayment<'info> {
    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + PaymentRecord::INIT_SPACE,
        seeds = [b"payment", &payment_id],
        bump
    )]
    pub payment_record: Account<'info, PaymentRecord>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// CHECK: Merchant wallet
    pub merchant: UncheckedAccount<'info>,

    #[account(mut)]
    pub merchant_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(batch_id: [u8; 32])]
pub struct ProcessPayrollBatch<'info> {
    #[account(
        init,
        payer = company,
        space = 8 + BatchRecord::INIT_SPACE,
        seeds = [b"batch", &batch_id],
        bump
    )]
    pub batch_record: Account<'info, BatchRecord>,

    #[account(mut)]
    pub company: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFee<'info> {
    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump,
        has_one = authority
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump,
        has_one = authority
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub authority: Signer<'info>,

    /// CHECK: New authority can be any account
    pub new_authority: UncheckedAccount<'info>,
}

// ============ State ============

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub fee_collector: Pubkey,
    pub fee_basis_points: u16,
    pub total_volume: u64,
    pub total_payments: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PaymentRecord {
    pub payment_id: [u8; 32],
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub commitment: [u8; 32],
    pub timestamp: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BatchRecord {
    pub batch_id: [u8; 32],
    pub company: Pubkey,
    pub total_amount: u64,
    pub payment_count: u16,
    pub timestamp: i64,
    pub bump: u8,
}

// ============ Events ============

#[event]
pub struct VaultInitialized {
    pub authority: Pubkey,
    pub fee_collector: Pubkey,
    pub fee_basis_points: u16,
}

#[event]
pub struct PaymentProcessed {
    pub payment_id: [u8; 32],
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub commitment: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct PayrollBatchProcessed {
    pub batch_id: [u8; 32],
    pub company: Pubkey,
    pub total_amount: u64,
    pub payment_count: u16,
    pub timestamp: i64,
}

#[event]
pub struct FeeUpdated {
    pub old_fee: u16,
    pub new_fee: u16,
}

#[event]
pub struct AuthorityTransferred {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

// ============ Errors ============

#[error_code]
pub enum VaultError {
    #[msg("Fee exceeds maximum allowed (10%)")]
    FeeTooHigh,
    #[msg("Invalid payment amount")]
    InvalidAmount,
    #[msg("Unauthorized access")]
    Unauthorized,
}
