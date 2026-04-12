import React, { useState, useCallback } from 'react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

interface ConfirmResult {
  (options: ConfirmOptions): Promise<boolean>;
}

interface UseConfirmReturn {
  ConfirmDialog: () => React.ReactElement | null;
  confirm: ConfirmResult;
}

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  type: 'danger' | 'warning' | 'info';
  resolve: ((value: boolean) => void) | null;
}

export function useConfirm(): UseConfirmReturn {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    title: 'Confirmation',
    message: '',
    confirmText: 'Confirmer',
    cancelText: 'Annuler',
    type: 'danger',
    resolve: null,
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        title: options.title || 'Confirmation',
        message: options.message,
        confirmText: options.confirmText || 'Confirmer',
        cancelText: options.cancelText || 'Annuler',
        type: options.type || 'danger',
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState(s => ({ ...s, isOpen: false, resolve: null }));
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState(s => ({ ...s, isOpen: false, resolve: null }));
  }, [state.resolve]);

  const ConfirmDialog = useCallback(() => {
    if (!state.isOpen) return null;

    return (
      <div className="confirm-overlay" onClick={handleCancel}>
        <div className="confirm-modal" onClick={e => e.stopPropagation()}>
          <div className="confirm-header">
            <span className={`confirm-icon confirm-icon-${state.type}`}>
              {state.type === 'danger' && '⚠'}
              {state.type === 'warning' && '⚡'}
              {state.type === 'info' && 'ℹ'}
            </span>
            <h3 className="confirm-title">{state.title}</h3>
          </div>
          
          <p className="confirm-message">{state.message}</p>
          
          <div className="confirm-actions">
            <button className="btn btn-secondary" onClick={handleCancel}>
              {state.cancelText}
            </button>
            <button 
              className={`btn ${state.type === 'danger' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
            >
              {state.confirmText}
            </button>
          </div>
        </div>
      </div>
    );
  }, [state, handleConfirm, handleCancel]);

  return { ConfirmDialog, confirm };
}