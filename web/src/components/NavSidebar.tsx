import { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import bigiconImage from '@assets/bigicon.png';

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function MenuExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function MenuCollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function NavSidebar() {
  const { logout, status } = useAuth();
  const [expanded, setExpanded] = useState(() => {
    return localStorage.getItem('nav-sidebar-expanded') === 'true';
  });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const toggleExpanded = () => {
    setExpanded(prev => {
      const next = !prev;
      localStorage.setItem('nav-sidebar-expanded', String(next));
      return next;
    });
  };

  // Close user menu when clicking outside
  useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu]);

  const initials = status?.username
    ? status.username.slice(0, 2).toUpperCase()
    : '??';

  return (
    <nav className={`nav-sidebar${expanded ? ' nav-sidebar--expanded' : ''}`}>
      {/* Header — same height as app-header, borders align */}
      <div className="nav-sidebar-header">
        <NavLink to="/home" className="nav-sidebar-logo-link">
          <img src={bigiconImage} alt="HOMER" width="28" height="28" />
        </NavLink>
        <span className="nav-sidebar-brand">HOMER</span>
      </div>

      {/* Main nav */}
      <div className="nav-sidebar-nav">
        <NavLink
          to="/home"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><HomeIcon /></span>
          <span className="nav-sidebar-label">Accueil</span>
        </NavLink>

        <NavLink
          to="/projects"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><ProjectsIcon /></span>
          <span className="nav-sidebar-label">Projets</span>
        </NavLink>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Toggle button — always accessible */}
        <button
          className="nav-sidebar-item nav-sidebar-toggle-btn"
          onClick={toggleExpanded}
          title={expanded ? 'Réduire le menu' : 'Développer le menu'}
        >
          <span className="nav-sidebar-icon">
            {expanded ? <MenuCollapseIcon /> : <MenuExpandIcon />}
          </span>
          <span className="nav-sidebar-label">Réduire</span>
        </button>
      </div>

      {/* Bottom actions */}
      <div className="nav-sidebar-bottom">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><SettingsIcon /></span>
          <span className="nav-sidebar-label">Paramètres</span>
        </NavLink>

        {/* User section with dropdown */}
        <div className="nav-sidebar-user-wrap" ref={userMenuRef}>
          {showUserMenu && (
            <div className="nav-sidebar-user-menu">
              <button className="nav-sidebar-user-menu-item" onClick={() => { logout(); setShowUserMenu(false); }}>
                <LogoutIcon />
                <span>Déconnexion</span>
              </button>
            </div>
          )}
          <button
            className={`nav-sidebar-user nav-sidebar-user-btn${showUserMenu ? ' nav-sidebar-user-btn--active' : ''}`}
            onClick={() => setShowUserMenu(v => !v)}
            title={status?.username}
          >
            <div className="nav-sidebar-avatar">{initials}</div>
            <span className="nav-sidebar-label nav-sidebar-username">{status?.username}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
