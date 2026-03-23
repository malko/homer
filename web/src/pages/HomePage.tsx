import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { api } from '../api';
import type { Project, HomeTileOverride } from '../api';
import bigiconImage from '@assets/bigicon.png';

// ─── Tile model ───────────────────────────────────────────────────────────────

interface Tile {
  projectId: number;
  projectName: string;
  serviceKey: string;
  defaultName: string;
  url: string;
  isRunning: boolean;
  displayName: string | null;
  icon: string | null;
  iconBg: string | null;
  cardBg: string | null;
  hidden: boolean;
}

function buildTiles(projects: Project[], overrides: HomeTileOverride[]): Tile[] {
  const overrideMap = new Map<string, HomeTileOverride>();
  for (const o of overrides) overrideMap.set(`${o.project_id}:${o.service_key}`, o);

  const tiles: Tile[] = [];
  const host = window.location.hostname;

  for (const project of projects) {
    if (project.url) {
      const ov = overrideMap.get(`${project.id}:url`);
      tiles.push({
        projectId: project.id,
        projectName: project.name,
        serviceKey: 'url',
        defaultName: project.name,
        url: project.url,
        isRunning: project.containers.some(c => c.state === 'running'),
        displayName: ov?.display_name ?? null,
        icon: ov?.icon ?? project.icon,
        iconBg: ov?.icon_bg ?? null,
        cardBg: ov?.card_bg ?? null,
        hidden: !!(ov?.hidden),
      });
    }

    const seenPorts = new Set<string>();
    for (const container of project.containers) {
      for (const port of container.ports ?? []) {
        if (seenPorts.has(port)) continue;
        seenPorts.add(port);
        if (project.url) {
          try {
            const u = new URL(project.url);
            if (u.port === port || (!u.port && (port === '80' || port === '443'))) continue;
          } catch {}
        }
        const serviceKey = `port:${port}`;
        const ov = overrideMap.get(`${project.id}:${serviceKey}`);
        const protocol = port === '443' ? 'https' : 'http';
        tiles.push({
          projectId: project.id,
          projectName: project.name,
          serviceKey,
          defaultName: container.name,
          url: `${protocol}://${host}:${port}`,
          isRunning: container.state === 'running',
          displayName: ov?.display_name ?? null,
          icon: ov?.icon ?? null,
          iconBg: ov?.icon_bg ?? null,
          cardBg: ov?.card_bg ?? null,
          hidden: !!(ov?.hidden),
        });
      }
    }
  }

  return tiles;
}

// ─── Tile icon ────────────────────────────────────────────────────────────────

