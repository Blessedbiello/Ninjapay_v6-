'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatDate, getStatusColor } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export default function TransactionsPage() {
  const { token } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['payment-intents', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter.toUpperCase());
      }
      params.set('limit', '50');

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/payment_intents?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch transactions');
      return res.json();
    },
    enabled: !!token,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground">View and manage your payment intents</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['all', 'pending', 'processing', 'finalized', 'failed'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              statusFilter === status
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            )}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-4 font-medium text-muted-foreground">ID</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Recipient</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Amount</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : !data?.data?.length ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No transactions found
                </td>
              </tr>
            ) : (
              data.data.map((tx: any) => (
                <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="p-4 font-mono text-sm">{tx.id.slice(0, 12)}...</td>
                  <td className="p-4 font-mono text-sm">
                    {tx.recipient.slice(0, 6)}...{tx.recipient.slice(-4)}
                  </td>
                  <td className="p-4">
                    <span className="text-muted-foreground text-sm">Encrypted</span>
                  </td>
                  <td className="p-4">
                    <span className={cn('px-2 py-1 rounded-full text-xs font-medium', getStatusColor(tx.status))}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {formatDate(tx.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
