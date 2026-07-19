/**
 * Decides how a password-change request must be handled.
 *
 * A logged-in session alone must NOT be enough to set a new password: the
 * current password has to be re-entered and verified. The only exception is a
 * forced rotation (`must_change_password`), e.g. right after an admin reset,
 * where the user has no usable "current" password to prove.
 */
export type PasswordChangeDecision =
  | { action: 'reject'; reason: string }
  | { action: 'verify' }
  | { action: 'allow' };

export function decidePasswordChange(
  mustChangePassword: boolean,
  currentPassword: string | undefined | null,
): PasswordChangeDecision {
  if (mustChangePassword) return { action: 'allow' };
  if (!currentPassword) return { action: 'reject', reason: 'Current password is required' };
  return { action: 'verify' };
}
