import { useState, useEffect, useRef, useCallback } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, Container, SystemSettings, LocalInstanceInfo } from '../api';
import { ContainerRow } from '../components/ContainerRow';
import { usePeer } from '../hooks/usePeer';
import { useConfirm } from '../hooks/useConfirm';
import '../styles/settings.css';

type SettingsTab = 'general' | 'containers';

interface SettingsPageProps {
  initialTab?: SettingsTab;
}

export function SettingsPage({ initialTab }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'general');

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

      <InstanceSettings />
    </div>
  );
}

// ─── Instance Settings ───────────────────────────────────────────────────────────────

interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  configured: boolean;
}

function InstanceSettings() {
  const { activePeer } = usePeer();
  const { confirm, ConfirmDialog } = useConfirm();

  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [instanceInfo, setInstanceInfo] = useState<LocalInstanceInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'update' | 'restart'>('update');
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const restartPollRef = useRef<number | null>(null);
  const peerCheckRef = useRef<number | null>(null);

  const fetchVersion = useCallback(() => {
    api.system.getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    fetchVersion();
    api.instances.self().then(setInstanceInfo).catch(() => {});
  }, [fetchVersion]);

  const startRestartPolling = useCallback(() => {
    if (restartPollRef.current) clearInterval(restartPollRef.current);
    let attempts = 0;
    restartPollRef.current = window.setInterval(async () => {
      attempts++;
      try {
        const res = await fetch('/api/health');
        if (res.ok && attempts > 2) {
          clearInterval(restartPollRef.current!);
          window.location.reload();
        }
      } catch {
        // Server still down — keep polling
      }
    }, 3000);
  }, []);

  const startPeerStatusCheck = useCallback((peerUuid: string) => {
    if (peerCheckRef.current) clearInterval(peerCheckRef.current);
    let wasOffline = false;
    peerCheckRef.current = window.setInterval(async () => {
      try {
        const result = await api.instances.list();
        const peer = result.peers.find(p => p.uuid === peerUuid);
        if (peer?.status === 'offline' || peer?.status === 'unreachable') {
          wasOffline = true;
        }
        if (wasOffline && peer?.status === 'online') {
          clearInterval(peerCheckRef.current!);
          setRestarting(false);
        }
      } catch {}
    }, 3000);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events?token=${token}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; [key: string]: unknown };
          if (msg.type === 'update_output') {
            setLogs(prev => [...prev, msg.line as string]);
          }
          if (msg.type === 'update_pull_done') {
            setLogs(prev => [...prev, '--- Redémarrage du conteneur en cours... ---']);
            if (!activePeer) {
              setUpdating(false);
              setRestarting(true);
              startRestartPolling();
            }
          }
          if (msg.type === 'update_error') {
            setLogs(prev => [...prev, `Erreur : ${msg.message as string}`]);
          }
          if (msg.type === 'restart_output') {
            setLogs(prev => [...prev, msg.line as string]);
          }
          if (msg.type === 'restart_error') {
            setLogs(prev => [...prev, `Erreur : ${msg.message as string}`]);
            setRestarting(false);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!restarting) {
          setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      if (restartPollRef.current) clearInterval(restartPollRef.current);
      if (peerCheckRef.current) clearInterval(peerCheckRef.current);
    };
  }, [activePeer, startRestartPolling, restarting]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      await fetchVersion();
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    setModalType('update');
    setShowModal(true);
    setLogs(['Démarrage de la mise à jour...']);
    try {
      await api.system.update();
    } catch {
      setLogs(prev => [...prev, 'Erreur lors du démarrage de la mise à jour.']);
    }
  };

  const handleRestart = async () => {
    const instanceName = activePeer?.name ?? instanceInfo?.name ?? 'cette instance';
    const isLocal = !activePeer;
    const ok = await confirm({
      title: 'Redémarrer l\'instance',
      message: `Voulez-vous vraiment redémarrer l\'instance "${instanceName}" ?`,
      confirmText: 'Redémarrer',
      type: 'danger',
    });
    if (!ok) return;

    setModalType('restart');
    setShowModal(true);
    setLogs([isLocal ? 'Redémarrage en cours...' : `Redémarrage de ${instanceName}...`]);
    setRestarting(true);

    try {
      const res = await api.system.restart();
      // 202 = accepted, async restart started
      if (isLocal) {
        startRestartPolling();
      } else {
        startPeerStatusCheck(activePeer!.uuid);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors du redémarrage';
      setLogs(prev => [...prev, `Erreur : ${msg}`]);
      setRestarting(false);
    }
  };

  if (restarting && !activePeer) {
    return (
      <div className="update-restarting-overlay">
        <div className="update-restarting-content">
          <div className="spinner" />
          <p className="update-restarting-title">Redémarrage en cours...</p>
          <p className="update-restarting-sub">L'application va se reconnecter automatiquement</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="settings-card">
        <h3>Instance HOMER</h3>
        <div className="instance-info">
          {version?.configured ? (
            <>
              <div className="instance-version-row">
                <span>Version actuelle</span>
                <span className="version-badge">v{version.currentVersion}</span>
              </div>
              <div className="instance-version-row">
                <span>Dernière version</span>
                <span className={`version-badge ${version.updateAvailable ? 'version-badge-new' : ''}`}>
                  v{version.latestVersion ?? '-'}
                </span>
              </div>
            </>
          ) : (
            <div className="instance-version-row">
              <span>Version</span>
              <span className="version-badge">{version?.currentVersion ?? '-'}</span>
            </div>
          )}
        </div>
        <div className="instance-actions">
          <button
            className="btn btn-secondary"
            onClick={handleCheckUpdate}
            disabled={checking}
          >
            {checking ? 'Vérification...' : 'Vérifier les mises à jour'}
          </button>
          {version?.updateAvailable && (
            <button className="btn btn-primary" onClick={handleUpdate}>
              Mettre à jour
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? 'Redémarrage...' : 'Redémarrer'}
          </button>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => !restarting && modalType !== 'update' && setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modalType === 'update' ? 'Mise à jour de HOMER' : 'Redémarrage de l\'instance'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="update-log-container">
              {logs.map((line, i) => (
                <div key={i} className="update-log-line">{line}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog />
    </>
  );
}

// ─── System Containers Settings ───────────────────────────────────────────────

function ContainersSettings() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.system.getContainers().then(data => {
      setContainers(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'remove' | 'checkUpdate', containerId: string) => {
    try {
      if (action === 'remove' || action === 'checkUpdate') return;
      await api.containers[action](containerId);
      const updated = await api.system.getContainers();
      setContainers(updated);
    } catch {}
  };

  if (loading) return <div className="settings-section"><div className="spinner" /></div>;

  return (
    <div style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>System Containers</h2>
      </div>
      {containers.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No system containers found.</p>
      ) : (
        <div className="resource-list">
          {containers.map(c => (
            <ContainerRow
              key={c.id}
              container={c}
              showPorts
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
