import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover active:bg-accent-dark disabled:bg-surface-3 disabled:text-text-muted',
  secondary:
    'bg-surface-2 text-text hover:bg-surface-3 border border-border disabled:opacity-50',
  ghost:
    'bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text disabled:opacity-50',
  danger:
    'bg-error text-white hover:opacity-90 disabled:opacity-50',
};

const sizeClass = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-2 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed ${variantClass[variant]} ${sizeClass[size]} ${className}`}
    >
      {children}
    </button>
  );
});