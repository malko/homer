import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import bigiconImage from '@assets/bigicon.png';

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function NavSidebar() {
  const { logout, status } = useAuth();

  const initials = status?.username
    ? status.username.slice(0, 2).toUpperCase()
    : '??';

  return (
    <nav className="nav-sidebar">
      <div className="nav-sidebar-top">
        <NavLink to="/home" className="nav-sidebar-logo" title="HOMER">
          <img src={bigiconImage} alt="HOMER" width="32" height="32" />
        </NavLink>
      </div>

      <div className="nav-sidebar-nav">
        <NavLink
          to="/home"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <HomeIcon />
          <span className="nav-sidebar-tooltip">Accueil</span>
        </NavLink>

        <NavLink
          to="/projects"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <ProjectsIcon />
          <span className="nav-sidebar-tooltip">Projets</span>
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')
          }
        >
          <SettingsIcon />
          <span className="nav-sidebar-tooltip">Paramètres</span>
        </NavLink>
      </div>

      <div className="nav-sidebar-bottom">
        <div className="nav-sidebar-avatar" title={status?.username}>
          {initials}
        </div>
        <button
          className="nav-sidebar-item nav-sidebar-logout"
          onClick={logout}
          title="Déconnexion"
        >
          <LogoutIcon />
          <span className="nav-sidebar-tooltip">Déconnexion</span>
        </button>
      </div>
    </nav>
  );
}
