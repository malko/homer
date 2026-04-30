import { createContext, useContext } from 'react';
import type { ToastType, Toast } from './useToast.types';

export interface ToastContextValue {
  toasts: Toast[];
  addToast: (type: ToastType, message: string) => void;
  dismissToast: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastContext must be used within a ToastProvider');
  return ctx;
}
