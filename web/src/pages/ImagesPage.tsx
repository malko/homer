import { useState, useEffect } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, ImageInfo } from '../api';
import { useConfirm } from '../hooks/useConfirm.js';

export function ImagesPage() {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);
  const [pruneOutput, setPruneOutput] = useState<string | null>(null);

  const { ConfirmDialog, confirm } = useConfirm();

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = () => {
    api.system.getImages().then(data => {
      setImages(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const handlePrune = async (danglingOnly: boolean) => {
    const message = danglingOnly
      ? 'Voulez-vous vraiment supprimer les images dangling (non tagguées) ?'
      : `Voulez-vous vraiment supprimer les ${unusedImages} images inutilisées par des containers ? Cette action est irréversible.`;
    
    const confirmed = await confirm({
      title: danglingOnly ? 'Supprimer les images dangling' : 'Supprimer les images inutilisées',
      message,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (!confirmed) return;
    
    setPruning(true);
    setPruneOutput(null);
    try {
      const result = await api.system.pruneImages(danglingOnly);
      setPruneOutput(result.output);
      loadImages();
    } catch (err) {
      setPruneOutput(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setPruning(false);
    }
  };

  const handleRemoveImage = async (imageId: string, force = false) => {
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
      const result = await api.system.removeImage(imageId, force);
      setPruneOutput(result.output);
      loadImages();
    } catch (err) {
      setPruneOutput(err instanceof Error ? err.message : 'Erreur');
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

  const usedImages = images.filter(i => i.used).length;
  const unusedImages = images.length - usedImages;

  return (
    <div className="page-container">
      <AppHeader title="Images" />
      <ConfirmDialog />
      <div className="page-content">
        <div className="section-header">
          <h2 className="section-title">Images Docker</h2>
          <span className="section-count">{images.length} images ({usedImages} utilisées, {unusedImages} inutilisées)</span>
        </div>

        <div className="page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => handlePrune(true)}
            disabled={pruning}
            title="Supprime uniquement les images taguées <none> (non utilisées par aucun container)"
          >
            {pruning ? 'Nettoyage...' : "Supprimer images dangling"}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handlePrune(false)}
            disabled={pruning}
            title="Supprime toutes les images non utilisées par des containers"
          >
            {pruning ? 'Nettoyage...' : 'Supprimer images inutilisées'}
          </button>
        </div>

        {pruneOutput && (
          <div className="action-message">
            {pruneOutput}
          </div>
        )}

        {images.length === 0 ? (
          <div className="empty-state">
            <p>Aucune image trouvée</p>
          </div>
        ) : (
          <div className="resource-list">
            {images.map(image => (
              <div key={image.id} className="resource-item">
                <div className="resource-info">
                  <div className="resource-name">
                    {image.repository}:{image.tag}
                    {image.repository === '<none>' && <span className="detail-item" style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)' }}>(dangling)</span>}
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
                  </div>
                </div>
                <div className="resource-actions">
                  {!image.used && (
                    <button 
                      className="btn btn-sm btn-danger-outline" 
                      onClick={() => handleRemoveImage(image.id, false)}
                      title="Supprimer cette image"
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