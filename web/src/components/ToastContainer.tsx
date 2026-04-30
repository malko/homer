import { Toast, ToastType } from '../hooks/useToast.types';

/**
 * Icons displayed next to the message for each toast type.
 * Defined locally so the component stays self-contained.
 */
const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✗',
  warning: '!',
};

/**
 * Props for the ToastContainer component.
 *
 * @property toasts      - Array of toast objects to render (typically from useToast hook)
 * @property onDismiss   - Callback to remove a toast by its id
 */
interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/**
 * Renders the list of active toast notifications.
 * Positioned fixed at the bottom-right of the viewport (styled via .toast-container in CSS).
 * Each toast shows an icon, the message, and a dismiss button.
 *
 * Usage:
 *   const { toasts, dismissToast } = useToast();
 *   <ToastContainer toasts={toasts} onDismiss={dismissToast} />
 */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span style={{ fontWeight: 700 }}>{TOAST_ICONS[toast.type]}</span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button className="toast-dismiss" onClick={() => onDismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
