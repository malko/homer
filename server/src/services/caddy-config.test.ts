import { describe, it, expect } from 'vitest';
import { constrainCaddyConfig, isPlainObject } from './caddy-config.js';

const ADMIN = 'http://caddy:2019';

describe('constrainCaddyConfig', () => {
  it('forces the admin origin restriction on a user-supplied config', () => {
    const out = constrainCaddyConfig({ apps: { http: { servers: {} } } }, ADMIN);
    expect(out.admin).toEqual({ origins: [ADMIN], listen: '0.0.0.0:2019' });
    // The rest of the config is preserved.
    expect(out.apps).toEqual({ http: { servers: {} } });
  });

  it('overrides an attempt to widen or remove admin origins', () => {
    const out = constrainCaddyConfig(
      { admin: { listen: '0.0.0.0:2019', origins: ['*'] } },
      ADMIN,
    );
    expect((out.admin as Record<string, unknown>).origins).toEqual([ADMIN]);
  });

  it('preserves a valid custom listen address', () => {
    const out = constrainCaddyConfig({ admin: { listen: '0.0.0.0:2020' } }, ADMIN);
    expect(out.admin).toEqual({ listen: '0.0.0.0:2020', origins: [ADMIN] });
  });

  it('rejects non-object configs', () => {
    expect(() => constrainCaddyConfig(null, ADMIN)).toThrow();
    expect(() => constrainCaddyConfig([1, 2, 3], ADMIN)).toThrow();
    expect(() => constrainCaddyConfig('load', ADMIN)).toThrow();
    expect(() => constrainCaddyConfig(42, ADMIN)).toThrow();
  });
});

describe('isPlainObject', () => {
  it('distinguishes plain objects from arrays and primitives', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
  });
});
