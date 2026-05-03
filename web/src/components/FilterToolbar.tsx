import { useState, useRef, useEffect, ReactNode } from 'react';
import { SearchIcon, SortIcon, ArrowUpIcon, ArrowDownIcon, XIcon, InfoIcon } from './Icons';
import { InfoTooltip } from './InfoTooltip';

// Re-export for backward compatibility
export { InfoTooltip };

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

// InfoTooltip is now imported from ./InfoTooltip