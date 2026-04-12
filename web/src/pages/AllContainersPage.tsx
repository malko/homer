import { useState, useEffect } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, Container } from '../api';

export function AllContainersPage() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadContainers();
  }, []);

  const loadContainers = () => {
    api.system.getAllContainers().then(data => {
      setContainers(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'remove' | 'updateImage', containerId: string) => {
    setActionInProgress(`${action}-${containerId}`);
    setMessage(null);
    try {
      if (action === 'updateImage') {
        const result = await api.containers.updateImage(containerId);
        setMessage({ type: result.success ? 'success' : 'error', text: result.output });
      } else if (action === 'remove') {
        if (!confirm('Voulez-vous vraiment supprimer ce container ? Cette action est irréversible.')) {
          setActionInProgress(null);
          return;
        }
        const result = await api.containers.remove(containerId);
        setMessage({ type: result.success ? 'success' : 'error', text: result.output });
      } else {
        await api.containers[action](containerId);
        setMessage({ type: 'success', text: `Container ${action === 'restart' ? 'redémarré' : action === 'stop' ? 'arrêté' : 'démarré'} avec succès` });
      }
      loadContainers();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setActionInProgress(null);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <AppHeader title="Containers" />
        <div className="page-loading"><div className="spinner" />Chargement...</div>
      </div>
    );
  }

  const runningCount = containers.filter(c => c.state === 'running').length;

  return (
    <div className="page-container">
      <AppHeader title="Containers" />
      <div className="page-content">
        <div className="section-header">
          <h2 className="section-title">Containers Docker</h2>
          <span className="section-count">{runningCount} / {containers.length} démarrés</span>
        </div>

        {message && (
          <div className={`action-message ${message.type === 'error' ? 'error' : ''}`}>
            {message.text}
          </div>
        )}

        <div className="page-actions">
          <button className="btn btn-secondary" onClick={loadContainers} disabled={loading}>
            Actualiser
          </button>
        </div>

        {containers.length === 0 ? (
          <div className="empty-state">
            <p>Aucun container trouvé</p>
          </div>
        ) : (
          <div className="resource-list">
            {containers.map(container => (
              <div key={container.id} className="resource-item">
                <div className="resource-info">
                  <div className="resource-name">{container.name}</div>
                  <div className="resource-details">
                    <span className={`status-badge ${container.state === 'running' ? 'status-running' : 'status-stopped'}`}>
                      <span className="status-dot" />
                      {container.state}
                    </span>
                    {container.project && (
                      <span className="detail-item">
                        <span className="detail-label">Projet:</span> {container.project}
                      </span>
                    )}
                    {container.service && (
                      <span className="detail-item">
                        <span className="detail-label">Service:</span> {container.service}
                      </span>
                    )}
                    <span className="detail-item">
                      <span className="detail-label">Image:</span> {container.image}
                    </span>
                    {container.hasUpdate && (
                      <span className="detail-item update-badge">
                        Mise à jour disponible
                      </span>
                    )}
                  </div>
                </div>
                <div className="resource-actions">
                  {container.state === 'running' ? (
                    <>
                      <button 
                        className="btn btn-sm btn-secondary" 
                        onClick={() => handleAction('restart', container.id)}
                        disabled={!!actionInProgress}
                      >
                        {actionInProgress === `restart-${container.id}` ? '...' : 'Restart'}
                      </button>
                      <button 
                        className="btn btn-sm btn-danger" 
                        onClick={() => handleAction('stop', container.id)}
                        disabled={!!actionInProgress}
                      >
                        {actionInProgress === `stop-${container.id}` ? '...' : 'Stop'}
                      </button>
                    </>
                  ) : (
                    <button 
                      className="btn btn-sm btn-success" 
                      onClick={() => handleAction('start', container.id)}
                      disabled={!!actionInProgress}
                    >
                      {actionInProgress === `start-${container.id}` ? '...' : 'Start'}
                    </button>
                  )}
                  {container.hasUpdate && (
                    <button 
                      className="btn btn-sm btn-primary" 
                      onClick={() => handleAction('updateImage', container.id)}
                      disabled={!!actionInProgress}
                      title="Mettre à jour l'image du container"
                    >
                      {actionInProgress === `updateImage-${container.id}` ? '...' : 'Update'}
                    </button>
                  )}
                  <button 
                    className="btn btn-sm btn-danger-outline" 
                    onClick={() => handleAction('remove', container.id)}
                    disabled={!!actionInProgress}
                    title="Supprimer ce container"
                  >
                    {actionInProgress === `remove-${container.id}` ? '...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}