const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const intFmt = new Intl.NumberFormat('en-GB');

export const formatInt = (n: number) => intFmt.format(n);

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso)).replace(',', '');

/** "12 s ago", "4 min ago", then the clock time for anything older than an hour. */
export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return formatDateTime(iso);
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A gap between two moments, for backoff labels: "+0.8 s", "+2 min 10 s". */
export function formatGap(ms: number): string {
  if (ms < 1000) return `+${ms} ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `+${m} min ${s} s` : `+${m} min`;
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const shortId = (id: string) => id.slice(0, 8);

/** 4xx other than 408/425/429 is permanent; everything else that failed was retried. */
export function attemptKind(code: number | null, ok: boolean): 'ok' | 'retried' | 'rejected' {
  if (ok) return 'ok';
  if (code !== null && code >= 400 && code < 500 && ![408, 425, 429].includes(code)) {
    return 'rejected';
  }
  return 'retried';
}
