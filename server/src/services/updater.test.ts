import { describe, it, expect } from 'vitest';
import { isNewer, pickLatestVersion, imageChanged } from './updater.js';

describe('isNewer', () => {
  it('compares semver parts', () => {
    expect(isNewer('0.0.21', '0.0.20')).toBe(true);
    expect(isNewer('0.1.0', '0.0.99')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.0.20', '0.0.20')).toBe(false);
    expect(isNewer('0.0.19', '0.0.20')).toBe(false);
  });

  it('never treats dev as updatable', () => {
    expect(isNewer('0.0.21', 'dev')).toBe(false);
  });
});

describe('pickLatestVersion', () => {
  it('returns the highest version, tolerating nulls', () => {
    expect(pickLatestVersion('0.0.20', '0.0.21')).toBe('0.0.21');
    expect(pickLatestVersion('0.0.21', '0.0.20')).toBe('0.0.21');
    expect(pickLatestVersion(null, '0.0.21')).toBe('0.0.21');
    expect(pickLatestVersion('0.0.21', null)).toBe('0.0.21');
    expect(pickLatestVersion(null, null)).toBeNull();
  });
});

describe('imageChanged', () => {
  it('is only true when both IDs are known and differ', () => {
    expect(imageChanged('sha256:a', 'sha256:b')).toBe(true);
    expect(imageChanged('sha256:a', 'sha256:a')).toBe(false);
    expect(imageChanged(null, 'sha256:b')).toBe(false);
    expect(imageChanged('sha256:a', null)).toBe(false);
  });
});
