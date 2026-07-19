import { describe, it, expect } from 'vitest';
import { isRequestAuthorized, bearerToken } from './require-session.js';

describe('bearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
  });

  it('rejects missing or malformed headers', () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken('')).toBeUndefined();
    expect(bearerToken('abc123')).toBeUndefined();
    expect(bearerToken('Bearer ')).toBeUndefined();
    expect(bearerToken('Basic abc123')).toBeUndefined();
  });
});

describe('isRequestAuthorized', () => {
  const validTokens = new Set(['good-token']);
  const hasSession = (t: string) => validTokens.has(t);

  it('allows signed peer requests without a session', () => {
    expect(isRequestAuthorized(true, undefined, hasSession)).toBe(true);
  });

  it('allows a request carrying a valid session token', () => {
    expect(isRequestAuthorized(false, 'good-token', hasSession)).toBe(true);
  });

  it('rejects a missing or unknown token', () => {
    expect(isRequestAuthorized(false, undefined, hasSession)).toBe(false);
    expect(isRequestAuthorized(false, 'bogus', hasSession)).toBe(false);
  });
});
