import { useState, useEffect, useMemo } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SearchInput, FilterSelect, SortMenu } from '../components/FilterToolbar';
import { ProjectBadge } from '../components/Badges';
import { api, ImageInfo } from '../api';
import { useConfirm } from '../hooks/useConfirm.js';
import { TrashIcon, RefreshIcon } from '../components/Icons';

export function ImagesPage() {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [search, setSearch] = useState('');
  const [usedFilter, setUsedFilter] = useState('all');
  const [selectedProject, setSelectedProject] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  const { ConfirmDialog, confirm } = useConfirm();

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = (silent = false) => {
    if (!silent) setLoading(true);
    api.system.getImages().then(data => {
      setImages(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const allProjects = useMemo(() => {
    const projects = new Set<string>();
    for (const img of images) {
      img.projects?.forEach(p => projects.add(p));
    }
    return Array.from(projects).sort();
  }, [images]);

  const filteredImages = useMemo(() => {
    let filtered = [...images];

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(img =>
        img.repository.toLowerCase().includes(s) ||
        img.tag.toLowerCase().includes(s) ||
        img.projects?.some(p => p.toLowerCase().includes(s))
      );
    }

    if (usedFilter === 'used') filtered = filtered.filter(img => img.used);
    if (usedFilter === 'unused') filtered = filtered.filter(img => !img.used);

    if (selectedProject !== 'all') {
      filtered = filtered.filter(img => img.projects?.includes(selectedProject));
    }

    return filtered;
  }, [images, search, usedFilter, selectedProject]);

  const sortedImages = useMemo(() => {
    const sorted = [...filteredImages];
    const dir = sortDirection === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'name':
        return sorted.sort((a, b) => `${a.repository}:${a.tag}`.localeCompare(`${b.repository}:${b.tag}`) * dir);
      case 'size':
        return sorted.sort((a, b) => parseSize(a.size, b.size) * dir);
      case 'created':
        return sorted.sort((a, b) => a.created.localeCompare(b.created) * dir);
      default:
        return sorted;
    }
  }, [filteredImages, sortBy, sortDirection]);

  const handlePrune = async (danglingOnly: boolean) => {
    const unusedCount = images.filter(i => !i.used).length;
    const message = danglingOnly
      ? 'Voulez-vous vraiment supprimer les images dangling (non tagguées) ?'
      : `Voulez-vous vraiment supprimer les ${unusedCount} images inutilisées par des containers ? Cette action est irréversible.`;

    const confirmed = await confirm({
      title: danglingOnly ? 'Supprimer les images dangling' : 'Supprimer les images inutilisées',
      message,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (!confirmed) return;

    setPruning(true);
    setMessage(null);
    try {
      const result = await api.system.pruneImages(danglingOnly);
      setMessage({ type: 'success', text: result.output });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setPruning(false);
      loadImages(true);
    }
  };

  const handleRemoveImage = async (imageId: string) => {
    const image = images.find(i => i.id === imageId);
    const imageName = image ? `${image.repository}:${image.tag}` : imageId;

    const confirmed = await confirm({
      title: "Supprimer l'image",
      message: `Voulez-vous vraiment supprimer l'image "${imageName}" ?`,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (!confirmed) return;

    try {
      const result = await api.system.removeImage(imageId, false);
      setMessage(result.success
        ? { type: 'success', text: result.output }
        : { type: 'error', text: result.output }
      );
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      loadImages(true);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <AppHeader title="Images" />
        <div className="page-loading"><div className="spinner" />Chargement...</div>
      </div>
    );
  }

  const usedCount = images.filter(i => i.used).length;
  const unusedCount = images.length - usedCount;

  return (
    <div className="page-container">
      <AppHeader title="Images" />
      <ConfirmDialog />
      <div className="page-content">
        <div className="section-header">
          <h2 className="section-title">Images Docker</h2>
          <span className="section-count">
            {sortedImages.length} / {images.length} images ({usedCount} utilisées, {unusedCount} inutilisées)
          </span>
        </div>

        <div className="containers-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Rechercher (nom, tag, projet)..."
            title="Rechercher dans les images"
          />

          <FilterSelect
            value={usedFilter}
            onChange={setUsedFilter}
            options={[
              { value: 'used', label: 'Utilisées' },
              { value: 'unused', label: 'Inutilisées' },
            ]}
            placeholder="Toutes"
            title="Filtrer par utilisation"
          />

          {allProjects.length > 0 && (
            <FilterSelect
              value={selectedProject}
              onChange={setSelectedProject}
              options={allProjects.map(p => ({ value: p, label: p }))}
              placeholder="Tous les projets"
              title="Filtrer par projet"
            />
          )}

          <div className="toolbar-right">
            {unusedCount > 0 && (
              <button
                className="btn btn-secondary"
                onClick={() => handlePrune(true)}
                disabled={pruning}
                title="Supprime uniquement les images taguées <none>"
              >
                {pruning ? '...' : 'Prune dangling'}
              </button>
            )}
            {unusedCount > 0 && (
              <button
                className="btn btn-danger"
                onClick={() => handlePrune(false)}
                disabled={pruning}
                title="Supprime toutes les images non utilisées par des containers"
              >
                {pruning ? '...' : 'Prune inutilisées'}
              </button>
            )}

            <button className="btn btn-secondary" onClick={() => loadImages()} title="Rafraîchir la liste des images">
              <RefreshIcon size={16} />
            </button>

            <SortMenu
              currentSort={sortBy}
              sortDirection={sortDirection}
              onSortChange={setSortBy}
              onDirectionChange={setSortDirection}
              options={[
                { value: 'name', label: 'Nom' },
                { value: 'size', label: 'Taille' },
                { value: 'created', label: 'Date' },
              ]}
            />
          </div>
        </div>

        {message && (
          <div className={`action-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {sortedImages.length === 0 ? (
          <div className="empty-state">
            <p>Aucune image trouvée.</p>
            {(search || usedFilter !== 'all' || selectedProject !== 'all') && (
              <p className="form-help">Essayez de modifier vos filtres de recherche.</p>
            )}
          </div>
        ) : (
          <div className="resource-list">
            {sortedImages.map(image => (
              <div key={image.id} className="resource-item">
                <div className="resource-info">
                  <div className="resource-name">
                    {image.repository}:{image.tag}
                    {image.repository === '<none>' && (
                      <span className="detail-item" style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)' }}>(dangling)</span>
                    )}
                  </div>
                  <div className="resource-details">
                    <span className="detail-item">
                      <span className="detail-label">Taille:</span> {image.size}
                    </span>
                    <span className="detail-item">
                      <span className="detail-label">Créé:</span> {image.created}
                    </span>
                    <span className={`detail-item ${image.used ? 'text-success' : 'text-muted'}`}>
                      {image.used ? '✓ Utilisée' : '✗ Non utilisée'}
                    </span>
                    {image.projects?.map(p => (
                      <ProjectBadge
                        key={p}
                        project={p}
                        onClick={() => setSelectedProject(p)}
                      />
                    ))}
                  </div>
                </div>
                <div className="resource-actions">
                  {!image.used && (
                    <button
                      className="btn btn-sm btn-danger-outline btn-icon"
                      onClick={() => handleRemoveImage(image.id)}
                      title="Supprimer cette image"
                    >
                      <TrashIcon size={14} />
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

function parseSize(a: string, b: string): number {
  const parse = (s: string) => {
    if (!s) return 0;
    const match = s.match(/^([\d.]+)\s*([KMGT]?B?)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase().replace('B', '');
    const multipliers: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
    return value * (multipliers[unit] ?? 1);
  };
  return parse(a) - parse(b);
}
