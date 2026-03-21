import { useEffect, useRef, type ReactNode } from 'react';

interface ErrorOverlayProps {
  type: 'error' | 'success';
  messages: ReactNode[];
  onDismiss: () => void;
  className?: string;
}

export function ErrorOverlay({ type, messages, onDismiss, className = '' }: ErrorOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    containerRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onDismiss]);

  return (
    <div
      ref={containerRef}
      className={`error-overlay-container ${className}`}
      tabIndex={-1}
    >
      <div className={`error-overlay ${type}`}>
        <div className="error-overlay-header">
          <span className="error-overlay-icon">{type === 'error' ? '✕' : '✓'}</span>
          <span>{type === 'error' ? 'Operation Failed' : 'Success'}</span>
        </div>
        <div className="error-overlay-messages">
          {messages.map((msg, i) => (
            <p key={i} className="error-overlay-text">{msg}</p>
          ))}
        </div>
        <button
          className="btn btn-sm btn-secondary"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