function TileIcon({ tile, size = 52 }: { tile: Tile; size?: number }) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const name = tile.displayName ?? tile.defaultName;
  const bgStyle = tile.iconBg ? { backgroundColor: tile.iconBg, borderRadius: '10px', padding: '4px' } : {};

  if (tile.icon) {
    return (
      <div style={bgStyle}>
        <img src={tile.icon} alt="" className="service-tile-icon" style={{ width: size, height: size }} />
      </div>
    );
  }

  if (!faviconFailed) {
    let faviconUrl: string | null = null;
    try { faviconUrl = new URL('/favicon.ico', tile.url).href; } catch {}
    if (faviconUrl) {
      return (
        <div style={bgStyle}>
          <img
            src={faviconUrl}
            alt=""
            className="service-tile-icon"
            style={{ width: size, height: size }}
            onError={() => setFaviconFailed(true)}
          />
        </div>
      );
    }
  }

  return (
    <div
      className="service-tile-icon service-tile-icon-letter"
      style={{ width: size, height: size, ...(tile.iconBg ? { backgroundColor: tile.iconBg } : {}) }}
    >
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

// ─── Color picker row ─────────────────────────────────────────────────────────

function ColorRow({
  label,
  value,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', width: '90px', flexShrink: 0 }}>{label}</span>
      <div
        onClick={() => inputRef.current?.click()}
        style={{
          width: '28px', height: '28px', borderRadius: '6px', flexShrink: 0, cursor: 'pointer',
          border: '2px solid var(--color-border)',
          backgroundColor: value || 'transparent',
          backgroundImage: value ? 'none' : 'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 8px 8px',
        }}
        title="Pick color"
      />
      <input
        ref={inputRef}
        type="color"
        value={value || '#1e293b'}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />
      <input
        type="text"
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="e.g. #1e293b or transparent"
        style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', flex: 1, fontFamily: 'monospace' }}
      />
      {value && (
        <button className="btn btn-sm btn-secondary" onClick={onClear} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  tile: Tile;
  onClose: () => void;
  onSave: (tile: Tile, patch: { displayName: string | null; icon: string | null; iconBg: string | null; cardBg: string | null; hidden: boolean }) => Promise<void>;
}

function EditModal({ tile, onClose, onSave }: EditModalProps) {
  const [displayName, setDisplayName] = useState(tile.displayName ?? '');
  const [icon, setIcon] = useState(tile.icon ?? '');
  const [iconBg, setIconBg] = useState(tile.iconBg ?? '');
  const [cardBg, setCardBg] = useState(tile.cardBg ?? '');
  const [iconPreviewError, setIconPreviewError] = useState(false);
  const [hidden, setHidden] = useState(tile.hidden);
  const [saving, setSaving] = useState(false);
  const [faviconLoading, setFaviconLoading] = useState(false);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setIcon(reader.result as string); setIconPreviewError(false); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleFetchFavicon = async () => {
    setFaviconLoading(true);
    try {
      const { dataUri } = await api.home.fetchFavicon(tile.url);
      setIcon(dataUri);
      setIconPreviewError(false);
    } catch {
      // silently ignore — favicon not available
    } finally {
      setFaviconLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(tile, {
      displayName: displayName.trim() || null,
      icon: icon.trim() || null,
      iconBg: iconBg.trim() || null,
      cardBg: cardBg.trim() || null,
      hidden,
    });
    setSaving(false);
    onClose();
  };

  const previewTile: Tile = { ...tile, displayName: displayName.trim() || null, icon: icon.trim() || null, iconBg: iconBg.trim() || null, cardBg: cardBg.trim() || null };
  const previewName = displayName.trim() || tile.defaultName;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Edit — {tile.projectName}{tile.serviceKey !== 'url' ? ` (${tile.serviceKey})` : ''}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {/* Preview */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <div
            className="service-tile"
            style={{
              width: '130px',
              pointerEvents: 'none',
              ...(previewTile.cardBg ? { backgroundColor: previewTile.cardBg } : {}),
            }}
          >
            <div className="service-tile-link" style={{ padding: '1rem' }}>
              <TileIcon tile={previewTile} />
              <div className="service-tile-name">{previewName}</div>
              <div className="service-tile-meta">
                <span className={`status-dot-lg ${tile.isRunning ? 'dot-running' : 'dot-stopped'}`} style={{ width: '8px', height: '8px' }} />
                <span>{tile.isRunning ? 'running' : 'stopped'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Display name */}
        <div className="input-group">
          <label className="input-label">Display name</label>
          <input
            type="text"
            className="input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={tile.defaultName}
            autoFocus
          />
        </div>

        {/* Icon */}
        <div className="input-group" style={{ marginTop: '1rem' }}>
          <label className="input-label">Icon</label>
          <div className="icon-picker">
            {icon && !iconPreviewError ? (
              <img src={icon} alt="" className="icon-picker-preview" onError={() => setIconPreviewError(true)} />
            ) : (
              <div className="icon-picker-letter">{previewName[0]?.toUpperCase() ?? '?'}</div>
            )}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <input
                type="url"
                className="input"
                value={icon}
                onChange={e => { setIcon(e.target.value); setIconPreviewError(false); }}
                placeholder="https://example.com/icon.png"
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}
              />
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleFetchFavicon}
                  disabled={faviconLoading}
                  style={{ flex: 1, fontSize: '0.75rem' }}
                  title={`Try to fetch favicon from ${tile.url}`}
                >
                  {faviconLoading ? 'Fetching…' : '⬇ Use service favicon'}
                </button>
                <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer', fontSize: '0.75rem', flex: 1, textAlign: 'center' }}>
                  ↑ Upload file
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
                </label>
                {icon && (
                  <button className="btn btn-sm btn-secondary" onClick={() => { setIcon(''); setIconPreviewError(false); }} style={{ fontSize: '0.75rem' }}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Colors */}
        <div className="input-group" style={{ marginTop: '1rem' }}>
          <label className="input-label">Colors</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', padding: '0.75rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
            <ColorRow
              label="Icon background"
              value={iconBg}
              onChange={setIconBg}
              onClear={() => setIconBg('')}
            />
            <ColorRow
              label="Card background"
              value={cardBg}
              onChange={setCardBg}
              onClear={() => setCardBg('')}
            />
          </div>
        </div>

        {/* Hidden toggle */}
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Hide from home page</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>Reveal with the "Show hidden" toggle</div>
          </div>
          <div className={`toggle ${hidden ? 'active' : ''}`} onClick={() => setHidden(h => !h)}>
            <div className="toggle-handle" />
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: '1.25rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Service tile card ────────────────────────────────────────────────────────

function ServiceTileCard({ tile, onEdit }: { tile: Tile; onEdit: (tile: Tile) => void }) {
  const navigate = useNavigate();
  const dotClass = tile.isRunning ? 'dot-running' : 'dot-stopped';

  return (
    <div
      className={`service-tile${tile.hidden ? ' service-tile-hidden' : ''}`}
      style={tile.cardBg ? { backgroundColor: tile.cardBg } : {}}
    >
      <div className="service-tile-actions">
        <button
          className="tile-action-btn"
          title="Manage project"
          onClick={() => navigate(`/projects?select=${tile.projectId}`)}
        >⚙</button>
        <button
          className="tile-action-btn"
          title="Edit tile"
          onClick={() => onEdit(tile)}
        >✎</button>
      </div>
      <a href={tile.url} target="_blank" rel="noopener noreferrer" className="service-tile-link">
        <TileIcon tile={tile} />
        <div className="service-tile-name">{tile.displayName ?? tile.defaultName}</div>
        <div className="service-tile-meta">
          <span className={`status-dot-lg ${dotClass}`} style={{ width: '8px', height: '8px', flexShrink: 0 }} />
          <span>{tile.isRunning ? 'running' : 'stopped'}</span>
        </div>
        <div className="service-tile-url">{tile.url}</div>
      </a>
    </div>
  );
}

// ─── Home page ────────────────────────────────────────────────────────────────

export function HomePage() {
  const { projects, refetch: refetchProjects } = useProjects();
  const { logout, status } = useAuth();
  const [overrides, setOverrides] = useState<HomeTileOverride[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [editingTile, setEditingTile] = useState<Tile | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const fetchOverrides = useCallback(async () => {
    try { setOverrides(await api.home.getTiles()); } catch {}
  }, []);

  useEffect(() => { fetchOverrides(); }, [fetchOverrides]);

  useWebSocket(msg => {
    if (msg.type === 'containers_updated' || msg.type === 'project_updated') refetchProjects();
  });

  const allTiles = buildTiles(projects, overrides);
  const hiddenCount = allTiles.filter(t => t.hidden).length;
  const visibleTiles = showHidden ? allTiles : allTiles.filter(t => !t.hidden);

  const handleSaveTile = async (tile: Tile, patch: { displayName: string | null; icon: string | null; iconBg: string | null; cardBg: string | null; hidden: boolean }) => {
    await api.home.updateTile(tile.projectId, tile.serviceKey, {
      display_name: patch.displayName,
      icon: patch.icon,
      icon_bg: patch.iconBg,
      card_bg: patch.cardBg,
      hidden: patch.hidden,
    });
    await fetchOverrides();
  };

  return (
    <div className="layout">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src={bigiconImage} alt="" className="header-icon" />
          <div>
            <h1 className="page-title">HOMER</h1>
            <p className="page-subtitle"><span className="accent">Hom</span>elab manag<span className="accent">er</span></p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {hiddenCount > 0 && (
            <button className="btn btn-sm btn-secondary" onClick={() => setShowHidden(v => !v)}>
              {showHidden ? `Hide hidden (${hiddenCount})` : `Show hidden (${hiddenCount})`}
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <button className="user-menu-trigger" onClick={e => { e.stopPropagation(); setShowUserMenu(v => !v); }}>
              <span>{status?.username}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.6 }}>
                <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {showUserMenu && (
              <div className="user-dropdown" onClick={() => setShowUserMenu(false)}>
                <div className="user-dropdown-username">{status?.username}</div>
                <button className="user-dropdown-logout" onClick={logout}>Logout</button>
              </div>
            )}
          </div>
          <Link to="/projects" className="btn btn-primary btn-sm">Manage Projects</Link>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
        {allTiles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏠</div>
            <h3>No services yet</h3>
            <p>Deploy projects with exposed ports or add a URL to display them here</p>
            <Link to="/projects" className="btn btn-primary" style={{ marginTop: '1rem' }}>Go to Projects</Link>
          </div>
        ) : (
          <div className="service-grid">
            {visibleTiles.map(tile => (
              <ServiceTileCard
                key={`${tile.projectId}:${tile.serviceKey}`}
                tile={tile}
                onEdit={setEditingTile}
              />
            ))}
          </div>
        )}
      </div>

      {editingTile && (
        <EditModal tile={editingTile} onClose={() => setEditingTile(null)} onSave={handleSaveTile} />
      )}
    </div>
  );
}
