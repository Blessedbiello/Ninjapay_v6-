'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn, formatDate, formatCurrency, getStatusColor } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export default function BatchesPage() {
  const { token } = useAuthStore();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['payroll-batches'],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/payroll/batches`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch batches');
      return res.json();
    },
    enabled: !!token,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/payroll/employees?active=true`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch employees');
      return res.json();
    },
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { payments: Array<{ employeeId: string; amount: number }> }) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/payroll/batches`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error('Failed to create batch');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-batches'] });
      setShowCreateModal(false);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/v1/payroll/batches/${batchId}/execute`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('Failed to execute batch');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-batches'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payroll Batches</h1>
          <p className="text-muted-foreground">Create and manage payroll runs</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          Create Batch
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-4 font-medium text-muted-foreground">ID</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Employees</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Total</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Created</th>
              <th className="text-left p-4 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {batchesLoading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : !batches?.data?.length ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No payroll batches found. Create your first batch to run payroll.
                </td>
              </tr>
            ) : (
              batches.data.map((batch: any) => (
                <tr key={batch.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="p-4 font-mono text-sm">{batch.id.slice(0, 12)}...</td>
                  <td className="p-4">{batch.employee_count}</td>
                  <td className="p-4">
                    {batch.total_amount
                      ? formatCurrency(batch.total_amount, batch.currency)
                      : 'Encrypted'}
                  </td>
                  <td className="p-4">
                    <span
                      className={cn(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        getStatusColor(batch.status)
                      )}
                    >
                      {batch.status}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {formatDate(batch.created_at)}
                  </td>
                  <td className="p-4">
                    {batch.status === 'pending' && (
                      <button
                        onClick={() => executeMutation.mutate(batch.id)}
                        disabled={executeMutation.isPending}
                        className="text-sm text-primary hover:underline disabled:opacity-50"
                      >
                        Execute
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreateModal && employees?.data && (
        <CreateBatchModal
          employees={employees.data}
          onClose={() => setShowCreateModal(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}
    </div>
  );
}

function CreateBatchModal({
  employees,
  onClose,
  onCreate,
  isLoading,
}: {
  employees: Array<{ id: string; name: string; email: string }>;
  onClose: () => void;
  onCreate: (data: { payments: Array<{ employeeId: string; amount: number }> }) => void;
  isLoading: boolean;
}) {
  const [payments, setPayments] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const paymentsList = Object.entries(payments)
      .filter(([_, amount]) => amount && parseFloat(amount) > 0)
      .map(([employeeId, amount]) => ({
        employeeId,
        amount: parseFloat(amount),
      }));

    if (paymentsList.length === 0) {
      return;
    }

    onCreate({ payments: paymentsList });
  };

  const totalAmount = Object.values(payments).reduce(
    (sum, amt) => sum + (parseFloat(amt) || 0),
    0
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Create Payroll Batch</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium mb-2">
              Enter amounts for each employee
            </label>
            {employees.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No active employees. Add employees first.
              </p>
            ) : (
              <div className="space-y-3">
                {employees.map((emp: any) => (
                  <div key={emp.id} className="flex items-center gap-4">
                    <div className="flex-1">
                      <p className="font-medium">{emp.name}</p>
                      <p className="text-sm text-muted-foreground">{emp.email}</p>
                    </div>
                    <div className="w-40">
                      <input
                        type="number"
                        value={payments[emp.id] || ''}
                        onChange={(e) =>
                          setPayments((p) => ({ ...p, [emp.id]: e.target.value }))
                        }
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        className="w-full px-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-right"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-16">USDC</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-4">
              <span className="font-medium">Total</span>
              <span className="text-xl font-bold">
                {formatCurrency(totalAmount, 'USDC')}
              </span>
            </div>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || totalAmount === 0}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Creating...' : 'Create Batch'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
