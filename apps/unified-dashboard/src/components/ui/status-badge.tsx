'use client';

import { cn } from '@/lib/utils';

type PaymentStatus = 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FINALIZED' | 'FAILED' | 'CANCELLED';
type PayrollStatus = 'DRAFT' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
  // Payment statuses
  PENDING: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  PROCESSING: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  CONFIRMED: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  FINALIZED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  FAILED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  CANCELLED: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
  // Payroll statuses
  DRAFT: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' },
  COMPLETED: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  // Generic
  ACTIVE: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  INACTIVE: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
};

interface StatusBadgeProps {
  status: PaymentStatus | PayrollStatus | string;
  showDot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({ status, showDot = true, size = 'sm', className }: StatusBadgeProps) {
  const style = statusStyles[status] || statusStyles.PENDING;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        style.bg,
        style.text,
        sizeClasses[size],
        className
      )}
    >
      {showDot && (
        <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      )}
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
  className?: string;
}

export function PaymentStatusBadge({ status, className }: PaymentStatusBadgeProps) {
  return <StatusBadge status={status} className={className} />;
}

interface PayrollStatusBadgeProps {
  status: PayrollStatus;
  className?: string;
}

export function PayrollStatusBadge({ status, className }: PayrollStatusBadgeProps) {
  return <StatusBadge status={status} className={className} />;
}

interface ActiveBadgeProps {
  active: boolean;
  className?: string;
}

export function ActiveBadge({ active, className }: ActiveBadgeProps) {
  return <StatusBadge status={active ? 'ACTIVE' : 'INACTIVE'} className={className} />;
}
