import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { api, Container, SystemSettingsData, LocalInstanceInfo, displayName } from '../api';
import { ContainerRow } from '../components/ContainerRow';
import { usePeer } from '../hooks/usePeer';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { FederationSettings } from './FederationSettings';
import '../styles/settings.css';

type SettingsTab = 'overview' | 'containers' | 'federation';

const TAB_PATHS: Record<SettingsTab, string> = {
  overview: '/settings',
  containers: '/settings/containers',
  federation: '/settings/federation',
};

const PATH_TABS: Record<string, SettingsTab> = {
  '/settings': 'overview',
  '/settings/containers': 'containers',
  '/settings/federation': 'federation',
};

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = PATH_TABS[location.pathname] ?? 'overview';

  const switchTab = (tab: SettingsTab) => {
    navigate(TAB_PATHS[tab]);
  };

  return (
    <div className="settings-page">
      <AppHeader title="Paramètres" />
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'overview' ? 'settings-tab-active' : ''}`}
          onClick={() => switchTab('overview')}
        >
          Système
        </button>
        <button
          className={`settings-tab ${activeTab === 'containers' ? 'settings-tab-active' : ''}`}
          onClick={() => switchTab('containers')}
        >
          Containers
        </button>
        <button
          className={`settings-tab ${activeTab === 'federation' ? 'settings-tab-active' : ''}`}
          onClick={() => switchTab('federation')}
        >
          Fédération
        </button>
      </div>

      <div className={`settings-content${activeTab === 'containers' ? ' settings-content--fill' : ''}`}>
        {activeTab === 'overview' && <SystemSettings />}
        {activeTab === 'containers' && <ContainersSettings />}
        {activeTab === 'federation' && <FederationSettings />}
      </div>
    </div>
  );
}

// ─── System Settings ─────────────────────────────────────────────────────────

function SystemSettings() {
  const [settings, setSettings] = useState<SystemSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingAllUpdates, setCheckingAllUpdates] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    api.system.getSettings().then(data => {
      setSettings(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveSettings = async (updates: Partial<SystemSettingsData>) => {
    setSaving(true);
    try {
      await api.system.saveSettings(updates);
      setSettings(prev => prev ? { ...prev, ...updates } : null);
      addToast('success', 'Paramètres enregistrés');
    } catch {
      addToast('error', 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckAllUpdates = async () => {
    setCheckingAllUpdates(true);
    try {
      const result = await api.system.checkAllUpdates();
      addToast('success', `${result.checked} container(s) vérifié(s)`);
    } catch {
      addToast('error', 'Erreur lors de la vérification');
    } finally {
      setCheckingAllUpdates(false);
    }
  };

  if (loading) return <div className="settings-section"><div className="spinner" /></div>;
  if (!settings) return null;

  return (
    <div className="settings-section">
      <h2>Paramètres système</h2>

      {/* Instance HOMER — placed first */}
      <InstanceSettings />

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
          <label htmlFor="update-interval">Intervalle de vérification automatique</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              id="update-interval"
              type="number"
              className="input"
              style={{ maxWidth: '100px' }}
              min={30}
              max={43200}
              value={settings.updateCheckInterval}
              onChange={e => setSettings({ ...settings, updateCheckInterval: parseInt(e.target.value) || 10080 })}
              onBlur={() => saveSettings({ updateCheckInterval: settings.updateCheckInterval })}
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>minutes</span>
          </div>
          <span className="form-help">Fréquence à laquelle les images Docker sont comparées au registre (min. 30 min, défaut: 7 jours). Redémarrage requis pour prendre effet.</span>
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <button
            className="btn btn-secondary"
            onClick={handleCheckAllUpdates}
            disabled={checkingAllUpdates}
          >
            {checkingAllUpdates ? 'Vérification en cours...' : 'Vérifier maintenant'}
          </button>
        </div>
        <div className="toggle-row">
          <label className="toggle-label">
            <span>Mises à jour auto</span>
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
  const { addToast } = useToast();

  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [instanceInfo, setInstanceInfo] = useState<LocalInstanceInfo | null>(null);
  const [checking, setChecking] = useState(false);
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
      const data = await api.system.getVersion();
      setVersion(data);
      if (data.updateAvailable) {
        addToast('warning', `Mise à jour disponible : v${data.latestVersion}`);
      } else {
        addToast('success', 'Vous utilisez déjà la dernière version.');
      }
    } catch {
      addToast('error', 'Erreur lors de la vérification');
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
      await api.system.restart();
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
          {instanceInfo && (
            <>
              <div className="instance-version-row">
                <span>Id</span>
                <span className="version-badge" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{instanceInfo.name}</span>
              </div>
              <div className="instance-version-row">
                <span>Nom</span>
                <span className="version-badge">{instanceInfo ? displayName(instanceInfo, true) : '-'}</span>
              </div>
            </>
          )}
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
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const { addToast } = useToast();

  const loadContainers = async () => {
    const data = await api.system.getContainers();
    setContainers(data);
  };

  useEffect(() => {
    loadContainers().catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'remove' | 'checkUpdate', containerId: string) => {
    try {
      if (action === 'remove') return;
      if (action === 'checkUpdate') {
        await api.containers.checkUpdate(containerId);
        await loadContainers();
        return;
      }
      await api.containers[action](containerId);
      await loadContainers();
    } catch {}
  };

  const handleCheckAllUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const result = await api.system.checkAllUpdates();
      await loadContainers();
      addToast('success', `${result.checked} container(s) vérifié(s)`);
    } catch {
      addToast('error', 'Erreur lors de la vérification');
    } finally {
      setCheckingUpdates(false);
    }
  };

  if (loading) return <div className="settings-section"><div className="spinner" /></div>;

  return (
    <div style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Containers système</h2>
        <button
          className="btn btn-secondary"
          onClick={handleCheckAllUpdates}
          disabled={checkingUpdates}
        >
          {checkingUpdates ? 'Vérification...' : 'Vérifier les mises à jour'}
        </button>
      </div>
      {containers.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Aucun container système trouvé.</p>
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
