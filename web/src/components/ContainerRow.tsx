import { useState } from 'react';
import { api, getActivePeer, Container } from '../api';
import { ContainerMenu } from './ContainerMenu';
import {
  FolderIcon, ImageIcon, UpdateIcon,
  PlayIcon, StopIcon, RestartIcon,
  FileTextIcon, TerminalIcon, CalendarIcon
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
              <CalendarIcon size={12} />
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
          <button
            className="btn btn-sm btn-secondary large-display-only"
            onClick={() => {
              const peer = getActivePeer();
              const peerParam = peer ? `&peer_uuid=${encodeURIComponent(peer)}` : '';
              window.open(`/logs?containerId=${container.id}&containerName=${encodeURIComponent(container.name)}${peerParam}`, '_blank', 'width=900,height=700,resizable=yes,scrollbars=yes');
            }}
            title="Voir les logs"
          >
            <FileTextIcon size={12} />
          </button>
          <button
            className="btn btn-sm btn-secondary large-display-only"
            onClick={() => {
              const peer = getActivePeer();
              const peerParam = peer ? `&peer_uuid=${encodeURIComponent(peer)}` : '';
              window.open(`/terminal?containerId=${container.id}&containerName=${encodeURIComponent(container.name)}${peerParam}`, '_blank', 'width=900,height=700,resizable=yes,scrollbars=yes');
            }}
            disabled={!isRunning}
            title={isRunning ? 'Ouvrir le terminal' : 'Container arrêté'}
          >
            <TerminalIcon size={12} />
          </button>
          {isRunning ? (
            <>
              <button
                className="btn btn-sm btn-secondary large-display-only"
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