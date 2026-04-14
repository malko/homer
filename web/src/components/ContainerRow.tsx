import { useState } from 'react';
import { api, Container } from '../api';
import { ContainerMenu } from './ContainerMenu';
import {
  FolderIcon, ImageIcon, UpdateIcon,
  PlayIcon, StopIcon, RestartIcon
} from './Icons';

interface ContainerRowProps {
  container: Container;
  onRefresh?: () => void;
  onAction?: (action: 'start' | 'stop' | 'restart' | 'remove' | 'checkUpdate', containerId: string) => void;
  actionInProgress?: string | null;
  showProject?: boolean;
  showCreated?: boolean;
  showMenu?: boolean;
  showPorts?: boolean;
  showUpdateInfo?: boolean;
  onProjectClick?: (project: string) => void;
}

export function ContainerRow({
  container,
  onRefresh,
  onAction,
  actionInProgress,
  showProject = false,
  showCreated = false,
  showMenu = true,
  showPorts = false,
  showUpdateInfo = false,
  onProjectClick,
}: ContainerRowProps) {
  const [localLoading, setLocalLoading] = useState<string | null>(null);
  const isRunning = container.state === 'running';

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    if (onAction) {
      onAction(action, container.id);
      return;
    }
    setLocalLoading(action);
    try {
      await api.containers[action](container.id);
      onRefresh?.();
    } catch {} finally {
      setLocalLoading(null);
    }
  };

  const loading = actionInProgress ? actionInProgress.startsWith(actionInProgress.split('-')[0]) : !!localLoading;
  const isActionDisabled = !!actionInProgress || !!localLoading;

  const imageParts = container.image.split(':');
  const imageName = imageParts[0];
  const imageTag = imageParts[1] || 'latest';

  return (
    <div className="resource-item">
      <div className="resource-info">
        <div className="resource-name">{container.name}</div>
        <div className="resource-details">
          <span className={`status-badge ${container.state === 'running' ? 'status-running' : container.state === 'exited' ? 'status-stopped' : 'status-other'}`}>
            <span className="status-dot" />
            {container.state}
          </span>
          {showPorts && container.ports && container.ports.length > 0 && (
            <>
              {container.ports.map(port => (
                <span key={port} className="detail-item port-item">{port}</span>
              ))}
            </>
          )}
          {showProject && container.project && (
            <button
              className="detail-item project-link"
              onClick={() => onProjectClick?.(container.project!)}
              title="Filtrer par ce projet"
            >
              <FolderIcon size={12} />
              {container.project}
            </button>
          )}
          <span className="detail-item image-item">
            <ImageIcon size={12} />
            {imageName}:{imageTag}
          </span>
          {showCreated && (
            <span className="detail-item date-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {new Date(container.created).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          {showUpdateInfo && container.hasUpdate && (
            <span className="detail-item update-badge">
              <UpdateIcon size={12} />
              Mise à jour
            </span>
          )}
          {showUpdateInfo && !container.hasUpdate && container.update_available && (
            <span className="detail-item update-dot-inline">
              <span className="update-dot" />
            </span>
          )}
        </div>
      </div>
      <div className="resource-actions">
        {isRunning ? (
          <>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => handleAction('restart')}
              disabled={isActionDisabled}
              title="Redémarrer"
            >
              <RestartIcon size={12} />
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => handleAction('stop')}
              disabled={isActionDisabled}
              title="Arrêter"
            >
              <StopIcon size={12} />
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm btn-success"
            onClick={() => handleAction('start')}
            disabled={isActionDisabled}
            title="Démarrer"
          >
            <PlayIcon size={12} />
          </button>
        )}
        {showMenu && onAction && (
          <ContainerMenu
            container={container}
            onAction={onAction}
            actionInProgress={actionInProgress ?? null}
          />
        )}
      </div>
    </div>
  );
}