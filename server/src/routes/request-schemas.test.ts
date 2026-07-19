import { describe, it, expect } from 'vitest';
import { systemSettingsSchema, addToNetworkSchema } from './request-schemas.js';

describe('systemSettingsSchema', () => {
  it('accepts a valid partial payload and strips unknown keys', () => {
    const r = systemSettingsSchema.safeParse({ autoUpdate: true, updateCheckInterval: 720, bogus: 1 });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ autoUpdate: true, updateCheckInterval: 720 });
  });

  it('rejects wrong types', () => {
    expect(systemSettingsSchema.safeParse({ autoUpdate: 'yes' }).success).toBe(false);
    expect(systemSettingsSchema.safeParse({ updateCheckInterval: 1.5 }).success).toBe(false);
    expect(systemSettingsSchema.safeParse({ homerDisableHttp: 'true' }).success).toBe(false);
  });

  it('accepts an empty object', () => {
    expect(systemSettingsSchema.safeParse({}).success).toBe(true);
  });
});

describe('addToNetworkSchema', () => {
  it('accepts an array of service names or nothing', () => {
    expect(addToNetworkSchema.safeParse({ services: ['web', 'db'] }).success).toBe(true);
    expect(addToNetworkSchema.safeParse({}).success).toBe(true);
  });

  it('rejects non-string service entries', () => {
    expect(addToNetworkSchema.safeParse({ services: [1, 2] }).success).toBe(false);
    expect(addToNetworkSchema.safeParse({ services: 'web' }).success).toBe(false);
  });
});
