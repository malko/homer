import { useState, useRef, useEffect, ReactNode } from 'react';
import { SearchIcon, SortIcon, ArrowUpIcon, ArrowDownIcon, XIcon, InfoIcon } from './Icons';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Rechercher...', title }: SearchInputProps) {
  return (
    <div className="containers-search" title={title}>
      <SearchIcon size={16} className="search-icon" />
      <input
        type="text"
        className="input search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button 
          className="search-clear" 
          onClick={() => onChange('')}
          title="Effacer la recherche"
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  title?: string;
}

export function FilterSelect({ value, onChange, options, placeholder = 'Tous', title }: FilterSelectProps) {
  const isActive = value !== 'all' && value !== '';

  return (
    <div className="filter-select-wrapper" title={title}>
      <select 
        className="input project-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="all">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {isActive && (
        <button 
          className="filter-select-clear" 
          onClick={() => onChange('all')}
          title="Réinitialiser le filtre"
        >
          <XIcon size={12} />
        </button>
      )}
    </div>
  );
}

interface SortMenuProps {
  currentSort: string;
  sortDirection: string;
  onSortChange: (sort: string) => void;
  onDirectionChange: (dir: string) => void;
  options?: { value: string; label: string }[];
  showDirectionHint?: boolean;
}

export function SortMenu({ 
  currentSort, 
  sortDirection, 
  onSortChange, 
  onDirectionChange,
  options,
  showDirectionHint = false
}: SortMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  const defaultOptions: { value: string; label: string }[] = options || [
    { value: 'name', label: 'Nom' },
    { value: 'project', label: 'Projet' },
    { value: 'size', label: 'Taille' },
    { value: 'created', label: 'Date' },
  ];

  return (
    <div className="sort-menu-wrapper">
      <button 
        className={`btn btn-icon-only ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Trier"
      >
        <SortIcon size={16} direction={sortDirection as 'asc' | 'desc' | 'none'} />
      </button>
      {isOpen && (
        <>
          <div className="sort-menu-backdrop" onClick={() => setIsOpen(false)} />
          <div className="sort-menu">
            <div className="sort-menu-section">Trier par</div>
            {defaultOptions.map((option) => (
              <button
                key={option.value}
                className={`sort-menu-item ${currentSort === option.value ? 'active' : ''}`}
                onClick={() => {
                  if (currentSort === option.value && sortDirection === 'asc') {
                    onDirectionChange('desc');
                  } else if (currentSort === option.value && sortDirection === 'desc') {
                    onDirectionChange('asc');
                  } else {
                    onSortChange(option.value);
                    onDirectionChange('asc');
                  }
                  setIsOpen(false);
                }}
              >
                {currentSort === option.value && sortDirection === 'asc' && (
                  <ArrowUpIcon size={12} />
                )}
                {currentSort === option.value && sortDirection === 'desc' && (
                  <ArrowDownIcon size={12} />
                )}
                {option.label}
                {showDirectionHint && currentSort === option.value && (
                  <span className="sort-direction-hint">
                    {sortDirection === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface InfoTooltipProps {
  children: ReactNode;
}

export function InfoTooltip({ children }: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, transform: '' });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

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
        onClick={() => setIsOpen(!isOpen)}
        title="En savoir plus"
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