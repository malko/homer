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
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function VolumesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function NetworksIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function ContainerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function ProxyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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
          to="/monitor"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><MonitorIcon /></span>
          <span className="nav-sidebar-label">Moniteur</span>
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

        <NavLink
          to="/containers"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><ContainerIcon /></span>
          <span className="nav-sidebar-label">Containers</span>
        </NavLink>

        <NavLink
          to="/volumes"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><VolumesIcon /></span>
          <span className="nav-sidebar-label">Volumes</span>
        </NavLink>

        <NavLink
          to="/networks"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><NetworksIcon /></span>
          <span className="nav-sidebar-label">Réseaux</span>
        </NavLink>

        <NavLink
          to="/images"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><ImageIcon /></span>
          <span className="nav-sidebar-label">Images</span>
        </NavLink>

        <NavLink
          to="/proxy"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <span className="nav-sidebar-icon"><ProxyIcon /></span>
          <span className="nav-sidebar-label">Proxy</span>
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
