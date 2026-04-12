import { useState, useEffect, useCallback, useRef } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, Container, SystemSettings } from '../api';
import { TerminalPanel } from '../components/TerminalPanel';
import type { TerminalHandle } from '../components/TerminalPanel';
import '../styles/settings.css';

type SettingsTab = 'general' | 'containers';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="settings-page">
      <AppHeader title="Paramètres" />
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'settings-tab-active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          Général
        </button>
        <button
          className={`settings-tab ${activeTab === 'containers' ? 'settings-tab-active' : ''}`}
          onClick={() => setActiveTab('containers')}
        >
          Containers
        </button>
      </div>

      <div className={`settings-content${activeTab === 'containers' ? ' settings-content--fill' : ''}`}>
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'containers' && <ContainersSettings />}
      </div>
    </div>
  );
}

// ─── General Settings ────────────────────────────────────────────────────────

function GeneralSettings() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api.system.getSettings().then(data => {
      setSettings(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveSettings = async (updates: Partial<SystemSettings>) => {
    setSaving(true);
    setMessage(null);
    try {
      await api.system.saveSettings(updates);
      setSettings(prev => prev ? { ...prev, ...updates } : null);
      setMessage('Paramètres enregistrés');
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Les mots de passe ne correspondent pas');
      return;
    }

    setChangingPassword(true);
    try {
      await api.auth.changePassword(newPassword, currentPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) return <div className="settings-section"><div className="spinner" /></div>;
  if (!settings) return null;

  return (
    <div className="settings-section">
      <h2>Paramètres généraux</h2>

      <div className="settings-card">
        <h3>Domaine par défaut</h3>
        <div className="settings-field">
          <label htmlFor="domain-suffix">Suffixe de domaine</label>
          <input
            id="domain-suffix"
            type="text"
            className="input"
            value={settings.domainSuffix}
            onChange={e => setSettings({ ...settings, domainSuffix: e.target.value })}
            onBlur={() => saveSettings({ domainSuffix: settings.domainSuffix })}
            placeholder=".homelab.local"
          />
          <span className="form-help">Les nouveaux proxies utiliseront ce suffixe par défaut (ex: monapp.homelab.local)</span>
        </div>

        <div className="settings-field">
          <label htmlFor="extra-hostname">Hostname externe (optionnel)</label>
          <input
            id="extra-hostname"
            type="text"
            className="input"
            value={settings.extraHostname}
            onChange={e => setSettings({ ...settings, extraHostname: e.target.value })}
            onBlur={() => saveSettings({ extraHostname: settings.extraHostname })}
            placeholder="homer.example.com"
          />
          <span className="form-help">Hostname public avec certificat Let's Encrypt</span>
        </div>

        <div className="settings-field">
          <label htmlFor="cert-lifetime">Durée de vie des certificats internes</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              id="cert-lifetime"
              type="number"
              className="input"
              style={{ maxWidth: '100px' }}
              min={60}
              max={43200}
              value={settings.certLifetime}
              onChange={e => setSettings({ ...settings, certLifetime: parseInt(e.target.value) || 10080 })}
              onBlur={() => saveSettings({ certLifetime: settings.certLifetime })}
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>minutes</span>
          </div>
          <span className="form-help">Durée de validité des certificats TLS générés par Caddy pour le réseau local (défaut: 7 jours). Recharge Caddy requise.</span>
        </div>
      </div>

      <div className="settings-card">
        <h3>Mises à jour des containers</h3>
        <div className="settings-field">
          <label htmlFor="update-interval">Intervalle de vérification</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              id="update-interval"
              type="number"
              className="input"
              style={{ maxWidth: '100px' }}
              min={30}
              max={10080}
              value={settings.updateCheckInterval}
              onChange={e => setSettings({ ...settings, updateCheckInterval: parseInt(e.target.value) || 360 })}
              onBlur={() => saveSettings({ updateCheckInterval: settings.updateCheckInterval })}
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>minutes</span>
          </div>
          <span className="form-help">Fréquence à laquelle les images Docker sont comparées au registre (min. 30 min). Redémarrage requis pour prendre effet.</span>
        </div>
        <div className="toggle-row" style={{ marginTop: '0.75rem' }}>
          <label className="toggle-label">
            <span>Mises à jour app automatiques</span>
            <span className="form-help">Installer automatiquement les nouvelles versions de HOMER</span>
          </label>
          <button
            type="button"
            className={`toggle ${settings.autoUpdate ? 'toggle-active' : ''}`}
            onClick={() => saveSettings({ autoUpdate: !settings.autoUpdate })}
            disabled={saving}
          >
            <span className="toggle-handle" />
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3>Mot de passe administrateur</h3>
        <form className="password-form" onSubmit={handlePasswordChange}>
          <input
            type="password"
            className="input"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="Mot de passe actuel"
          />
          <input
            type="password"
            className="input"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Nouveau mot de passe (min. 8 caractères)"
          />
          <input
            type="password"
            className="input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirmer le nouveau mot de passe"
          />
          {passwordError && <div className="proxy-form-error">{passwordError}</div>}
          {passwordSuccess && <div style={{ color: 'var(--color-success)', fontSize: '0.8125rem' }}>Mot de passe modifié avec succès</div>}
          <div className="password-form-actions">
            <button type="submit" className="btn btn-primary" disabled={changingPassword}>
              {changingPassword ? 'Modification...' : 'Changer le mot de passe'}
            </button>
          </div>
        </form>
      </div>

      {message && (
        <div style={{ color: 'var(--color-success)', fontSize: '0.8125rem', textAlign: 'center', marginTop: '0.5rem' }}>
          {message}
        </div>
      )}
    </div>
  );
}

// ─── System Containers Settings ───────────────────────────────────────────────

const ANSI_FG: Record<number, string> = {
  30: '#4c4c4c', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
  34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
  90: '#767676', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
  94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#ffffff',
};

function ansi256ToColor(n: number): string {
  if (n < 16) {
    const p = ['#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0','#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'];
    return p[n] ?? '#ffffff';
  }
  if (n < 232) {
    const idx = n - 16;
    const b = idx % 6, g = Math.floor(idx / 6) % 6, r = Math.floor(idx / 36);
    const v = (x: number) => x === 0 ? 0 : 55 + x * 40;
    return `rgb(${v(r)},${v(g)},${v(b)})`;
  }
  const lv = (n - 232) * 10 + 8;
  return `rgb(${lv},${lv},${lv})`;
}

function parseAnsiSegments(raw: string) {
  const text = raw.replace(/\r/g, '').replace(/\x1b\[[0-9;]*[ABCDEFGHIJKLMSTPsuhr]/g, '').replace(/\x1b[()][A-Z0-9]/g, '');
  let style: { fg: string | null; bg: string | null; bold: boolean; dim: boolean; italic: boolean; underline: boolean } = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
  const segments: { text: string; style: typeof style }[] = [];
  const seqRe = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = seqRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) segments.push({ text: before, style: { ...style } });
    lastIndex = match.index + match[0].length;
    const params = match[1] === '' ? [0] : match[1].split(';').map(Number);
    let i = 0;
    while (i < params.length) {
      const c = params[i];
      if (c === 0) style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 3) style.italic = true;
      else if (c === 4) style.underline = true;
      else if (c === 22) { style.bold = false; style.dim = false; }
      else if (c === 23) style.italic = false;
      else if (c === 24) style.underline = false;
      else if (c === 39) style.fg = null;
      else if (c === 49) style.bg = null;
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) style.fg = ANSI_FG[c] ?? null;
      else if ((c >= 38 && c <= 39) && params[i + 1] === 5 && i + 2 < params.length) { style.fg = ansi256ToColor(params[i + 2]); i += 2; }
      else if ((c >= 38 && c <= 39) && params[i + 1] === 2 && i + 4 < params.length) { style.fg = `rgb(${params[i+2]},${params[i+3]},${params[i+4]})`; i += 4; }
      i++;
    }
  }
  const remaining = text.slice(lastIndex);
  if (remaining) segments.push({ text: remaining, style: { ...style } });
  return segments;
}

function AnsiLine({ line, index }: { line: string; index: number }) {
  const segments = parseAnsiSegments(line);
  return (
    <span key={index}>
      {segments.map((seg, i) => {
        const css: React.CSSProperties = {};
        if (seg.style.fg) css.color = seg.style.fg;
        if (seg.style.bg) css.backgroundColor = seg.style.bg;
        if (seg.style.bold) css.fontWeight = 'bold';
        if (seg.style.dim) css.opacity = 0.5;
        if (seg.style.italic) css.fontStyle = 'italic';
        if (seg.style.underline) css.textDecoration = 'underline';
        const hasStyle = Object.keys(css).length > 0;
        return hasStyle ? <span key={i} style={css}>{seg.text}</span> : seg.text;
      })}
    </span>
  );
}

function ContainersSettings() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'terminal'>('overview');
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsInitialized, setLogsInitialized] = useState(false);
  const [following, setFollowing] = useState(true);
  const logsScrollRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [terminalContainerId, setTerminalContainerId] = useState<string | null>(null);
  const [terminalConnected, setTerminalConnected] = useState(false);
  const terminalWsRef = useRef<WebSocket | null>(null);
  const terminalHandle = useRef<TerminalHandle | null>(null);
  const terminalHistoryRef = useRef('');
  const terminalHistorySnap = useRef('');

  useEffect(() => {
    api.system.getContainers().then(data => {
      setContainers(data);
      if (data.length > 0) {
        setSelectedContainerId(data[0].id);
        setTerminalContainerId(data.find(c => c.state === 'running')?.id ?? data[0].id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab !== 'logs') {
      return;
    }

    if (!logsInitialized && containers.length > 0) {
      setLogsInitialized(true);
      setLogsLoading(true);
      (async () => {
        const initialLogs: Record<string, string[]> = {};
        for (const container of containers) {
          try {
            const response = await api.containers.logs(container.id, 200);
            initialLogs[container.id] = response.logs.split('\n').filter(Boolean);
          } catch {
            initialLogs[container.id] = ['Failed to fetch logs'];
          }
        }
        setLogs(initialLogs);
        setLogsLoading(false);
      })();
    }

    const token = localStorage.getItem('token');
    if (!token || containers.length === 0) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events?token=${token}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      for (const c of containers) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribe_logs', containerId: c.id }));
        }
      }
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'log_line' && message.containerId && message.line) {
          setLogs(prev => {
            const lines = [...(prev[message.containerId] || []), message.line];
            if (lines.length > 1000) lines.splice(0, lines.length - 1000);
            return { ...prev, [message.containerId]: lines };
          });
        }
      } catch {}
    };
    ws.onclose = () => { wsRef.current = null; };
    ws.onerror = () => ws.close();

    return () => {
      for (const c of containers) {
        try { ws.send(JSON.stringify({ type: 'unsubscribe_logs', containerId: c.id })); } catch {}
      }
      ws.close();
      wsRef.current = null;
    };
  }, [activeTab, logsInitialized, containers]);

  useEffect(() => {
    if (following && logsScrollRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [logs, following]);

  useEffect(() => {
    terminalHistoryRef.current = '';
    terminalHistorySnap.current = '';
  }, [terminalContainerId]);

  useEffect(() => {
    if (activeTab !== 'terminal' || !terminalContainerId) {
      if (terminalWsRef.current) {
        const ws = terminalWsRef.current;
        terminalWsRef.current = null;
        try { ws.send(JSON.stringify({ type: 'unsubscribe_terminal', containerId: terminalContainerId })); } catch {}
        ws.close();
        setTerminalConnected(false);
      }
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events?token=${token}`;

    const ws = new WebSocket(wsUrl);
    terminalWsRef.current = ws;
    ws.onopen = () => {
      const cols = terminalHandle.current?.getDimensions().cols ?? 80;
      const rows = terminalHandle.current?.getDimensions().rows ?? 24;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe_terminal', containerId: terminalContainerId, cols, rows }));
      }
      setTerminalConnected(true);
      terminalHandle.current?.focus();
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'terminal_output' && msg.containerId === terminalContainerId) {
          const binary = atob(msg.data as string);
          terminalHistoryRef.current += binary;
          if (terminalHistoryRef.current.length > 200000) {
            terminalHistoryRef.current = terminalHistoryRef.current.slice(-200000);
          }
          terminalHistorySnap.current = terminalHistoryRef.current;
          terminalHandle.current?.writeB64(msg.data as string);
        } else if (msg.type === 'terminal_exit' && msg.containerId === terminalContainerId) {
          setTerminalConnected(false);
        }
      } catch {}
    };
    ws.onclose = () => { if (terminalWsRef.current) setTerminalConnected(false); };
    ws.onerror = () => ws.close();

    return () => {
      terminalWsRef.current = null;
      try { ws.send(JSON.stringify({ type: 'unsubscribe_terminal', containerId: terminalContainerId })); } catch {}
      ws.close();
      setTerminalConnected(false);
    };
  }, [activeTab, terminalContainerId]);

  const handleTerminalData = (data: string) => {
    if (!terminalWsRef.current || !terminalConnected || !terminalContainerId) return;
    if (terminalWsRef.current.readyState !== WebSocket.OPEN) return;
    terminalWsRef.current.send(JSON.stringify({ type: 'terminal_input', containerId: terminalContainerId, data }));
  };

  const handleTerminalResize = (cols: number, rows: number) => {
    if (!terminalWsRef.current || !terminalContainerId) return;
    if (terminalWsRef.current.readyState !== WebSocket.OPEN) return;
    terminalWsRef.current.send(JSON.stringify({ type: 'terminal_resize', containerId: terminalContainerId, cols, rows }));
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart', containerId: string) => {
    try {
      await api.containers[action](containerId);
      const updated = await api.system.getContainers();
      setContainers(updated);
      const running = updated.find(c => c.id === terminalContainerId);
      if (running) setTerminalContainerId(running.id);
    } catch {}
  };

  if (loading) return <div className="settings-section"><div className="spinner" /></div>;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="detail-tabs">
        <button className={`detail-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={`detail-tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>Logs</button>
        <button className={`detail-tab ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>Terminal</button>
      </div>

      <div className="detail-content" style={{ minHeight: 0 }}>
        {activeTab === 'overview' && (
          <div>
            <h3 className="section-title">System Containers</h3>
            {containers.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No system containers found.</p>
            ) : (
              <div className="container-list">
                {containers.map(c => (
                  <div key={c.id} className="container-item">
                    <div className="container-info">
                      <span className={`status-badge ${c.state === 'running' ? 'status-running' : 'status-stopped'}`}>
                        <span className="status-dot" />
                        {c.state}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div className="container-name">{c.name}</div>
                        <div className="container-image">{c.image}</div>
                      </div>
                    </div>
                    <div className="container-actions">
                      {c.state === 'running' ? (
                        <>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleAction('restart', c.id)}>Restart</button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleAction('stop', c.id)}>Stop</button>
                        </>
                      ) : (
                        <button className="btn btn-sm btn-success" onClick={() => handleAction('start', c.id)}>Start</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              {containers.length > 1 && (
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                  {containers.map(c => (
                    <button key={c.id} className={`chip ${selectedContainerId === c.id ? 'active' : ''}`} onClick={() => setSelectedContainerId(c.id)}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer', marginLeft: 'auto' }}>
                <input type="checkbox" checked={following} onChange={e => setFollowing(e.target.checked)} />
                Follow logs
              </label>
            </div>
            {logsLoading ? (
              <div className="loading"><div className="spinner" />Loading logs...</div>
            ) : (
              <div ref={logsScrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0, backgroundColor: 'var(--color-bg)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
                {containers.filter(c => selectedContainerId === null || c.id === selectedContainerId).map((container, idx, arr) => (
                  <div key={container.id} style={{ marginBottom: idx < arr.length - 1 ? '1.5rem' : 0 }}>
                    {(selectedContainerId === null && containers.length > 1) && (
                      <h4 style={{ marginBottom: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{container.name}</h4>
                    )}
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.75rem', lineHeight: '1.4', margin: 0 }}>
                      {logs[container.id]?.length
                        ? logs[container.id].map((line, i) => <><AnsiLine key={i} line={line} index={i} />{i < logs[container.id].length - 1 ? '\n' : ''}</>)
                        : 'No logs available'}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'terminal' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {containers.length > 1 && (
                <select
                  className="input"
                  value={terminalContainerId ?? ''}
                  onChange={e => setTerminalContainerId(e.target.value || null)}
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem', width: 'auto' }}
                >
                  {containers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.state !== 'running' ? ' (stopped)' : ''}
                    </option>
                  ))}
                </select>
              )}
              <span style={{ fontSize: '0.75rem', color: terminalConnected ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                {terminalConnected ? '● Connected' : '○ Disconnected'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => window.open(`/terminal?containerId=${terminalContainerId}&containerName=${encodeURIComponent(containers.find(c => c.id === terminalContainerId)?.name ?? '')}`, '_blank')} title="Open in a new window">
                  ↗ Open in window
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setTerminalContainerId(null)} title="Close terminal">
                  ✕ Close
                </button>
              </div>
            </div>
            {containers.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No containers to connect to.</p>
            ) : (
              <div className="terminal-container">
                <TerminalPanel
                  handle={terminalHandle}
                  initialContent={terminalHistoryRef.current}
                  onData={handleTerminalData}
                  onResize={handleTerminalResize}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
