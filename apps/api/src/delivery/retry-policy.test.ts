import { describe, expect, it } from 'vitest';
import { backoff, decide, parseRetryAfter } from './retry-policy.js';

const policy = { baseMs: 1_000, maxMs: 600_000, maxAttempts: 8 };
const NOW = Date.parse('2026-10-22T12:00:00Z');
const always = (value: number) => () => value;

describe('decide', () => {
  it.each([200, 201, 204, 299])('treats %i as delivered', (statusCode) => {
    expect(decide({ statusCode }, 1, policy)).toEqual({ kind: 'success' });
  });

  it.each([500, 502, 503, 504, 408, 425, 429])('retries HTTP %i', (statusCode) => {
    expect(decide({ statusCode }, 1, policy, NOW, always(0.5)).kind).toBe('retry');
  });

  it('retries when no response arrived at all', () => {
    const outcome = decide({ error: 'connect ECONNREFUSED' }, 1, policy, NOW, always(0.5));
    expect(outcome).toMatchObject({ kind: 'retry', reason: 'connect ECONNREFUSED' });
  });

  it.each([400, 401, 404, 410, 422])('dead-letters HTTP %i on the first attempt', (statusCode) => {
    expect(decide({ statusCode }, 1, policy)).toEqual({
      kind: 'dead',
      reason: `HTTP ${statusCode} (not retryable)`,
    });
  });

  it('gives up once the attempt budget is spent', () => {
    expect(decide({ statusCode: 503 }, 8, policy)).toEqual({
      kind: 'dead',
      reason: 'HTTP 503 (gave up after 8 attempts)',
    });
    expect(decide({ statusCode: 503 }, 7, policy, NOW, always(0)).kind).toBe('retry');
  });

  it('honours Retry-After in seconds and as an HTTP date', () => {
    expect(decide({ statusCode: 429, retryAfterHeader: '30' }, 1, policy, NOW)).toMatchObject({
      delayMs: 30_000,
    });
    const in90s = new Date(NOW + 90_000).toUTCString();
    expect(decide({ statusCode: 503, retryAfterHeader: in90s }, 1, policy, NOW)).toMatchObject({
      delayMs: 90_000,
    });
  });

  it('caps a hostile Retry-After at the maximum delay', () => {
    const outcome = decide({ statusCode: 503, retryAfterHeader: '86400' }, 1, policy, NOW);
    expect(outcome).toMatchObject({ delayMs: policy.maxMs });
  });
});

describe('backoff', () => {
  it('is full jitter: between 0 and base * 2^(attempt-1)', () => {
    expect(backoff(1, 1_000, 600_000, always(0))).toBe(0);
    expect(backoff(1, 1_000, 600_000, always(1))).toBe(1_000);
    expect(backoff(4, 1_000, 600_000, always(1))).toBe(8_000);
  });

  it('never exceeds the cap', () => {
    expect(backoff(30, 1_000, 600_000, always(1))).toBe(600_000);
  });
});

describe('parseRetryAfter', () => {
  it.each([
    [null, undefined],
    ['', undefined],
    ['soon', undefined],
    ['0', 0],
    ['120', 120_000],
  ])('%j -> %j', (header, expected) => {
    expect(parseRetryAfter(header, NOW)).toBe(expected);
  });

  it('treats a date in the past as "now"', () => {
    expect(parseRetryAfter(new Date(NOW - 5_000).toUTCString(), NOW)).toBe(0);
  });
});
