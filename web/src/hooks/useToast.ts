import { useToastContext } from './ToastContext';
import type { ToastType } from './useToast.types';
import type { ToastContextValue } from './ToastContext';

/**
 * Icons displayed next to the message for each toast type.
 */
export const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✗',
  warning: '!',
};

/**
 * Hook to add/remove toasts anywhere in the app.
 * Must be used within a <ToastProvider>.
 *
 * @example
 * const { addToast, dismissToast } = useToast();
 * addToast('success', 'Mise à jour réussie !');
 */
export function useToast(): ToastContextValue {
  return useToastContext();
}
