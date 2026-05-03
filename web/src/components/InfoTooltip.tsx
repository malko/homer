import { useState, useRef, useEffect, ReactNode } from 'react';
import { InfoIcon } from './Icons';

interface InfoTooltipProps {
  children: ReactNode;
  title?: string;
}

export function InfoTooltip({ children, title }: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, transform: '' });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [buttonId] = useState(() => `tooltip-btn-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!isOpen || !buttonRef.current || !tooltipRef.current) return;

    const button = buttonRef.current;
    const tooltip = tooltipRef.current;
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const padding = 8;
    const maxWidth = 480;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top: number;
    let left: number;
    let transform = '';

    const tooltipWidth = Math.min(maxWidth, viewportWidth - padding * 2);
    const tooltipHeight = tooltipRect.height;

    if (buttonRect.left < viewportWidth / 2) {
      left = Math.max(padding, buttonRect.left);
      if (left + tooltipWidth > viewportWidth - padding) {
        left = viewportWidth - padding - tooltipWidth;
      }
    } else {
      left = Math.max(padding, buttonRect.right - tooltipWidth);
      if (left < padding) {
        left = padding;
      }
    }

    const spaceBelow = viewportHeight - buttonRect.bottom - padding;
    const spaceAbove = buttonRect.top - padding;

    if (spaceBelow >= tooltipHeight + padding || spaceBelow >= spaceAbove) {
      top = buttonRect.bottom + padding;
      transform = 'none';
    } else {
      top = Math.max(padding, buttonRect.top - tooltipHeight - padding);
      transform = 'none';
    }

    top = Math.min(top, viewportHeight - tooltipHeight - padding);
    top = Math.max(padding, top);

    setPosition({ top, left, transform });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  return (
    <div className="info-tooltip-wrapper">
      <button
        ref={buttonRef}
        className={`btn btn-icon-only ${isOpen ? 'active' : ''}`}
        onClick={(e) => {setIsOpen(!isOpen); e.preventDefault()}}
        title={title || "En savoir plus"}
      >
        <InfoIcon size={16} />
      </button>
      {isOpen && (
        <>
          <div className="info-tooltip-backdrop" onClick={() => setIsOpen(false)} />
          <div
            ref={tooltipRef}
            className="info-tooltip"
            style={{
              top: position.top,
              left: position.left,
              transform: position.transform,
            }}
          >
            <button className="info-tooltip-close" onClick={() => setIsOpen(false)}>
              <XIcon size={14} />
            </button>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function XIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
