import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { useReachability } from '../hooks/useReachability';
import { AppHeader } from '../components/AppHeader';
import { api } from '../api';
import type { Project, ProxyHost, HomeTileOverride, ExternalTile, ProxyTileOverride, ReachabilityResult } from '../api';

// ─── Tile model ───────────────────────────────────────────────────────────────

interface Tile {
  tileKey: string;
  projectId: number | null;
  projectName: string | null;
  serviceKey: string | null;
  externalId: number | null;
  defaultName: string;
  url: string;
  isRunning: boolean;
  reachable: boolean | null;
  isExternal: boolean;
  displayName: string | null;
  icon: string | null;
  iconBg: string | null;
  cardBg: string | null;
  hidden: boolean;
  sortOrder: number | null;
}

function buildTiles(projects: Project[], overrides: HomeTileOverride[], external: ExternalTile[], proxyHosts: ProxyHost[] = [], proxyOverrides: ProxyTileOverride[] = []): Tile[] {
  const overrideMap = new Map<string, HomeTileOverride>();
  for (const o of overrides) overrideMap.set(`${o.project_id}:${o.service_key}`, o);
  const proxyOverrideMap = new Map<number, ProxyTileOverride>();
  for (const o of proxyOverrides) proxyOverrideMap.set(o.proxy_host_id, o);

  const tiles: Tile[] = [];
  const host = window.location.hostname;

  for (const project of projects) {
    const seenPorts = new Set<string>();
    for (const container of project.containers) {
      for (const port of container.ports ?? []) {
        if (seenPorts.has(port)) continue;
        seenPorts.add(port);
        const serviceKey = `port:${port}`;
        const ov = overrideMap.get(`${project.id}:${serviceKey}`);
        const protocol = port === '443' ? 'https' : 'http';
        tiles.push({
          tileKey: `${project.id}:${serviceKey}`,
          projectId: project.id,
          projectName: project.name,
          serviceKey,
          externalId: null,
          defaultName: container.name,
          url: `${protocol}://${host}:${port}`,
          isRunning: container.state === 'running',
          reachable: null,
          isExternal: false,
          displayName: ov?.display_name ?? null,
          icon: ov?.icon ?? null,
          iconBg: ov?.icon_bg ?? null,
          cardBg: ov?.card_bg ?? null,
          hidden: !!(ov?.hidden),
          sortOrder: ov?.sort_order ?? null,
        });
      }
    }
  }

  // Proxy host tiles (show_on_home)
  for (const ph of proxyHosts) {
    const serviceKey = `proxy:${ph.id}`;
    const project = ph.project_id ? projects.find(p => p.id === ph.project_id) : null;
    const ov = ph.project_id ? overrideMap.get(`${ph.project_id}:${serviceKey}`) : undefined;
    const pov = !ph.project_id ? proxyOverrideMap.get(ph.id) : undefined;
    const anyOv = ov ?? pov;
    tiles.push({
      tileKey: ph.project_id ? `${ph.project_id}:${serviceKey}` : `proxy:${ph.id}`,
      projectId: ph.project_id,
      projectName: project?.name ?? null,
      serviceKey,
      externalId: null,
      defaultName: ph.domain,
      url: `https://${ph.domain}`,
      isRunning: project ? project.containers.some(c => c.state === 'running') : true,
      reachable: null,
      isExternal: false,
      displayName: anyOv?.display_name ?? null,
      icon: anyOv?.icon ?? null,
      iconBg: anyOv?.icon_bg ?? null,
      cardBg: anyOv?.card_bg ?? null,
      hidden: !!(anyOv?.hidden),
      sortOrder: anyOv?.sort_order ?? null,
    });
  }

  for (const ext of external) {
    tiles.push({
      tileKey: `ext:${ext.id}`,
      projectId: null,
      projectName: null,
      serviceKey: null,
      externalId: ext.id,
      defaultName: ext.name,
      url: ext.url,
      isRunning: false,
      reachable: null,
      isExternal: true,
      displayName: null,
      icon: ext.icon,
      iconBg: ext.icon_bg,
      cardBg: ext.card_bg,
      hidden: !!(ext.hidden),
      sortOrder: ext.sort_order,
    });
  }

  // Sort: tiles with explicit sortOrder first (ascending), rest in natural order
  const withOrder = tiles.filter(t => t.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!);
  const withoutOrder = tiles.filter(t => t.sortOrder === null);
  return [...withOrder, ...withoutOrder];
}

