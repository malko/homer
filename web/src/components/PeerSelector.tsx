import { useState, useRef, useEffect } from 'react';
import { usePeer } from '../hooks/usePeer';
import { displayName } from '../api';
import type { PeerInstance } from '../api';

function peerLabel(p: PeerInstance): string {
  return displayName(p);
}

function localLabel(): string {
  return window.location.hostname;
}

function PeerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function PeerSelector() {
  const { peers, activePeer, selectPeer } = usePeer();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  if (peers.length === 0) return null;

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const label = activePeer ? peerLabel(activePeer) : localLabel();
  const isOffline = activePeer && activePeer.status !== 'online';
  const triggerClass = isOffline
    ? 'peer-selector-trigger--offline'
    : activePeer
      ? 'peer-selector-trigger--remote'
      : 'peer-selector-trigger--local';

  return (
    <div className="peer-selector" ref={menuRef}>
      <button
        className={`peer-selector-trigger ${triggerClass}`}
        onClick={() => setShowMenu(v => !v)}
        title={activePeer ? `Connecté à ${peerLabel(activePeer)}` : 'Instance locale'}
      >
        <PeerIcon />
        <span className="peer-selector-trigger-label">{label}</span>
        <ChevronIcon />
      </button>
      {showMenu && (
        <div className="peer-selector-menu">
          <button
            className={`peer-selector-menu-item ${!activePeer ? 'peer-selector-menu-item--active' : ''}`}
            onClick={() => { selectPeer(null); setShowMenu(false); }}
          >
            <span className="peer-selector-menu-label">{localLabel()}</span>
          </button>
          {peers.map(p => (
            <button
              key={p.uuid}
              className={`peer-selector-menu-item ${activePeer?.uuid === p.uuid ? 'peer-selector-menu-item--active' : ''} ${p.status !== 'online' ? 'peer-selector-menu-item--offline' : ''}`}
              onClick={() => { if (p.status === 'online') { selectPeer(p); setShowMenu(false); } }}
              disabled={p.status !== 'online'}
            >
              <span className="peer-selector-menu-label">{peerLabel(p)}</span>
              {p.status !== 'online' && <span className="peer-selector-menu-status">(hors ligne)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}