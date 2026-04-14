import { useState, useEffect, useMemo } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SearchInput, FilterSelect, SortMenu } from '../components/FilterToolbar';
import { ContainerRow } from '../components/ContainerRow';
import { api, Container } from '../api';
import { useConfirm } from '../hooks/useConfirm.js';
import { UpdateIcon } from '../components/Icons';

type StateFilter = 'all' | 'running' | 'exited';

function StateFilterBadge({ 
  currentFilter, 
  onChange 
}: { 
  currentFilter: StateFilter; 
  onChange: (filter: StateFilter) => void;
}) {
  const cycleState = () => {
    const states: StateFilter[] = ['all', 'running', 'exited'];
    const currentIndex = states.indexOf(currentFilter);
    const nextIndex = (currentIndex + 1) % states.length;
    onChange(states[nextIndex]);
  };

  return (
    <button
      className={`status-badge ${currentFilter === 'running' ? 'status-running' : currentFilter === 'exited' ? 'status-stopped' : 'status-other'}`}
      onClick={cycleState}
      title="Cliquez pour changer l'état"
    >
      <span className="status-dot" />
      {currentFilter === 'all' ? 'Tous' : currentFilter === 'running' ? 'running' : 'exited'}
    </button>
  );
}

export function AllContainersPage() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [allProjects, setAllProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [updatesLoaded, setUpdatesLoaded] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [search, setSearch] = useState('');
  const [showUpdatesOnly, setShowUpdatesOnly] = useState(false);
  const [selectedProject, setSelectedProject] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');

  const { ConfirmDialog, confirm } = useConfirm();

  useEffect(() => {
    loadContainers();
  }, [search, selectedProject, showUpdatesOnly, stateFilter]);

  const loadContainers = async () => {
    setLoading(true);
    try {
      const data = await api.system.getAllContainers({
        search: search || undefined,
        project: selectedProject !== 'all' ? selectedProject : undefined,
        state: stateFilter !== 'all' ? stateFilter : undefined,
      });
      setContainers(data);
      
      const projects = Array.from(new Set(data.map(c => c.project).filter(Boolean))) as string[];
      setAllProjects(projects);
    } catch {
      setContainers([]);
    } finally {
      setLoading(false);
    }

    if (!updatesLoaded) {
      loadContainerUpdates();
    }
  };

  const loadContainerUpdates = async () => {
    if (loadingUpdates) return;
    setLoadingUpdates(true);
    try {
      const updates = await api.system.getContainerUpdates();
      setContainers(prev => prev.map(c => ({
        ...c,
        hasUpdate: updates[c.id]?.hasUpdate ?? false
      })));
      setUpdatesLoaded(true);
    } catch {
      // Silently fail - updates will remain hidden
    } finally {
      setLoadingUpdates(false);
    }
  };

  const toggleUpdates = async () => {
    if (!showUpdatesOnly) {
      if (!updatesLoaded) {
        setLoadingUpdates(true);
        await loadContainerUpdates();
        setLoadingUpdates(false);
      }
      setShowUpdatesOnly(true);
    } else {
      setShowUpdatesOnly(false);
    }
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'remove' | 'checkUpdate', containerId: string) => {
    setActionInProgress(`${action}-${containerId}`);
    setMessage(null);
    try {
      if (action === 'checkUpdate') {
        const result = await api.containers.checkUpdate(containerId);
        setMessage({ type: result.hasUpdate ? 'success' : 'success', text: result.hasUpdate ? 'Mise à jour disponible !' : 'Image à jour' });
        loadContainerUpdates();
      } else if (action === 'remove') {
        const confirmed = await confirm({
          title: 'Supprimer le container',
          message: 'Voulez-vous vraiment supprimer ce container ? Cette action est irréversible.',
          confirmText: 'Supprimer',
          type: 'danger',
        });
        if (!confirmed) {
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

  const runningCount = useMemo(() => containers.filter(c => c.state === 'running').length, [containers]);

  const sortedContainers = useMemo(() => {
    const sorted = [...containers];
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
      case 'created':
        return sorted.sort((a, b) => (new Date(b.created).getTime() - new Date(a.created).getTime()) * dir);
      default:
        return sorted;
    }
  }, [containers, sortBy, sortDirection]);

  if (loading && containers.length === 0) {
    return (
      <div className="page-container">
        <AppHeader title="Containers" />
        <div className="page-loading"><div className="spinner" />Chargement...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <AppHeader title="Containers" />
      <ConfirmDialog />
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

        <div className="containers-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Rechercher..."
            title="Rechercher dans les containers"
          />
          
          <FilterSelect
            value={selectedProject}
            onChange={setSelectedProject}
            options={allProjects.map(p => ({ value: p, label: p }))}
            placeholder="Tous les projets"
            title="Filtrer par projet"
          />

          <StateFilterBadge currentFilter={stateFilter} onChange={setStateFilter} />

          <div className="filter-toggle-wrapper">
            <span className="filter-toggle-label">Mise à jour</span>
            <button 
              className={`filter-toggle ${showUpdatesOnly ? 'active' : ''}`}
              onClick={toggleUpdates}
              disabled={loadingUpdates}
              title={showUpdatesOnly ? 'Afficher tous les containers' : 'Afficher uniquement les containers avec mise à jour'}
            >
              <span className="filter-toggle-handle" />
              <UpdateIcon size={12} />
            </button>
          </div>

          <div className="toolbar-right">
            <button 
              className="btn btn-secondary" 
              onClick={async () => {
                setLoadingUpdates(true);
                try {
                  await api.system.checkAllUpdates();
                  await loadContainerUpdates();
                } finally {
                  setLoadingUpdates(false);
                }
              }}
              disabled={loadingUpdates}
              title="Vérifier les mises à jour pour tous les containers"
            >
              <UpdateIcon size={16} />
            </button>
            <SortMenu 
              currentSort={sortBy} 
              sortDirection={sortDirection}
              onSortChange={setSortBy}
              onDirectionChange={setSortDirection}
              options={[
                { value: 'name', label: 'Nom' },
                { value: 'project', label: 'Projet' },
                { value: 'created', label: 'Date' },
              ]}
              showDirectionHint
            />
          </div>
        </div>

        {containers.length === 0 ? (
          <div className="empty-state">
            <p>{showUpdatesOnly ? 'Aucun container avec mise à jour disponible' : 'Aucun container trouvé'}</p>
          </div>
        ) : (
          <div className="resource-list">
            {sortedContainers.map(container => (
              <ContainerRow
                key={container.id}
                container={container}
                onAction={handleAction}
                actionInProgress={actionInProgress}
                showProject
                showCreated
                showMenu
                showUpdateInfo
                onProjectClick={setSelectedProject}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}