import React from 'react';

export type BadgeStatus =
  | 'PASS'
  | 'WARN'
  | 'FAIL'
  | 'PENDING'
  | 'pass'
  | 'warn'
  | 'fail'
  | 'pending'
  | 'running';

interface StatusBadgeProps {
  status: BadgeStatus | string;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  className = '',
}) => {
  const normalized = (status || '').toUpperCase();

  const getDotColor = () => {
    switch (normalized) {
      case 'PASS':
        return 'bg-[#30D158]';
      case 'WARN':
        return 'bg-[#FF9F0A]';
      case 'FAIL':
        return 'bg-[#FF453A]';
      case 'RUNNING':
        return 'bg-[#0A84FF] animate-pulse';
      case 'PENDING':
      default:
        return 'bg-[#86868B]';
    }
  };

  const dotColor = getDotColor();
  const pyClass = size === 'sm' ? 'py-0.5 px-2 text-[10px]' : 'py-1 px-2.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#1C1C1E] font-medium text-[#F5F5F7] tracking-tight ${pyClass} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span>{normalized || 'PENDING'}</span>
    </span>
  );
};
