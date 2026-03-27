import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/index.js';
import '../styles/update-banner.css';

interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  configured: boolean;
}

export function UpdateBanner() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [restarting, setRestarting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const restartingRef = useRef(false);
  const restartPollRef = useRef<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const fetchVersion = useCallback(() => {
    api.system.getVersion().then(setVersionInfo).catch(() => {});
  }, []);

  useEffect(() => {
    fetchVersion();
    api.system.getSettings().then(d => setAutoUpdate(d.autoUpdate)).catch(() => {});
  }, [fetchVersion]);

  const startRestartPolling = useCallback(() => {
    if (restartPollRef.current) clearInterval(restartPollRef.current);
    restartPollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          clearInterval(restartPollRef.current!);
          window.location.reload();
        }
      } catch {
        // Server not ready yet — keep polling
      }
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
          if (msg.type === 'update_available') {
            fetchVersion();
          }
          if (msg.type === 'update_output') {
            setUpdateLogs(prev => [...prev, msg.line as string]);
          }
          if (msg.type === 'update_pull_done') {
            setUpdateLogs(prev => [...prev, '--- Redémarrage du conteneur en cours... ---']);
            restartingRef.current = true;
            setRestarting(true);
            setShowModal(false);
            startRestartPolling();
          }
          if (msg.type === 'update_error') {
            setUpdateLogs(prev => [...prev, `Erreur : ${msg.message as string}`]);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!restartingRef.current) {
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
    };
  }, [fetchVersion, startRestartPolling]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [updateLogs]);

  const triggerUpdate = async () => {
    setShowModal(true);
    setUpdateLogs(['Démarrage de la mise à jour...']);
    try {
      await api.system.update();
    } catch {
      setUpdateLogs(prev => [...prev, 'Erreur lors du démarrage de la mise à jour.']);
    }
  };

  const handleAutoUpdateToggle = async (value: boolean) => {
    setAutoUpdate(value);
    await api.system.saveSettings({ autoUpdate: value }).catch(() => {});
  };

  if (restarting) {
    return (
      <div className="update-restarting-overlay">
        <div className="update-restarting-content">
          <div className="spinner" />
          <p className="update-restarting-title">Redémarrage en cours...</p>
          <p className="update-restarting-sub">HOMER redémarre avec la nouvelle version</p>
        </div>
      </div>
    );
  }

  if (!versionInfo?.updateAvailable) return null;

  return (
    <>
      <div className="update-banner">
        <span className="update-banner-text">
          Mise à jour disponible : v{versionInfo.latestVersion}
        </span>
        <div className="update-banner-actions">
          <label className="update-auto-toggle" title="Mise à jour automatique">
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={e => handleAutoUpdateToggle(e.target.checked)}
            />
            Auto
          </label>
          <button className="update-banner-btn" onClick={triggerUpdate}>
            Mettre à jour
          </button>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal update-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Mise à jour de HOMER</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="update-log-container">
              {updateLogs.map((line, i) => (
                <div key={i} className="update-log-line">{line}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
