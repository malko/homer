import { api } from '../api/index.js';
import { useProjectUpdates } from '../hooks/useProjectUpdates';

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export function UpdatesModal() {
  const {
    updates,
    notificationsEnabled,
    showModal,
    setShowModal,
    fetchUpdates,
    toggleNotifications,
    dismissProject,
    clearDismissed,
  } = useProjectUpdates();

  if (!showModal) return null;

  const handleUpdateProject = async (projectId: number) => {
    try {
      await api.projects.updateImages(projectId);
      fetchUpdates();
    } catch (err) {
      console.error('Failed to update project:', err);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setShowModal(false)}>
      <div className="modal updates-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mises à jour disponibles</h2>
          <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
        </div>

        <div className="updates-modal-content">
          {updates.length === 0 ? (
            <p className="updates-empty">Aucune mise à jour disponible.</p>
          ) : (
            <ul className="updates-list">
              {updates.map(project => (
                <li key={project.id} className="updates-list-item">
                  <div className="updates-project-info">
                    <span className="updates-project-name">{project.name}</span>
                    <span className="updates-project-services">
                      Services: {project.services.join(', ')}
                    </span>
                  </div>
                  <div className="updates-project-actions">
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleUpdateProject(project.id)}
                    >
                      Mettre à jour
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => dismissProject(project.id)}
                      title="Masquer cette notification"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="updates-modal-footer">
          <label className="updates-notifications-toggle">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={toggleNotifications}
            />
            Notifications web actives
          </label>

          <div className="updates-modal-footer-actions">
            {updates.length > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={clearDismissed}>
                <RefreshIcon />
                Rafraîchir
              </button>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => setShowModal(false)}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}