// ─── Color utilities ─────────────────────────────────────────────────────────

function isColorDark(color: string): boolean {
  const c = color.trim();
  let r = 0, g = 0, b = 0;
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const full = hex.length === 3
      ? hex.split('').map(x => x + x).join('')
      : hex;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const m = c.match(/\d+/g);
    if (!m || m.length < 3) return false;
    [r, g, b] = m.map(Number);
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

// ─── Tile icon ────────────────────────────────────────────────────────────────

const FORCE_LETTER = '__letter__';

function TileIcon({ tile, size = 52 }: { tile: Tile; size?: number }) {
  const [faviconUri, setFaviconUri] = useState<string | null>(null);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const name = tile.displayName ?? tile.defaultName;
  const bgStyle = tile.iconBg
    ? { backgroundColor: tile.iconBg, borderRadius: '10px', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
    : { display: 'flex', alignItems: 'center', justifyContent: 'center' };

  const forceLetter = tile.icon === FORCE_LETTER;

  useEffect(() => {
    if (forceLetter || tile.icon || !tile.url || faviconFailed) return;
    let cancelled = false;
    const token = localStorage.getItem('token');
    const proxyUrl = `/api/home/favicon?url=${encodeURIComponent(tile.url)}`;
    fetch(proxyUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((data: { dataUri: string }) => {
        if (!cancelled) setFaviconUri(data.dataUri);
      })
      .catch(() => { if (!cancelled) setFaviconFailed(true); });
    return () => { cancelled = true; };
  }, [forceLetter, tile.icon, tile.url, faviconFailed]);

  const imgSrc = !forceLetter && (tile.icon || faviconUri);

  if (imgSrc) {
    return (
      <div style={bgStyle}>
        <img src={imgSrc} alt="" className="service-tile-icon" style={{ width: size, height: size }} />
      </div>
    );
  }

  return (
    <div
      className="service-tile-icon service-tile-icon-letter"
      style={{ width: size, height: size, ...(tile.iconBg ? { background: tile.iconBg } : {}) }}
    >
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

// ─── Color picker row ─────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#0f172a', '#1e293b', '#1f2937', '#111827',
  '#dc2626', '#ea580c', '#ca8a04', '#16a34a',
  '#0891b2', '#2563eb', '#7c3aed', '#db2777',
];

const RECENT_COLORS_KEY = 'homelab_recent_colors';
const MAX_RECENT = 8;

function getRecentColors(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? '[]'); }
  catch { return []; }
}

function pushRecentColor(color: string) {
  if (!color) return;
  const recent = getRecentColors().filter(c => c !== color);
  recent.unshift(color);
  localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function ColorSwatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  const isTransparent = !color;
  return (
    <div
      onClick={onClick}
      title={color || 'none'}
      style={{
        width: '22px', height: '22px', borderRadius: '5px', flexShrink: 0, cursor: 'pointer',
        border: active ? '2px solid var(--color-primary)' : '2px solid var(--color-border)',
        backgroundColor: isTransparent ? 'transparent' : color,
        backgroundImage: isTransparent ? 'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 8px 8px' : 'none',
        boxShadow: active ? '0 0 0 1px var(--color-primary)' : undefined,
      }}
    />
  );
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [recentColors, setRecentColors] = useState<string[]>(() => getRecentColors());
  const [panelOpen, setPanelOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen]);

  // Swatch / preset click — immediate + push to recent + close panel
  const pick = (color: string) => {
    onChange(color);
    if (color) {
      pushRecentColor(color);
      setRecentColors(getRecentColors());
    }
    setPanelOpen(false);
  };

  // Live preview while dragging the native picker — debounced, no recent push
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(color), 80);
  };

  // Native picker closed — flush final value + push to recent
  const handleColorBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const color = e.target.value;
    onChange(color);
    if (color) {
      pushRecentColor(color);
      setRecentColors(getRecentColors());
    }
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{label}</span>

      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {/* Color preview — toggles the floating panel */}
        <div
          onClick={() => setPanelOpen(v => !v)}
          style={{
            width: '28px', height: '28px', borderRadius: '6px', flexShrink: 0, cursor: 'pointer',
            border: panelOpen ? '2px solid var(--color-primary)' : '2px solid var(--color-border)',
            backgroundColor: value || 'transparent',
            backgroundImage: value ? 'none' : 'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 8px 8px',
            boxShadow: panelOpen ? '0 0 0 1px var(--color-primary)' : undefined,
          }}
          title="Choisir une couleur"
        />
        {/* Hidden native color input */}
        <input
          ref={inputRef}
          type="color"
          value={value || '#1e293b'}
          onChange={handleColorChange}
          onBlur={handleColorBlur}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        />
        {/* Hex text input */}
        <input
          type="text"
          className="input"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={e => { if (e.target.value) { pushRecentColor(e.target.value); setRecentColors(getRecentColors()); } }}
          placeholder="ex: #1e293b"
          style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', flex: 1, fontFamily: 'monospace' }}
        />
        {value && (
          <button className="btn btn-sm btn-secondary" onClick={onClear} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
            ✕
          </button>
        )}
      </div>

      {/* Floating panel */}
      {panelOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.5rem',
          padding: '0.625rem',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: '0.5rem',
          minWidth: '220px',
        }}>
          {/* Preset grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {PRESET_COLORS.map(c => (
              <ColorSwatch key={c} color={c} active={value === c} onClick={() => pick(c)} />
            ))}
          </div>

          {/* Recent colors */}
          {recentColors.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border)' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginRight: '0.1rem' }}>récent</span>
                {recentColors.map(c => (
                  <ColorSwatch key={c} color={c} active={value === c} onClick={() => pick(c)} />
                ))}
              </div>
            </>
          )}

          {/* Custom color picker button */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.375rem' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => inputRef.current?.click()}
              style={{ width: '100%', fontSize: '0.78rem', justifyContent: 'center' }}
            >
              + Couleur personnalisée
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  tile: Tile;
  onClose: () => void;
  onSave: (tile: Tile, patch: { displayName: string | null; url: string; icon: string | null; iconBg: string | null; cardBg: string | null; hidden: boolean }) => Promise<void>;
}

