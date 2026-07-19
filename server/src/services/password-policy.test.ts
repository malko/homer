import { describe, it, expect } from 'vitest';
import { decidePasswordChange } from './password-policy.js';

describe('decidePasswordChange', () => {
  it('rejects a normal change when the current password is missing', () => {
    // Regression: previously omitting currentPassword skipped verification
    // entirely, letting any session set a new password.
    expect(decidePasswordChange(false, undefined)).toEqual({
      action: 'reject',
      reason: 'Current password is required',
    });
    expect(decidePasswordChange(false, '')).toEqual({
      action: 'reject',
      reason: 'Current password is required',
    });
    expect(decidePasswordChange(false, null)).toMatchObject({ action: 'reject' });
  });

  it('requires verification when a current password is supplied', () => {
    expect(decidePasswordChange(false, 'hunter2')).toEqual({ action: 'verify' });
  });

  it('allows a forced rotation without a current password', () => {
    expect(decidePasswordChange(true, undefined)).toEqual({ action: 'allow' });
    expect(decidePasswordChange(true, 'anything')).toEqual({ action: 'allow' });
  });
});
