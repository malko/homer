import { useTheme } from '../hooks/useTheme';
import { useProjectUpdates } from '../hooks/useProjectUpdates';
import { useMobileSidebar, useIsMobile } from '../hooks/useMobileSidebar';
import { PeerSelector } from './PeerSelector';

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function BurgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

interface AppHeaderProps {
  title?: string;
  stats?: string;
  children?: React.ReactNode;
}

export function AppHeader({ title, stats, children }: AppHeaderProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { hasUpdates, updates, setShowModal } = useProjectUpdates();
  const { open: openMobileSidebar } = useMobileSidebar();
  const isMobile = useIsMobile();

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '0.5rem' : '1rem' }}>
        {isMobile && (
          <button className="header-burger-btn" onClick={openMobileSidebar} title="Ouvrir le menu">
            <BurgerIcon />
          </button>
        )}
        {title && <span className="header-title">{title}</span>}
        {stats && <span className="header-stats">{stats}</span>}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <PeerSelector />
        {children}
        {hasUpdates && (
          <button
            className="updates-badge-btn"
            onClick={() => setShowModal(true)}
            title={`${updates.length} projet(s) avec mises à jour`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="updates-badge-count">{updates.length}</span>
          </button>
        )}
        <button
          className="header-theme-btn"
          onClick={toggleTheme}
          title={resolvedTheme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        >
          {resolvedTheme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}