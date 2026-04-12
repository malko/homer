import { useState, useEffect } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, VolumeInfo } from '../api';

export function VolumesPage() {
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.system.getVolumes().then(data => {
      setVolumes(data);
      setLoading(false);
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Erreur');
      setLoading(false);
    });
  }, []);

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    api.system.getVolumes().then(data => {
      setVolumes(data);
      setLoading(false);
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Erreur');
      setLoading(false);
    });
  };

  if (loading) {
    return (
      <div className="page-container">
        <AppHeader title="Volumes" />
        <div className="page-loading"><div className="spinner" />Chargement...</div>
      </div>
    );
  }

  const dockerVolumes = volumes.filter(v => v.type === 'docker');
  const composeVolumes = volumes.filter(v => v.type === 'compose');

  return (
    <div className="page-container">
      <AppHeader title="Volumes" />
      <div className="page-content">
        <div className="section-header">
          <h2 className="section-title">Volumes Docker</h2>
          <span className="section-count">{volumes.length} volumes ({dockerVolumes.length} Docker, {composeVolumes.length} Compose)</span>
        </div>

        <div className="page-actions">
          <button className="btn btn-secondary" onClick={handleRefresh}>
            Actualiser
          </button>
        </div>

        {error && (
          <div className="action-message" style={{ color: 'var(--color-danger)' }}>
            {error}
          </div>
        )}

        {volumes.length === 0 ? (
          <div className="empty-state">
            <p>Aucun volume trouvé sur ce système Docker.</p>
            <p className="form-help">Les volumes Docker sont créés automatiquement par les containers qui en ont besoin (via docker compose ou docker run avec -v).</p>
            <p className="form-help">Si vous avez des projets HOMER, les volumes devraient apparaître ici.</p>
          </div>
        ) : (
          <div className="resource-list">
            {composeVolumes.length > 0 && (
              <>
                <h3 className="section-title" style={{ marginTop: '1rem' }}>Volumes déclarés dans les projets</h3>
                {composeVolumes.map(volume => (
                  <div key={volume.name} className="resource-item">
                    <div className="resource-info">
                      <div className="resource-name">
                        {volume.name}
                        <span className="detail-item" style={{ marginLeft: '0.5rem', color: 'var(--color-primary)' }}>
                          {volume.project}
                        </span>
                      </div>
                      <div className="resource-details">
                        <span className="detail-item">
                          <span className="detail-label">Driver:</span> {volume.driver}
                        </span>
                        <span className="detail-item">
                          <span className="detail-label">Type:</span> Compose
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {dockerVolumes.length > 0 && (
              <>
                <h3 className="section-title" style={{ marginTop: '1rem' }}>Volumes Docker</h3>
                {dockerVolumes.map(volume => (
                  <div key={volume.name} className="resource-item">
                    <div className="resource-info">
                      <div className="resource-name">{volume.name}</div>
                      <div className="resource-details">
                        <span className="detail-item">
                          <span className="detail-label">Driver:</span> {volume.driver}
                        </span>
                        <span className="detail-item">
                          <span className="detail-label">Scope:</span> {volume.scope}
                        </span>
                        {volume.created && (
                          <span className="detail-item">
                            <span className="detail-label">Créé:</span> {volume.created}
                          </span>
                        )}
                      </div>
                      {volume.mountpoint && (
                        <div className="resource-path" title={volume.mountpoint}>
                          <span className="detail-label">Mountpoint:</span> {volume.mountpoint}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}