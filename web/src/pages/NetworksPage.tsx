import { useState, useEffect } from 'react';
import { AppHeader } from '../components/AppHeader';
import { DriverBadge, ScopeBadge, InternalBadge, UsedBadge, ContainerBadge } from '../components/Badges';
import { InfoTooltip } from '../components/FilterToolbar';
import { api, NetworkInfo } from '../api';
import { useConfirm } from '../hooks/useConfirm.js';
import { RefreshIcon, TrashIcon, GlobeIcon } from '../components/Icons';

export function NetworksPage() {
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { ConfirmDialog, confirm } = useConfirm();

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
    const unusedNetworks = networks.filter(n => !n.used).length;
    const confirmed = await confirm({
      title: 'Supprimer les réseaux',
      message: `Voulez-vous vraiment supprimer les ${unusedNetworks} réseaux inutilisés ? Cette action est irréversible.`,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (!confirmed) return;

    setPruning(true);
    setMessage(null);
    try {
      const result = await api.system.pruneNetworks();
      setMessage({ type: 'success', text: result.output });
      loadNetworks();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setPruning(false);
    }
  };

  const handleRemoveNetwork = async (name: string) => {
    const confirmed = await confirm({
      title: 'Supprimer le réseau',
      message: `Voulez-vous vraiment supprimer le réseau "${name}" ?`,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (!confirmed) return;

    try {
      const result = await api.system.removeNetwork(name);
      setMessage({ type: 'success', text: result.output });
      loadNetworks();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
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
      <ConfirmDialog />
      <div className="page-content">
        <div className="section-header">
          <h2 className="section-title">Réseaux Docker</h2>
          <span className="section-count">{networks.length} réseaux ({usedNetworks} utilisés, {unusedNetworks} inutilisés)</span>
        </div>

        <div className="containers-toolbar">

          <div className="toolbar-right">
            <InfoTooltip>
              <h3>Drivers réseau</h3>
              <p>
                <strong>bridge</strong> — Le driver par défaut. Crée un réseau isolé où les containers peuvent communiquer entre eux.
              </p>
              <p>
                <strong>host</strong> — Utilise directement la pile réseau de l'hôte. Pas d'isolation réseau.
              </p>
              <p>
                <strong>overlay</strong> — Réseau multi-host pour les clusters Swarm. Permet la communication entre containers sur différents hôtes.
              </p>
              <p>
                <strong>macvlan</strong> — Assigne une adresse MAC à chaque container, les rendant visibles comme appareils physiques sur le réseau.
              </p>
              <h3 style={{ marginTop: '0.75rem' }}>Scope</h3>
              <p>
                <strong>local</strong> — Le réseau n'existe que sur l'hôte local.
              </p>
              <p>
                <strong>swarm</strong> — Le réseau est distribué sur tous les nœuds du cluster Swarm.
              </p>
              <p>
                <strong>global</strong> — Le réseau est disponible sur tous les hôtes Docker.
              </p>
              <h3 style={{ marginTop: '0.75rem' }}>Réseau interne/externe</h3>
              <p>
                <strong>Interne</strong> — Le réseau n'a pas d'accès externe (pas de connexion Internet). Utile pour isoler des services sensibles.
              </p>
              <p>
                <strong>Externe</strong> — Le réseau peut accéder à l'extérieur et être accessible de l'extérieur.
              </p>
            </InfoTooltip>
            {unusedNetworks > 0 && (
              <button
                className="btn btn-danger"
                onClick={handlePrune}
                disabled={pruning}
                title="Supprimer tous les réseaux non utilisés par des containers"
              >
                {pruning ? '...' : 'Prune'}
              </button>
            )}

            <button className="btn btn-secondary" onClick={loadNetworks} disabled={loading} title="Rafraîchir la liste des réseaux">
              <RefreshIcon size={16} />
            </button>
          </div>
        </div>

        {message && (
          <div className={`action-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {networks.length === 0 ? (
          <div className="empty-state">
            <p>Aucun réseau trouvé</p>
          </div>
        ) : (
          <div className="resource-list">
            {networks.map(network => (
              <div key={network.id} className="resource-item volume-item">
                <div className="volume-header">
                  <div className="volume-main">
                    <div className="resource-name">
                      <GlobeIcon size={14} className="inline-icon" />
                      {network.name}
                    </div>
                    <div className="volume-meta">
                      <DriverBadge driver={network.driver} />
                      <ScopeBadge scope={network.scope} />
                      <InternalBadge internal={network.internal} />
                      <UsedBadge used={network.used ?? false} />
                    </div>
                  </div>
                  <div className="volume-right">
                    {!network.used && network.name !== 'bridge' && network.name !== 'host' && network.name !== 'none' && (
                      <button
                        className="btn btn-sm btn-danger-outline"
                        onClick={() => handleRemoveNetwork(network.name)}
                        title={`Supprimer le réseau ${network.name}`}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {(network.containers && network.containers.length > 0 || network.created) && (
                  <div className="volume-details">
                    {network.containers && network.containers.length > 0 && (
                      <div className="volume-path">
                        <span className="detail-label">Containers:</span>
                        {network.containers.map(c => (
                          <ContainerBadge key={c} container={c} />
                        ))}
                      </div>
                    )}
                    {network.created && (
                      <div className="volume-path">
                        <span className="detail-label">Créé:</span>
                        <span>{
                          network.created.includes('T')
                            ? new Date(network.created).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
                            : network.created
                        }</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}