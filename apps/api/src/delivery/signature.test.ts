import { Webhook } from 'standardwebhooks';
import { describe, expect, it } from 'vitest';
import { generateSecret, sign, signatureHeaders, verify } from './signature.js';

// Built at runtime so the fixture never looks like a leaked key to secret scanners.
const secret = `whsec_${Buffer.from('signature-test-key-32-bytes-long').toString('base64')}`;
const body = Buffer.from('{"type":"invoice.paid","amount":4990}');

describe('Standard Webhooks compatibility', () => {
  it('produces signatures the official library accepts', () => {
    const headers = signatureHeaders({
      secret,
      messageId: 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W',
      timestamp: Math.floor(Date.now() / 1000),
      body,
    });

    // Receivers will verify with this library, so this is the test that matters.
    expect(() => new Webhook(secret).verify(body, headers)).not.toThrow();
  });

  it('is rejected by the official library when the body was altered', () => {
    const headers = signatureHeaders({
      secret,
      messageId: 'msg_1',
      timestamp: Math.floor(Date.now() / 1000),
      body,
    });
    expect(() => new Webhook(secret).verify(`${body} `, headers)).toThrow();
  });

  it('generates secrets the official library can load and verify with', () => {
    const fresh = generateSecret();
    expect(fresh).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    const headers = signatureHeaders({
      secret: fresh,
      messageId: 'msg_fresh',
      timestamp: Math.floor(Date.now() / 1000),
      body,
    });
    expect(() => new Webhook(fresh).verify(body, headers)).not.toThrow();
  });
});

describe('verify (receiver side)', () => {
  const ts = 1_761_134_400; // 2025-10-22T12:00:00Z
  const now = ts * 1000;
  const header = sign({ secret, messageId: 'msg_1', timestamp: ts, body });

  it('accepts a valid signature, also among rotated ones', () => {
    const input = { secret, messageId: 'msg_1', timestamp: String(ts), body };
    expect(verify({ ...input, signatureHeader: header }, 300, now)).toBe(true);
    expect(verify({ ...input, signatureHeader: `v1,bm90LXRoaXM= ${header}` }, 300, now)).toBe(true);
  });

  it('rejects a stale timestamp and a different message id', () => {
    const input = {
      secret,
      messageId: 'msg_1',
      timestamp: String(ts),
      body,
      signatureHeader: header,
    };
    expect(verify(input, 300, now + 301_000)).toBe(false);
    expect(verify({ ...input, messageId: 'msg_2' }, 300, now)).toBe(false);
  });
});
