import type { ReactNode } from 'react';

type Tone = 'neutral' | 'ok' | 'warn' | 'error' | 'accent';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-text-secondary border-border',
  ok: 'bg-ok/10 text-ok border-ok/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  error: 'bg-error/10 text-error border-error/30',
  accent: 'bg-accent/10 text-accent border-accent/30',
};

const dotClass: Record<Tone, string> = {
  neutral: 'bg-text-muted',
  ok: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-error',
  accent: 'bg-accent',
};

interface Props {
  tone: Tone;
  children: ReactNode;
  showDot?: boolean;
  /** Optional inline icon, rendered before the leading dot/label. Useful
   *  for validator messages (✓, ⚠) where a small icon carries meaning. */
  icon?: ReactNode;
  className?: string;
}

export function StatusBadge({
  tone,
  children,
  showDot = true,
  icon,
  className = '',
}: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass[tone]} ${className}`}
    >
      {icon && <span className="inline-flex h-3 w-3 items-center justify-center">{icon}</span>}
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${dotClass[tone]}`} />}
      {children}
    </span>
  );
}