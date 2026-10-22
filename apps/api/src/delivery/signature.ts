import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks signing (https://www.standardwebhooks.com/):
 * signature = base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)), where key is the
 * base64-decoded part of the `whsec_` secret.
 */
const PREFIX = 'whsec_';

export function generateSecret(): string {
  return PREFIX + randomBytes(24).toString('base64');
}

export interface SignatureInput {
  secret: string;
  messageId: string;
  /** Unix seconds. */
  timestamp: number;
  body: Buffer | string;
}

export function sign({ secret, messageId, timestamp, body }: SignatureInput): string {
  const key = Buffer.from(
    secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret,
    'base64',
  );
  const mac = createHmac('sha256', key)
    .update(`${messageId}.${timestamp}.`)
    .update(body)
    .digest('base64');
  return `v1,${mac}`;
}

export function signatureHeaders(input: SignatureInput): Record<string, string> {
  return {
    'webhook-id': input.messageId,
    'webhook-timestamp': String(input.timestamp),
    'webhook-signature': sign(input),
  };
}

/**
 * Receiver-side check, used by the mock receiver and in tests. Accepts any of the
 * space-separated signatures (providers send several during secret rotation).
 */
export function verify(
  input: Omit<SignatureInput, 'timestamp'> & { timestamp: string; signatureHeader: string },
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  const ts = Number(input.timestamp);
  if (!Number.isInteger(ts) || Math.abs(now / 1000 - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(sign({ ...input, timestamp: ts }));
  return input.signatureHeader.split(' ').some((candidate) => {
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
