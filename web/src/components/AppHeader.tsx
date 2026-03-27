import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import bigiconImage from '@assets/bigicon.png';

interface AppHeaderProps {
  stats?: string;
  children?: React.ReactNode;
}

export function AppHeader({ stats, children }: AppHeaderProps) {
  const { logout, status } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close menu on navigation
  useEffect(() => {
    setShowUserMenu(false);
  }, [location.pathname]);

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link to="/home" className="header-logo-link">
          <img src={bigiconImage} alt="" className="header-icon" />
          <div>
            <h1 className="page-title">HOMER</h1>
            <p className="page-subtitle">
              <span className="accent">Hom</span>elab manag<span className="accent">er</span>
            </p>
          </div>
        </Link>
        {stats && <span className="header-stats">{stats}</span>}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <div className="user-menu-container" ref={menuRef}>
          <button
            className="user-menu-trigger"
            onClick={() => setShowUserMenu(v => !v)}
          >
            <span>{status?.username}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.6 }}>
              <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showUserMenu && (
            <div className="user-dropdown">
              <div className="user-dropdown-username">{status?.username}</div>
              <Link
                to="/settings"
                className="user-dropdown-item"
                onClick={() => setShowUserMenu(false)}
              >
                Paramètres
              </Link>
              <button className="user-dropdown-item user-dropdown-logout" onClick={logout}>
                Déconnexion
              </button>
            </div>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}
