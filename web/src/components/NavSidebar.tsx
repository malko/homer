import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuth } from '../hooks/useAuth';
import { usePeer } from '../hooks/usePeer';
import { useMobileSidebar, useIsMobile } from '../hooks/useMobileSidebar';
import {
  HomeIcon, ProjectsIcon, MonitorIcon, VolumesIcon, NetworksIcon,
  ImagesIcon, ContainerIcon, ProxyIcon, InstancesIcon, SettingsIcon,
  LogoutIcon, UserIcon, MenuExpandIcon, MenuCollapseIcon, MenuCloseIcon,
} from './Icons';
import bigiconImage from '@assets/bigicon.png';

export function NavSidebar() {
  const { logout, status } = useAuth();
  const { pendingPairingCount } = usePeer();
  const { isOpen: mobileOpen, close: closeMobileMenu } = useMobileSidebar();
  const [expanded, setExpanded] = useState(() => {
    return localStorage.getItem('nav-sidebar-expanded') === 'true';
  });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const isMobile = useIsMobile();

  const toggleExpanded = () => {
    if (isMobile) {
      closeMobileMenu();
    } else {
      setExpanded(prev => {
        const next = !prev;
        localStorage.setItem('nav-sidebar-expanded', String(next));
        return next;
      });
    }
  };

  const location = useLocation();
  useEffect(() => {
    closeMobileMenu();
  }, [location.pathname]);

  useEffect(() => {
    if (!showUserMenu) {
      setMenuPos(null);
      return;
    }
    if (userMenuBtnRef.current) {
      const rect = userMenuBtnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.top, left: rect.left });
    }
  }, [showUserMenu]);

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

  const sidebarClasses = [
    'nav-sidebar',
    expanded && 'nav-sidebar--expanded',
    mobileOpen && 'nav-sidebar--open',
  ].filter(Boolean).join(' ');

  const navigate = useNavigate();

  const userMenuPortal = showUserMenu && menuPos ? createPortal(
    <div className="nav-sidebar-user-menu-portal" ref={userMenuRef} style={{ top: menuPos.top - 4, left: menuPos.left + 4 }}>
      <button className="nav-sidebar-user-menu-item" onClick={() => { navigate('/account'); setShowUserMenu(false); closeMobileMenu(); }}>
        <UserIcon size={15} />
        <span>Mon compte</span>
      </button>
      <div className="nav-sidebar-user-menu-separator" />
      <button className="nav-sidebar-user-menu-item" onClick={() => { logout(); setShowUserMenu(false); closeMobileMenu(); }}>
        <LogoutIcon size={15} />
        <span>Déconnexion</span>
      </button>
    </div>,
    document.body
  ) : null;

  return (
    <>
      {mobileOpen && isMobile && (
        <div className="nav-sidebar-mobile-overlay" onClick={closeMobileMenu} />
      )}
      <nav className={sidebarClasses}>
        <div className="nav-sidebar-header">
          {isMobile && (
            <button className="nav-sidebar-close-btn" onClick={closeMobileMenu}>
              <MenuCloseIcon size={18} />
            </button>
          )}
          <NavLink to="/home" className="nav-sidebar-logo-link" onClick={closeMobileMenu}>
            <img src={bigiconImage} alt="HOMER" width="28" height="28" />
          </NavLink>
          <span className="nav-sidebar-brand">HOMER</span>
        </div>

        <div className="nav-sidebar-nav">
          <NavLink to="/home" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><HomeIcon size={18} /></span>
            <span className="nav-sidebar-label">Accueil</span>
          </NavLink>
          <NavLink to="/monitor" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><MonitorIcon size={18} /></span>
            <span className="nav-sidebar-label">Moniteur</span>
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><ProjectsIcon size={18} /></span>
            <span className="nav-sidebar-label">Projets</span>
          </NavLink>
          <NavLink to="/containers" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><ContainerIcon size={18} /></span>
            <span className="nav-sidebar-label">Containers</span>
          </NavLink>
          <NavLink to="/volumes" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><VolumesIcon size={18} /></span>
            <span className="nav-sidebar-label">Volumes</span>
          </NavLink>
          <NavLink to="/networks" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><NetworksIcon size={18} /></span>
            <span className="nav-sidebar-label">Réseaux</span>
          </NavLink>
          <NavLink to="/images" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><ImagesIcon size={18} /></span>
            <span className="nav-sidebar-label">Images</span>
          </NavLink>
          <NavLink to="/proxy" className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><ProxyIcon size={18} /></span>
            <span className="nav-sidebar-label">Proxy</span>
          </NavLink>

          <div style={{ flex: 1 }} />

          {!isMobile && (
            <button
              className="nav-sidebar-item nav-sidebar-toggle-btn"
              onClick={toggleExpanded}
              title={expanded ? 'Réduire le menu' : 'Développer le menu'}
            >
              <span className="nav-sidebar-icon">
                {expanded ? <MenuCollapseIcon size={16} /> : <MenuExpandIcon size={16} />}
              </span>
              <span className="nav-sidebar-label">Réduire</span>
            </button>
          )}
        </div>

        <div className="nav-sidebar-bottom">
          <NavLink to="/settings" className={() => 'nav-sidebar-item' + (location.pathname.startsWith('/settings') && !location.pathname.startsWith('/settings/federation') ? ' nav-sidebar-item--active' : '')} onClick={closeMobileMenu}>
            <span className="nav-sidebar-icon"><SettingsIcon size={18} /></span>
            <span className="nav-sidebar-label">Paramètres</span>
          </NavLink>

          <div className="nav-sidebar-user-wrap">
            <button
              ref={userMenuBtnRef}
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
      {userMenuPortal}
    </>
  );
}