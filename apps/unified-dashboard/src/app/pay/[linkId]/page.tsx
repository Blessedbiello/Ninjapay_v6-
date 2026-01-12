'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { cn, formatCurrency } from '@/lib/utils';

interface PaymentLink {
  id: string;
  merchant_id: string;
  url: string;
  name: string;
  amount: number | null;
  currency: string;
  active: boolean;
  merchant: {
    business_name: string;
    wallet_address: string;
  };
}

type CheckoutStatus = 'loading' | 'ready' | 'processing' | 'success' | 'error' | 'expired';

export default function CheckoutPage() {
  const params = useParams();
  const linkId = params.linkId as string;
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [paymentLink, setPaymentLink] = useState<PaymentLink | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [txSignature, setTxSignature] = useState<string | null>(null);

  // Fetch payment link details
  useEffect(() => {
    async function fetchPaymentLink() {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/checkout/${linkId}`
        );

        if (!res.ok) {
          if (res.status === 404) {
            setError('Payment link not found');
          } else {
            setError('Failed to load payment details');
          }
          setStatus('error');
          return;
        }

        const data = await res.json();
        const link = data.data;

        if (!link.active) {
          setError('This payment link has expired');
          setStatus('expired');
          return;
        }

        setPaymentLink(link);
        setStatus('ready');
      } catch (err) {
        setError('Failed to load payment details');
        setStatus('error');
      }
    }

    fetchPaymentLink();
  }, [linkId]);

  const handlePayment = async () => {
    if (!publicKey || !signTransaction || !paymentLink) return;

    const amount = paymentLink.amount || parseFloat(customAmount);
    if (!amount || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setStatus('processing');
    setError(null);

    try {
      // Step 1: Create payment intent
      const intentRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/checkout/${linkId}/intent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount,
            payer_wallet: publicKey.toBase58(),
          }),
        }
      );

      if (!intentRes.ok) {
        throw new Error('Failed to create payment intent');
      }

      const intentData = await intentRes.json();
      const paymentIntentId = intentData.data.id;

      // Step 2: Create and sign transaction
      const merchantPubkey = new PublicKey(paymentLink.merchant.wallet_address);
      const lamports = Math.round(amount * LAMPORTS_PER_SOL); // Convert to lamports

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: merchantPubkey,
          lamports,
        })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      // Step 3: Confirm payment intent with signature
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/checkout/${linkId}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_intent_id: paymentIntentId,
            tx_signature: signature,
          }),
        }
      );

      setTxSignature(signature);
      setStatus('success');
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err.message || 'Payment failed. Please try again.');
      setStatus('ready');
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/20">
        <div className="animate-pulse">
          <div className="w-12 h-12 rounded-full bg-primary/20" />
        </div>
      </div>
    );
  }

  if (status === 'error' || status === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/20 p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {status === 'expired' ? 'Link Expired' : 'Error'}
          </h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/20 p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Payment Successful!</h1>
          <p className="text-muted-foreground mb-6">
            Your payment to {paymentLink?.merchant.business_name} has been completed.
          </p>
          {txSignature && (
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm"
            >
              View transaction on Solana Explorer
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/20 p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-lg">N</span>
          </div>
          <h1 className="text-2xl font-bold">NinjaPay Checkout</h1>
          <p className="text-muted-foreground text-sm mt-1">Secure, private payments</p>
        </div>

        {/* Payment Card */}
        <div className="rounded-2xl border bg-card p-6 shadow-lg">
          {/* Merchant Info */}
          <div className="text-center pb-6 border-b">
            <p className="text-sm text-muted-foreground">Paying to</p>
            <p className="font-semibold text-lg">{paymentLink?.merchant.business_name}</p>
          </div>

          {/* Payment Details */}
          <div className="py-6 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{paymentLink?.name}</p>
              {paymentLink?.amount ? (
                <p className="text-3xl font-bold">
                  {formatCurrency(paymentLink.amount, paymentLink.currency)}
                </p>
              ) : (
                <div>
                  <label className="text-sm text-muted-foreground">Enter amount</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="flex-1 px-4 py-3 text-2xl font-bold rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <span className="text-lg font-medium text-muted-foreground">
                      {paymentLink?.currency}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action */}
          <div className="space-y-4">
            {!connected ? (
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  Connect your Solana wallet to pay
                </p>
                <WalletMultiButton className="!w-full !justify-center !h-12" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                  <span className="text-sm">Connected</span>
                  <span className="font-mono text-sm">
                    {publicKey?.toBase58().slice(0, 6)}...{publicKey?.toBase58().slice(-4)}
                  </span>
                </div>
                <button
                  onClick={handlePayment}
                  disabled={status === 'processing' || (!paymentLink?.amount && !customAmount)}
                  className={cn(
                    'w-full py-4 rounded-xl font-semibold text-lg transition-all',
                    status === 'processing'
                      ? 'bg-primary/50 cursor-not-allowed'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                >
                  {status === 'processing' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    `Pay ${paymentLink?.amount ? formatCurrency(paymentLink.amount, paymentLink.currency) : customAmount ? formatCurrency(parseFloat(customAmount), paymentLink?.currency || 'SOL') : ''}`
                  )}
                </button>
              </>
            )}

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-muted-foreground">
            Powered by NinjaPay - Confidential payments on Solana
          </p>
        </div>
      </div>
    </div>
  );
}
