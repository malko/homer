import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature } from './peers.js';

const SECRET = 'a'.repeat(64);

describe('verifySignature', () => {
  it('accepts a valid signature exactly once', () => {
    const ts = Date.now();
    const body = JSON.stringify({ action: 'restart', id: 'homer-caddy' });
    const sig = signPayload(SECRET, body, ts);

    expect(verifySignature(SECRET, body, ts, sig)).toBe(true);
    // Replaying the same captured signature must be rejected.
    expect(verifySignature(SECRET, body, ts, sig)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const ts = Date.now();
    const body = '{}';
    const sig = signPayload('b'.repeat(64), body, ts);
    expect(verifySignature(SECRET, body, ts, sig)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const ts = Date.now();
    const sig = signPayload(SECRET, '{"amount":1}', ts);
    expect(verifySignature(SECRET, '{"amount":1000000}', ts, sig)).toBe(false);
  });

  it('rejects timestamps outside the skew window', () => {
    const ts = Date.now() - 120_000; // 2 minutes old
    const body = '{}';
    const sig = signPayload(SECRET, body, ts);
    expect(verifySignature(SECRET, body, ts, sig)).toBe(false);
  });

  it('rejects non-finite timestamps and malformed signatures', () => {
    const ts = Date.now();
    expect(verifySignature(SECRET, '{}', NaN, signPayload(SECRET, '{}', ts))).toBe(false);
    expect(verifySignature(SECRET, '{}', ts, 'not-hex')).toBe(false);
  });
});
