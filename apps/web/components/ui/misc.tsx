import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function Alert({ variant = 'info', title, children, className }: { variant?: 'info' | 'warning' | 'error'; title?: string; children?: ReactNode; className?: string }) {
  const Icon = variant === 'error' ? XCircle : variant === 'warning' ? AlertTriangle : Info;
  const tone =
    variant === 'error'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : variant === 'warning'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-primary/30 bg-accent text-accent-foreground';
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border p-3 text-sm', tone, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex rounded-md border bg-muted p-0.5">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          type="button"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cn(
            'rounded px-3 py-1.5 text-sm font-medium transition-colors',
            value === i.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-3 text-sm text-muted-foreground">
      <span>
        Всего: {total} · стр. {page} из {pages}
      </span>
      <div className="flex gap-2">
        <button type="button" className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Назад
        </button>
        <button type="button" className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Вперёд
        </button>
      </div>
    </div>
  );
}
