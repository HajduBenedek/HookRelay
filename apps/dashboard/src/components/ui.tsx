import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { DeliveryStatus } from '../lib/api';

type Variant = 'primary' | 'secondary' | 'ghost';

const buttonStyles: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90 active:opacity-80',
  secondary: 'border border-control bg-surface text-ink hover:bg-raised active:bg-active',
  ghost: 'text-ink hover:bg-raised active:bg-active',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-control px-3 text-[13px] font-medium transition-[background-color,opacity] disabled:cursor-not-allowed disabled:opacity-60 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export type PillKind = 'positive' | 'negative' | 'warning' | 'neutral';

export function Pill({ kind, children }: { kind: PillKind; children: ReactNode }) {
  return (
    <span
      className="inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2 text-xs font-medium"
      style={{ background: `var(--pill-${kind}-bg)`, color: `var(--pill-${kind}-ink)` }}
    >
      {children}
    </span>
  );
}

export const deliveryPill: Record<DeliveryStatus, { kind: PillKind; label: string }> = {
  pending: { kind: 'neutral', label: 'Waiting' },
  queued: { kind: 'neutral', label: 'In flight' },
  retrying: { kind: 'warning', label: 'Retrying' },
  succeeded: { kind: 'positive', label: 'Delivered' },
  dead: { kind: 'negative', label: 'Dead letter' },
};

/** One status per event, from its deliveries: the worst one wins. */
export function eventStatus(deliveries: Partial<Record<DeliveryStatus, number>>) {
  const total = Object.values(deliveries).reduce((a, b) => a + (b ?? 0), 0);
  const delivered = deliveries.succeeded ?? 0;
  if (total === 0) return { kind: 'neutral' as const, label: 'No destinations' };
  if (deliveries.dead) return { kind: 'negative' as const, label: `${deliveries.dead} failed` };
  if (deliveries.retrying) return { kind: 'warning' as const, label: 'Retrying' };
  if (delivered < total) return { kind: 'neutral' as const, label: 'In flight' };
  return { kind: 'positive' as const, label: `Delivered ${delivered}/${total}` };
}

export function Panel({
  title,
  aside,
  children,
  className = '',
  flush = false,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Content runs to the panel's edges (tables); otherwise it gets the card padding. */
  flush?: boolean;
}) {
  return (
    <section className={`min-w-0 rounded-card border border-border bg-surface ${className}`}>
      {title !== undefined && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pt-3 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {aside && <div className="flex items-center gap-3 text-xs text-muted">{aside}</div>}
        </header>
      )}
      <div className={flush ? '' : 'px-5 pb-5'}>{children}</div>
    </section>
  );
}

/** Loading placeholder at the real size of the value it stands in for. No shimmer. */
export function Bar({ w, h = 14 }: { w: number | string; h?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block rounded-[3px] bg-raised align-middle"
      style={{ width: w, height: h }}
    />
  );
}

export function ErrorBlock({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 px-5 py-4 text-sm">
      <span className="size-2 flex-none rounded-full bg-negative" aria-hidden />
      <span>Couldn't load {what}. Is the API running on port 3000?</span>
      <Button variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="mx-5 mb-5 rounded-card border border-dashed border-control px-4 py-3 text-sm text-muted">
      {children}
    </div>
  );
}

/** IDs, URLs, keys and status codes: the developer-facing strings, in Plex Mono. */
export function Mono({
  children,
  className = '',
  small = false,
}: {
  children: ReactNode;
  className?: string;
  small?: boolean;
}) {
  return (
    <span className={`font-mono ${small ? 'text-xs' : 'text-[13px]'} ${className}`}>
      {children}
    </span>
  );
}
