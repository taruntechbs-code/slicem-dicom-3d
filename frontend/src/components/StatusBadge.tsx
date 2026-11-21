import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Clock, Loader2 } from 'lucide-react';

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
  showIcon = true,
  className = '',
}) => {
  const normalized = (status || '').toUpperCase();

  const getStyle = () => {
    switch (normalized) {
      case 'PASS':
        return {
          container: 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400 shadow-sm shadow-emerald-950/50',
          dot: 'bg-emerald-400',
          icon: <CheckCircle2 className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />,
          label: 'PASS',
        };
      case 'WARN':
        return {
          container: 'bg-amber-950/60 border-amber-500/40 text-amber-300 shadow-sm shadow-amber-950/50',
          dot: 'bg-amber-400',
          icon: <AlertTriangle className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />,
          label: 'WARN',
        };
      case 'FAIL':
        return {
          container: 'bg-rose-950/60 border-rose-500/40 text-rose-400 shadow-sm shadow-rose-950/50',
          dot: 'bg-rose-400',
          icon: <XCircle className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />,
          label: 'FAIL',
        };
      case 'RUNNING':
        return {
          container: 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300 shadow-sm shadow-cyan-950/50',
          dot: 'bg-cyan-400 animate-pulse',
          icon: <Loader2 className={`${size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} animate-spin`} />,
          label: 'RUNNING',
        };
      case 'PENDING':
      default:
        return {
          container: 'bg-slate-900/80 border-slate-700/60 text-slate-400',
          dot: 'bg-slate-400',
          icon: <Clock className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />,
          label: normalized || 'PENDING',
        };
    }
  };

  const style = getStyle();
  const sizeClasses =
    size === 'sm' ? 'px-2 py-0.5 text-xs font-mono tracking-wider' : 'px-2.5 py-1 text-xs font-mono tracking-wider';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${sizeClasses} ${style.container} ${className}`}
    >
      {showIcon ? style.icon : <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />}
      <span>{style.label}</span>
    </span>
  );
};
