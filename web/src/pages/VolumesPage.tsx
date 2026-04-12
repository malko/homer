import { useState, useEffect, useMemo } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SearchInput, FilterSelect, SortMenu, InfoTooltip } from '../components/FilterToolbar';
import { ProjectBadge, ServiceBadge, DriverBadge, ScopeBadge, OrphanBadge, ContainerBadge } from '../components/Badges';
import { api, VolumeInfo } from '../api';
import { useConfirm } from '../hooks/useConfirm.js';
import { 
  DatabaseIcon, TrashIcon, RefreshIcon
} from '../components/Icons';

export function VolumesPage() {
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [allProjects, setAllProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [typeFilter, setTypeFilter] = useState('all');

  const { ConfirmDialog, confirm } = useConfirm();

  useEffect(() => {
    loadVolumes();
  }, []);

  const loadVolumes = async () => {
    setLoading(true);
    try {
      const data = await api.system.getVolumes();
      setVolumes(data);
      const projects = Array.from(new Set(data.map(v => v.project).filter(Boolean))) as string[];
      setAllProjects(projects);
    } catch {
      setVolumes([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePrune = async () => {
    const unusedCount = volumes.filter(v => v.orphan && v.type === 'docker').length;
    const confirmed = await confirm({
      title: 'Supprimer les volumes',
      message: `Voulez-vous supprimer les ${unusedCount} volumes Docker non utilisés ? Cette action est irréversible.`,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (!confirmed) return;
    
    setPruning(true);
    setMessage(null);
    try {
      const result = await api.system.pruneVolumes();
      setMessage({ type: 'success', text: result.output || 'Volumes non utilisés supprimés' });
      loadVolumes();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setPruning(false);
    }
  };

  const handleRemoveVolume = async (volume: VolumeInfo) => {
    const confirmed = await confirm({
      title: 'Supprimer le volume',
      message: `Voulez-vous supprimer le volume "${volume.name}" ? Cette action est irréversible.`,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (!confirmed) return;
    
    try {
      const result = await api.system.removeVolume(volume.name);
      if (result.success) {
        setMessage({ type: 'success', text: result.output });
        loadVolumes();
      } else {
        setMessage({ type: 'error', text: result.output });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
    }
  };

  const filteredVolumes = useMemo(() => {
    let filtered = [...volumes];
    
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(v => 
        v.name.toLowerCase().includes(searchLower) ||
        v.hostPath?.toLowerCase().includes(searchLower) ||
        v.mountpoint?.toLowerCase().includes(searchLower) ||
        v.project?.toLowerCase().includes(searchLower) ||
        v.service?.toLowerCase().includes(searchLower)
      );
    }
    
    if (selectedProject !== 'all') {
      filtered = filtered.filter(v => v.project === selectedProject);
    }
    
    if (typeFilter !== 'all') {
      filtered = filtered.filter(v => v.type === typeFilter);
    }
    
    return filtered;
  }, [volumes, search, selectedProject, typeFilter]);

  const sortedVolumes = useMemo(() => {
    const sorted = [...filteredVolumes];
    const dir = sortDirection === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'name':
        return sorted.sort((a, b) => a.name.localeCompare(b.name) * dir);
      case 'project':
        return sorted.sort((a, b) => {
          if (!a.project && !b.project) return 0;
          if (!a.project) return 1 * dir;
          if (!b.project) return -1 * dir;
          return a.project.localeCompare(b.project) * dir;
        });
      case 'size':
        return sorted.sort((a, b) => {
          const sizeA = parseSize(a.size);
          const sizeB = parseSize(b.size);
          return (sizeA - sizeB) * dir;
        });
      default:
        return sorted;
    }
  }, [filteredVolumes, sortBy, sortDirection]);

  const dockerVolumes = sortedVolumes.filter(v => v.type === 'docker');
  const composeVolumes = sortedVolumes.filter(v => v.type === 'compose');
  const bindVolumes = sortedVolumes.filter(v => v.type === 'bind');

  const unusedVolumes = volumes.filter(v => v.orphan && v.type === 'docker').length;

  if (loading) {
    return (
      <div className="page-container">
        <AppHeader title="Volumes" />
        <div className="page-loading"><div className="spinner" />Chargement...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <AppHeader title="Volumes" />
      <ConfirmDialog />
      <div className="page-content">
        <div className="section-header">
          <h2 className="section-title">Volumes</h2>
          <span className="section-count">
            {sortedVolumes.length} / {volumes.length} volumes
          </span>
        </div>

        <div className="containers-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Rechercher (nom, chemin, projet)..."
            title="Rechercher dans les volumes"
          />
          
          <FilterSelect
            value={selectedProject}
            onChange={setSelectedProject}
            options={allProjects.map(p => ({ value: p, label: p }))}
            placeholder="Tous les projets"
            title="Filtrer par projet"
          />

          <FilterSelect
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'docker', label: 'Docker' },
              { value: 'compose', label: 'Compose' },
              { value: 'bind', label: 'Bind' },
            ]}
            placeholder="Tous les types"
            title="Filtrer par type de volume"
          />

          <InfoTooltip>
            <h3>Types de volumes</h3>
            <p>
              <strong>Docker</strong> — Volumes gérés par Docker, stockés dans son espace système. Idéaux pour persister des données de containers.
            </p>
            <p>
              <strong>Compose</strong> — Volumes nommés définis dans un fichier compose (section <code>volumes:</code>). Gérés automatiquement par Docker Compose.
            </p>
            <p>
              <strong>Bind</strong> — Chemins de l'hôte montés directement dans les containers. Utile pour partager des fichiers entre host et container.
            </p>
          </InfoTooltip>

          <div className="toolbar-right">
            {unusedVolumes > 0 && (
              <button 
                className="btn btn-danger" 
                onClick={handlePrune}
                disabled={pruning}
                title="Supprimer tous les volumes Docker non utilisés par des containers"
              >
                {pruning ? '...' : 'Prune'}
              </button>
            )}

            <button className="btn btn-secondary" onClick={loadVolumes} title="Rafraîchir la liste des volumes">
              <RefreshIcon size={16} />
            </button>

            <SortMenu 
              currentSort={sortBy}
              sortDirection={sortDirection}
              onSortChange={setSortBy}
              onDirectionChange={setSortDirection}
              options={[
                { value: 'name', label: 'Nom' },
                { value: 'project', label: 'Projet' },
                { value: 'size', label: 'Taille' },
              ]}
            />
          </div>
        </div>

        {message && (
          <div className={`action-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {sortedVolumes.length === 0 ? (
          <div className="empty-state">
            <p>Aucun volume trouvé.</p>
            <p className="form-help">Essayez de modifier vos filtres de recherche.</p>
          </div>
        ) : (
          <div className="resource-list">
            {bindVolumes.length > 0 && (
              <div className="volume-section">
                <h3 className="section-title">
                  <span className="volume-type-badge bind">Bind</span>
                  Dossiers hôtes montés
                </h3>
                {bindVolumes.map(volume => (
                  <div key={`${volume.project}-${volume.service}-${volume.hostPath}`} className="resource-item volume-item">
                    <div className="volume-header">
                      <div className="volume-main">
                        <div className="resource-name" title={volume.hostPath}>
                          <DatabaseIcon size={14} className="inline-icon" />
                          {volume.hostPath}
                        </div>
                        <div className="volume-meta">
                          {volume.project && (
                            <ProjectBadge 
                              project={volume.project} 
                              onClick={() => setSelectedProject(volume.project || 'all')} 
                            />
                          )}
                          {volume.service && (
                            <ServiceBadge service={volume.service} />
                          )}
                        </div>
                      </div>
                      <div className="volume-right">
                        {volume.size ? (
                          <div className="volume-size">{volume.size}</div>
                        ) : (
                          <InfoTooltip>
                            <p>Impossible de calculer la taille du dossier.</p>
                            <p className="form-help">Le serveur n'a pas accès à ce chemin ou le calcul a expiré.</p>
                          </InfoTooltip>
                        )}
                      </div>
                    </div>
                    <div className="volume-details">
                      <div className="volume-path">
                        <span className="detail-label">Conteneur:</span>
                        <code>{volume.containerPath}</code>
                      </div>
                      {volume.created && (
                        <div className="volume-path">
                          <span className="detail-label">Créé:</span>
                          <span>{volume.created}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {composeVolumes.length > 0 && (
              <div className="volume-section">
                <h3 className="section-title">
                  <span className="volume-type-badge compose">Compose</span>
                  Volumes nommés
                </h3>
                {composeVolumes.map(volume => (
                  <div key={`${volume.project}-${volume.name}`} className="resource-item volume-item">
                    <div className="volume-header">
                      <div className="volume-main">
                        <div className="resource-name">
                          <DatabaseIcon size={14} className="inline-icon" />
                          {volume.name}
                        </div>
                        <div className="volume-meta">
                          {volume.project && (
                            <ProjectBadge 
                              project={volume.project} 
                              onClick={() => setSelectedProject(volume.project || 'all')} 
                            />
                          )}
<DriverBadge driver={volume.driver} />
                          {volume.orphan && <OrphanBadge label="non utilisé" />}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {composeVolumes.length > 0 && (
              <div className="volume-section">
                <h3 className="section-title">
                  <span className="volume-type-badge compose">Compose</span>
                  Volumes nommés
                </h3>
                {composeVolumes.map(volume => (
                  <div key={`${volume.project}-${volume.name}`} className="resource-item volume-item">
                    <div className="volume-header">
                      <div className="volume-main">
                        <div className="resource-name">
                          <DatabaseIcon size={14} className="inline-icon" />
                          {volume.name}
                        </div>
                        <div className="volume-meta">
                          {volume.project && (
                            <ProjectBadge 
                              project={volume.project} 
                              onClick={() => setSelectedProject(volume.project || 'all')} 
                            />
                          )}
                          <DriverBadge driver={volume.driver} />
                          {volume.orphan && <OrphanBadge label="non utilisé" />}
                        </div>
                      </div>
                      <div className="volume-right">
                        {volume.orphan && volume.type === 'compose' && (
                          <button 
                            className="btn btn-sm btn-danger-outline"
                            onClick={() => handleRemoveVolume(volume)}
                            title="Supprimer ce volume"
                          >
                            <TrashIcon size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {(volume.created || volume.usedBy) && (
                      <div className="volume-details">
                        {volume.usedBy && volume.usedBy.projects.length > 0 && (
                          <div className="volume-path">
                            <span className="detail-label">Utilisé par:</span>
                            {volume.usedBy.projects.map(p => (
                              <ProjectBadge key={p} project={p} />
                            ))}
                          </div>
                        )}
                        {volume.usedBy && volume.usedBy.containers.length > 0 && (
                          <div className="volume-path">
                            <span className="detail-label">Containers:</span>
                            {volume.usedBy.containers.map(c => (
                              <ContainerBadge key={c} container={c} />
                            ))}
                          </div>
                        )}
                        {volume.created && (
                          <div className="volume-path">
                            <span className="detail-label">Créé:</span>
                            <span>{volume.created}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {dockerVolumes.length > 0 && (
              <div className="volume-section">
                <h3 className="section-title">
                  <span className="volume-type-badge docker">Docker</span>
                  Volumes gérés
                </h3>
                {dockerVolumes.map(volume => (
                  <div key={volume.name} className="resource-item volume-item">
                    <div className="volume-header">
                      <div className="volume-main">
                        <div className="resource-name">
                          <DatabaseIcon size={14} className="inline-icon" />
                          {volume.name}
                        </div>
                        <div className="volume-meta">
                          <DriverBadge driver={volume.driver} />
                          <ScopeBadge scope={volume.scope} />
                          {volume.orphan && <OrphanBadge />}
                        </div>
                      </div>
                      <div className="volume-right">
                        {volume.size && <div className="volume-size">{volume.size}</div>}
                        {volume.orphan && volume.type === 'docker' && (
                          <button 
                            className="btn btn-sm btn-danger-outline"
                            onClick={() => handleRemoveVolume(volume)}
                            title="Supprimer ce volume (uniquement si non utilisé par un container)"
                          >
                            <TrashIcon size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {(volume.mountpoint || volume.usedBy) && (
                      <div className="volume-details">
                        {volume.usedBy && volume.usedBy.projects.length > 0 && (
                          <div className="volume-path">
                            <span className="detail-label">Utilisé par:</span>
                            {volume.usedBy.projects.map(p => (
                              <ProjectBadge key={p} project={p} />
                            ))}
                          </div>
                        )}
                        {volume.usedBy && volume.usedBy.containers.length > 0 && (
                          <div className="volume-path">
                            <span className="detail-label">Containers:</span>
                            {volume.usedBy.containers.map(c => (
                              <ContainerBadge key={c} container={c} />
                            ))}
                          </div>
                        )}
                        {volume.mountpoint && (
                          <div className="volume-path">
                            <span className="detail-label">Mountpoint:</span>
                            <code>{volume.mountpoint}</code>
                          </div>
                        )}
                        {volume.created && (
                          <div className="volume-path">
                            <span className="detail-label">Créé:</span>
                            <span>{volume.created}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function parseSize(size: string | undefined): number {
  if (!size) return 0;
  const match = size.match(/^([\d.]+)([KMGT]?)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = { '': 1, K: 1024, M: 1024**2, G: 1024**3, T: 1024**4 };
  return value * (multipliers[unit] || 1);
}