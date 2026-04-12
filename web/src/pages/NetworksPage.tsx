import { useState, useEffect } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, NetworkInfo } from '../api';

export function NetworksPage() {
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadNetworks();
  }, []);

  const loadNetworks = () => {
    setLoading(true);
    api.system.getNetworks().then(data => {
      setNetworks(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const handlePrune = async () => {
    if (!confirm(`Voulez-vous vraiment supprimer les ${unusedNetworks} réseaux inutilisés ? Cette action est irréversible.`)) {
      return;
    }
    
    setPruning(true);
    setMessage(null);
    try {
      const result = await api.system.pruneNetworks();
      setMessage(result.output);
      loadNetworks();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setPruning(false);
    }
  };

  const handleRemoveNetwork = async (name: string) => {
    if (!confirm(`Voulez-vous vraiment supprimer le réseau "${name}" ?`)) {
      return;
    }
    
    try {
      const result = await api.system.removeNetwork(name);
      setMessage(result.output);
      loadNetworks();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erreur');
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <AppHeader title="Réseaux" />
        <div className="page-loading"><div className="spinner" />Chargement...</div>
      </div>
    );
  }

  const usedNetworks = networks.filter(n => n.used).length;
  const unusedNetworks = networks.length - usedNetworks;

  return (
    <div className="page-container">
      <AppHeader title="Réseaux" />
      <div className="page-content">
        <div className="section-header">
          <h2 className="section-title">Réseaux Docker</h2>
          <span className="section-count">{networks.length} réseaux ({usedNetworks} utilisés, {unusedNetworks} inutilisés)</span>
        </div>

        <div className="page-actions">
          <button
            className="btn btn-secondary"
            onClick={loadNetworks}
            disabled={loading}
          >
            Actualiser
          </button>
          {unusedNetworks > 0 && (
            <button
              className="btn btn-danger"
              onClick={handlePrune}
              disabled={pruning}
              title="Supprime tous les réseaux non utilisés par des containers"
            >
              {pruning ? 'Nettoyage...' : 'Supprimer réseaux inutilisés'}
            </button>
          )}
        </div>

        {message && (
          <div className="action-message">
            {message}
          </div>
        )}

        {networks.length === 0 ? (
          <div className="empty-state">
            <p>Aucun réseau trouvé</p>
          </div>
        ) : (
          <div className="resource-list">
            {networks.map(network => (
              <div key={network.id} className="resource-item">
                <div className="resource-info">
                  <div className="resource-name">
                    {network.name}
                    {!network.used && (
                      <span className="detail-item" style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)' }}>
                        (inutilisé)
                      </span>
                    )}
                  </div>
                  <div className="resource-details">
                    <span className="detail-item">
                      <span className="detail-label">Driver:</span> {network.driver}
                    </span>
                    <span className="detail-item">
                      <span className="detail-label">Scope:</span> {network.scope}
                    </span>
                    <span className="detail-item">
                      <span className="detail-label">Interne:</span> {network.internal ? 'Oui' : 'Non'}
                    </span>
                    <span className="detail-item">
                      <span className="detail-label">Créé:</span> {network.created}
                    </span>
                    {network.containers && network.containers.length > 0 && (
                      <span className="detail-item">
                        <span className="detail-label">Containers:</span> {network.containers.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="resource-actions">
                  {!network.used && network.name !== 'bridge' && network.name !== 'host' && network.name !== 'none' && (
                    <button 
                      className="btn btn-sm btn-danger-outline" 
                      onClick={() => handleRemoveNetwork(network.name)}
                      title={`Supprimer le réseau ${network.name}`}
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}