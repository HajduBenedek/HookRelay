/** What to do after an attempt. Pure functions, so the policy is unit-testable in isolation. */
export type Outcome =
  | { kind: 'success' }
  | { kind: 'retry'; delayMs: number; reason: string }
  | { kind: 'dead'; reason: string };

export interface AttemptResult {
  /** HTTP status, or undefined when no response arrived (network error, timeout). */
  statusCode?: number;
  error?: string;
  retryAfterHeader?: string | null;
}

export interface RetryPolicy {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429]);

export function decide(
  result: AttemptResult,
  attemptNo: number,
  policy: RetryPolicy,
  now = Date.now(),
  random = Math.random,
): Outcome {
  const { statusCode } = result;
  if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) return { kind: 'success' };

  const reason = statusCode === undefined ? (result.error ?? 'no response') : `HTTP ${statusCode}`;
  const retryable =
    statusCode === undefined || statusCode >= 500 || RETRYABLE_STATUS.has(statusCode);

  // A 4xx means the receiver understood and rejected the payload; resending it unchanged
  // will not help, so it goes straight to the dead-letter queue for a human to look at.
  if (!retryable) return { kind: 'dead', reason: `${reason} (not retryable)` };
  if (attemptNo >= policy.maxAttempts) {
    return { kind: 'dead', reason: `${reason} (gave up after ${attemptNo} attempts)` };
  }

  const retryAfter = parseRetryAfter(result.retryAfterHeader, now);
  const delayMs =
    retryAfter !== undefined
      ? Math.min(retryAfter, policy.maxMs)
      : backoff(attemptNo, policy.baseMs, policy.maxMs, random);
  return { kind: 'retry', delayMs, reason };
}

/** Full-jitter exponential backoff: uniform in [0, min(max, base * 2^(attempt-1))]. */
export function backoff(attemptNo: number, baseMs: number, maxMs: number, random = Math.random) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** (attemptNo - 1));
  return Math.round(random() * ceiling);
}

/** `Retry-After` is either delta-seconds or an HTTP date (RFC 9110 §10.2.3). */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()) {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