function EditModal({ tile, onClose, onSave }: EditModalProps) {
  const [displayName, setDisplayName] = useState(tile.displayName ?? (tile.isExternal ? tile.defaultName : ''));
  const [url, setUrl] = useState(tile.url);
  const [icon, setIcon] = useState(tile.icon === FORCE_LETTER ? FORCE_LETTER : (tile.icon ?? ''));
  const [iconBg, setIconBg] = useState(tile.iconBg ?? '');
  const [cardBg, setCardBg] = useState(tile.cardBg ?? '');
  const [iconPreviewError, setIconPreviewError] = useState(false);
  const [hidden, setHidden] = useState(tile.hidden);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [faviconLoading, setFaviconLoading] = useState(false);
  const [colorsLoading, setColorsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

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
      const { dataUri } = await api.home.fetchFavicon(url || tile.url);
      setIcon(dataUri);
      setIconPreviewError(false);
    } catch {
      showToast('Could not fetch favicon');
    } finally {
      setFaviconLoading(false);
    }
  };

  const handleFetchColors = async () => {
    setColorsLoading(true);
    try {
      const colors = await api.home.fetchColors(url || tile.url);
      if (colors.iconBg) setIconBg(colors.iconBg);
      if (colors.cardBg) setCardBg(colors.cardBg);
      if (colors.iconBg || colors.cardBg) {
        setIconPreviewError(false);
      } else {
        showToast('No colors found on this site');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not fetch colors');
    } finally {
      setColorsLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(tile, {
        displayName: displayName.trim() || null,
        url: url.trim() || tile.url,
        icon: icon.trim() || null,
        iconBg: iconBg.trim() || null,
        cardBg: cardBg.trim() || null,
        hidden,
      });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const previewTile: Tile = {
    ...tile,
    url: url.trim() || tile.url,
    displayName: displayName.trim() || null,
    icon: icon.trim() || null,
    iconBg: iconBg.trim() || null,
    cardBg: cardBg.trim() || null,
  };
  const previewName = (tile.isExternal ? displayName.trim() || tile.defaultName : displayName.trim() || tile.defaultName);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div className="modal-header">
          <h2 className="modal-title">
            {tile.isExternal
              ? 'Edit external link'
              : tile.projectName
                ? `Edit — ${tile.projectName}${tile.serviceKey && tile.serviceKey !== 'url' && !tile.serviceKey.startsWith('proxy:') ? ` (${tile.serviceKey})` : ''}`
                : `Edit — ${tile.defaultName}`}
          </h2>
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
              {!tile.isExternal && (
                <div className="service-tile-meta">
                  <span className={`status-dot-lg ${tile.isRunning ? 'dot-running' : 'dot-stopped'}`} style={{ width: '8px', height: '8px' }} />
                  <span>{tile.isRunning ? 'running' : 'stopped'}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Display name */}
        <div className="input-group">
          <label className="input-label">{tile.isExternal ? 'Name' : 'Display name'}</label>
          <input
            type="text"
            className="input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={tile.defaultName}
            autoFocus
          />
        </div>

        {/* URL (external only) */}
        {tile.isExternal && (
          <div className="input-group" style={{ marginTop: '1rem' }}>
            <label className="input-label">URL</label>
            <input
              type="url"
              className="input"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
        )}

        {/* Icon */}
        <div className="input-group" style={{ marginTop: '1rem' }}>
          <label className="input-label">Icon</label>
          <div className="icon-picker">
            {icon && icon !== FORCE_LETTER && !iconPreviewError ? (
              <img src={icon} alt="" className="icon-picker-preview" onError={() => setIconPreviewError(true)} />
            ) : (
              <div className="icon-picker-letter">{previewName[0]?.toUpperCase() ?? '?'}</div>
            )}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <input
                type="url"
                className="input"
                value={icon === FORCE_LETTER ? '' : icon}
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
                >
                  {faviconLoading ? 'Fetching…' : '⬇ Use service favicon'}
                </button>
                <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer', fontSize: '0.75rem', flex: 1, textAlign: 'center' }}>
                  ↑ Upload file
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
                </label>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => { setIcon(FORCE_LETTER); setIconPreviewError(false); }}
                  style={{ fontSize: '0.75rem', opacity: icon === FORCE_LETTER ? 0.5 : 1 }}
                  title="Force letter display"
                >
                  A
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Colors */}
        <div className="input-group" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="input-label">Colors</label>
            <button
              className="btn btn-sm btn-secondary"
              onClick={handleFetchColors}
              disabled={colorsLoading}
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
            >
              {colorsLoading ? 'Fetching…' : '⬇ From site'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.75rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
            <ColorRow label="Icon background" value={iconBg} onChange={setIconBg} onClear={() => setIconBg('')} />
            <div style={{ borderTop: '1px solid var(--color-border)' }} />
            <ColorRow label="Card background" value={cardBg} onChange={setCardBg} onClear={() => setCardBg('')} />
          </div>
        </div>

        {/* Hidden toggle */}
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Hide from home page</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>Visible only in edit mode</div>
          </div>
          <div className={`toggle ${hidden ? 'active' : ''}`} onClick={() => setHidden(h => !h)}>
            <div className="toggle-handle" />
          </div>
        </div>

        {saveError && (
          <div style={{ marginTop: '1rem', padding: '0.5rem 0.75rem', backgroundColor: 'var(--color-error-bg, #3d1a1a)', color: 'var(--color-error, #f87171)', borderRadius: '0.375rem', fontSize: '0.825rem' }}>
            {saveError}
          </div>
        )}
        {toast && (
          <div style={{ marginTop: '1rem', padding: '0.5rem 0.75rem', backgroundColor: toast.type === 'error' ? 'var(--color-error-bg, #3d1a1a)' : 'var(--color-success-bg, #1a3d1a)', color: toast.type === 'error' ? 'var(--color-error, #f87171)' : 'var(--color-success, #4ade80)', borderRadius: '0.375rem', fontSize: '0.825rem' }}>
            {toast.message}
          </div>
        )}
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

// ─── Add external link modal ──────────────────────────────────────────────────

interface AddExternalModalProps {
  onClose: () => void;
  onAdd: (name: string, url: string) => Promise<void>;
}

function AddExternalModal({ onClose, onAdd }: AddExternalModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!url.trim()) { setError('URL is required'); return; }
    try { new URL(url); } catch { setError('Invalid URL'); return; }
    setSaving(true);
    setError('');
    await onAdd(name.trim(), url.trim());
    setSaving(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Add external link</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="input-group">
          <label className="input-label">Name</label>
          <input
            type="text"
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Service"
            autoFocus
          />
        </div>

        <div className="input-group" style={{ marginTop: '1rem' }}>
          <label className="input-label">URL</label>
          <input
            type="url"
            className="input"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </div>

        {error && <p style={{ color: 'var(--color-error)', fontSize: '0.8rem', marginTop: '0.5rem' }}>{error}</p>}

        <div className="form-actions" style={{ marginTop: '1.25rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Service tile card ────────────────────────────────────────────────────────

interface ServiceTileCardProps {
  tile: Tile;
  editMode: boolean;
  isDragOver: boolean;
  onEdit: (tile: Tile) => void;
  onToggleHidden: (tile: Tile) => void;
  onDelete?: (tile: Tile) => void;
  onDragStart: (e: React.DragEvent, key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDrop: (e: React.DragEvent, key: string) => void;
  onDragEnd: () => void;
}

function ServiceTileCard({
  tile, editMode, isDragOver,
  onEdit, onToggleHidden, onDelete,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: ServiceTileCardProps) {
  const navigate = useNavigate();
  const dotClass = tile.isRunning
    ? tile.reachable === false ? 'dot-unreachable' : 'dot-running'
    : 'dot-stopped';

  const tileClasses = [
    'service-tile',
    tile.hidden && editMode ? 'service-tile-hidden-edit' : '',
    editMode ? 'service-tile-edit-mode' : '',
    isDragOver ? 'service-tile-drag-over' : '',
  ].filter(Boolean).join(' ');

  const textColor = tile.cardBg ? (isColorDark(tile.cardBg) ? '#ffffff' : '#0f172a') : undefined;

  return (
    <div
      className={tileClasses}
      style={tile.cardBg ? { backgroundColor: tile.cardBg, color: textColor } : {}}
      draggable={editMode}
      onDragStart={e => onDragStart(e, tile.tileKey)}
      onDragOver={e => onDragOver(e, tile.tileKey)}
      onDrop={e => onDrop(e, tile.tileKey)}
      onDragEnd={onDragEnd}
    >
      {/* Actions overlay */}
      <div className={`service-tile-actions${editMode ? ' service-tile-actions-edit' : ''}`}>
        {editMode ? (
          <>
            <span className="tile-drag-handle" title="Drag to reorder">⠿</span>
            <button
              className={`tile-action-btn${tile.hidden ? ' tile-action-btn-active' : ''}`}
              title={tile.hidden ? 'Show tile' : 'Hide tile'}
              onClick={() => onToggleHidden(tile)}
            >
              {tile.hidden ? '👁' : '🙈'}
            </button>
            <button className="tile-action-btn" title="Edit tile" onClick={() => onEdit(tile)}>✎</button>
            {tile.isExternal && onDelete && (
              <button className="tile-action-btn tile-action-btn-danger" title="Delete" onClick={() => onDelete(tile)}>✕</button>
            )}
          </>
        ) : (
          <>
            {!tile.isExternal && (
              <button
                className="tile-action-btn"
                title="Manage project"
                onClick={() => navigate(`/projects?select=${tile.projectId}`)}
              >⚙</button>
            )}
            <button className="tile-action-btn" title="Edit tile" onClick={() => onEdit(tile)}>✎</button>
          </>
        )}
      </div>

      {/* Hidden badge (edit mode only) */}
      {editMode && tile.hidden && (
        <div className="service-tile-hidden-badge">hidden</div>
      )}

      <a
        href={tile.url}
        target="_blank"
        rel="noopener noreferrer"
        className="service-tile-link"
        style={textColor ? { color: textColor } : {}}
        onClick={e => editMode && e.preventDefault()}
      >
        <TileIcon tile={tile} />
        <div className="service-tile-name">{tile.displayName ?? tile.defaultName}</div>
        {!tile.isExternal && (
          <div className="service-tile-meta">
            <span className={`status-dot-lg ${dotClass}`} style={{ width: '8px', height: '8px', flexShrink: 0 }} />
            <span>{tile.isRunning ? (tile.reachable === false ? 'injoignable' : 'running') : 'stopped'}</span>
          </div>
        )}
        <div className="service-tile-url">{tile.url}</div>
      </a>
    </div>
  );
}

// ─── Home page ────────────────────────────────────────────────────────────────

export function HomePage() {
  const { projects, refetch: refetchProjects } = useProjects();
  const { status } = useAuth();
  const [overrides, setOverrides] = useState<HomeTileOverride[]>([]);
  const [externalTiles, setExternalTiles] = useState<ExternalTile[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const localOrderRef = useRef<string[] | null>(null);
  const [editingTile, setEditingTile] = useState<Tile | null>(null);
  const [showAddExternal, setShowAddExternal] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragSourceKey = useRef<string | null>(null);
  const [homeProxyHosts, setHomeProxyHosts] = useState<ProxyHost[]>([]);
  const [proxyOverrides, setProxyOverrides] = useState<ProxyTileOverride[]>([]);
  const { results: homeReachability, checkProxyHosts: checkHomeReachability } = useReachability();

  const fetchData = useCallback(async () => {
    try {
      const [tilesData, proxyData] = await Promise.all([
        api.home.getTiles(),
        api.proxy.listForHome(),
      ]);
      setOverrides(tilesData.overrides);
      setExternalTiles(tilesData.external);
      setProxyOverrides(tilesData.proxyOverrides);
      setHomeProxyHosts(proxyData);
    } catch {}
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (homeProxyHosts.length > 0) {
      checkHomeReachability(homeProxyHosts.filter(h => h.enabled));
    }
  }, [homeProxyHosts, checkHomeReachability]);

  useWebSocket(msg => {
    if (msg.type === 'containers_updated' || msg.type === 'project_updated') refetchProjects();
  });

  const baseTiles = useMemo(
    () => buildTiles(projects, overrides, externalTiles, homeProxyHosts, proxyOverrides),
    [projects, overrides, externalTiles, homeProxyHosts, proxyOverrides]
  );

  const tilesWithReachability = useMemo(() => {
    return baseTiles.map(tile => {
      if (!tile.serviceKey?.startsWith('proxy:')) return tile;
      const result = homeReachability.get(tile.url);
      if (result === undefined) return tile;
      return { ...tile, reachable: result.reachable };
    });
  }, [baseTiles, homeReachability]);

  // Apply local order if set, otherwise use base order
  const allTiles = useMemo(() => {
    if (!localOrder) return tilesWithReachability;
    const map = new Map(tilesWithReachability.map(t => [t.tileKey, t]));
    const ordered: Tile[] = [];
    for (const key of localOrder) {
      const t = map.get(key);
      if (t) { ordered.push(t); map.delete(key); }
    }
    for (const t of map.values()) ordered.push(t);
    return ordered;
  }, [tilesWithReachability, localOrder]);

  const displayTiles = editMode ? allTiles : allTiles.filter(t => !t.hidden);

  // Keep localOrderRef in sync for use in event handlers (avoids stale closures)
  useEffect(() => { localOrderRef.current = localOrder; }, [localOrder]);

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, key: string) => {
    e.dataTransfer.effectAllowed = 'move';
    dragSourceKey.current = key;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverKey(prev => prev === key ? prev : key);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const sourceKey = dragSourceKey.current;
    dragSourceKey.current = null;
    setDragOverKey(null);
    if (!sourceKey || sourceKey === targetKey) return;

    const order = localOrderRef.current;
    if (!order) return;

    const fromIdx = order.indexOf(sourceKey);
    const toIdx = order.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;

    const next = [...order];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, sourceKey);

    localOrderRef.current = next;
    setLocalOrder(next);

    const items = next.map((key, idx) => {
      if (key.startsWith('ext:')) {
        return { type: 'external' as const, id: parseInt(key.slice(4)), sortOrder: idx };
      }
      if (key.startsWith('proxy:')) {
        return { type: 'proxy-tile' as const, proxyHostId: parseInt(key.slice(6)), sortOrder: idx };
      }
      const [projectId, ...rest] = key.split(':');
      return { type: 'tile' as const, projectId: parseInt(projectId), serviceKey: rest.join(':'), sortOrder: idx };
    });
    api.home.setOrder(items).catch(() => {});
  }, []);

  const handleDragEnd = useCallback(() => {
    dragSourceKey.current = null;
    setDragOverKey(null);
  }, []);

  // ── Edit mode ──────────────────────────────────────────────────────────────

  const enterEditMode = () => {
    const order = tilesWithReachability.map(t => t.tileKey);
    localOrderRef.current = order;
    setLocalOrder(order);
    setEditMode(true);
  };

  const exitEditMode = () => {
    setEditMode(false);
    setLocalOrder(null);
    fetchData();
  };

  // ── Tile actions ───────────────────────────────────────────────────────────

  const handleSaveTile = async (tile: Tile, patch: { displayName: string | null; url: string; icon: string | null; iconBg: string | null; cardBg: string | null; hidden: boolean }) => {
    if (tile.isExternal && tile.externalId !== null) {
      await api.home.updateExternal(tile.externalId, {
        name: patch.displayName ?? tile.defaultName,
        url: patch.url,
        icon: patch.icon,
        icon_bg: patch.iconBg,
        card_bg: patch.cardBg,
        hidden: patch.hidden,
      });
    } else if (tile.projectId !== null && tile.serviceKey !== null) {
      await api.home.updateTile(tile.projectId, tile.serviceKey, {
        display_name: patch.displayName,
        icon: patch.icon,
        icon_bg: patch.iconBg,
        card_bg: patch.cardBg,
        hidden: patch.hidden,
      });
    } else if (tile.serviceKey?.startsWith('proxy:')) {
      const proxyHostId = parseInt(tile.serviceKey.replace('proxy:', ''), 10);
      await api.home.updateProxyTile(proxyHostId, {
        display_name: patch.displayName,
        icon: patch.icon,
        icon_bg: patch.iconBg,
        card_bg: patch.cardBg,
        hidden: patch.hidden,
      });
    }
    await fetchData();
  };

  const handleToggleHidden = async (tile: Tile) => {
    if (tile.isExternal && tile.externalId !== null) {
      await api.home.updateExternal(tile.externalId, {
        name: tile.displayName ?? tile.defaultName,
        url: tile.url,
        icon: tile.icon,
        icon_bg: tile.iconBg,
        card_bg: tile.cardBg,
        hidden: !tile.hidden,
      });
    } else if (tile.projectId !== null && tile.serviceKey !== null) {
      await api.home.updateTile(tile.projectId, tile.serviceKey, { hidden: !tile.hidden });
    }
    await fetchData();
  };

  const handleDeleteExternal = async (tile: Tile) => {
    if (tile.externalId === null) return;
    await api.home.deleteExternal(tile.externalId);
    setLocalOrder(prev => prev ? prev.filter(k => k !== tile.tileKey) : null);
    await fetchData();
  };

  const handleAddExternal = async (name: string, url: string) => {
    await api.home.createExternal({ name, url });
    await fetchData();
  };

  return (
    <div className="layout">
      <AppHeader title="Accueil" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
        {editMode && (
          <div className="edit-mode-banner">
            <span>✎ Edit mode — drag tiles to reorder, toggle visibility, add external links</span>
          </div>
        )}

        {tilesWithReachability.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏠</div>
            <h3>No services yet</h3>
            <p>Deploy projects with exposed ports or add a URL to display them here</p>
            <Link to="/projects" className="btn btn-primary" style={{ marginTop: '1rem' }}>Go to Projects</Link>
          </div>
        ) : (
          <div className="home-grid-wrapper">
            <div className={`service-grid${editMode ? ' service-grid-edit' : ''}`}>
              {displayTiles.map(tile => (
                <ServiceTileCard
                  key={tile.tileKey}
                  tile={tile}
                  editMode={editMode}
                  isDragOver={dragOverKey === tile.tileKey}
                  onEdit={setEditingTile}
                  onToggleHidden={handleToggleHidden}
                  onDelete={tile.isExternal ? handleDeleteExternal : undefined}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating edit button */}
      {!editMode ? (
        <button className="fab-edit" onClick={enterEditMode} title="Edit layout">
          ✎
        </button>
      ) : (
        <div className="fab-edit-mode-bar">
          <button className="btn btn-sm btn-secondary" onClick={() => setShowAddExternal(true)}>
            + Add link
          </button>
          <button className="btn btn-sm btn-primary" onClick={exitEditMode}>
            ✓ Done
          </button>
        </div>
      )}

      {editingTile && (
        <EditModal tile={editingTile} onClose={() => setEditingTile(null)} onSave={handleSaveTile} />
      )}
      {showAddExternal && (
        <AddExternalModal onClose={() => setShowAddExternal(false)} onAdd={handleAddExternal} />
      )}
    </div>
  );
}
