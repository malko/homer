import { useState } from 'react';
import { Container } from '../api';
import {
  FileTextIcon, TerminalIcon, UpdateIcon, TrashIcon,
  MoreVerticalIcon, PlayIcon, RestartIcon
} from './Icons';

interface ContainerMenuProps {
  container: Container;
  onAction: (action: 'start' | 'stop' | 'restart' | 'remove' | 'checkUpdate', containerId: string) => void;
  actionInProgress: string | null;
}

export function ContainerMenu({ container, onAction, actionInProgress }: ContainerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isRunning = container.state === 'running';
  const isActionRunning = actionInProgress !== null;
  const isActionDisabled = !!actionInProgress;

  const openInNewWindow = (url: string) => {
    window.open(url, '_blank', 'width=900,height=700,resizable=yes,scrollbars=yes');
  };

  const openLogs = () => {
    openInNewWindow(`/logs?containerId=${container.id}&containerName=${encodeURIComponent(container.name)}`);
  };

  const openTerminal = () => {
    openInNewWindow(`/terminal?containerId=${container.id}&containerName=${encodeURIComponent(container.name)}`);
  };

  return (
    <div className="container-menu-wrapper">
      <button
        className="btn btn-sm btn-icon"
        onClick={() => setIsOpen(!isOpen)}
        title="Plus d'options"
      >
        <MoreVerticalIcon size={16} />
      </button>
      {isOpen && (
        <>
          <div className="container-menu-backdrop" onClick={() => setIsOpen(false)} />
          <div className="container-menu">
            <button className="container-menu-item small-display-only" onClick={() => onAction('restart', container.id)} disabled={isActionDisabled || !isRunning}>
              <RestartIcon size={14} />
              Redémarrer
            </button>
            <button className="container-menu-item small-display-only" onClick={openLogs}>
              <FileTextIcon size={14} />
              Voir les logs
            </button>
            <button className="container-menu-item small-display-only" onClick={openTerminal} disabled={!isRunning} title={!isRunning ? 'Container arrêté' : ''}>
              <TerminalIcon size={14} />
              Ouvrir le terminal
              {!isRunning && <span className="menu-hint"> (arrêté)</span>}
            </button>
            <div className="container-menu-divider small-display-only" />
            <button className="container-menu-item small-display-only" onClick={openLogs}>
              <FileTextIcon size={14} />
              Voir les logs
            </button>
            <button className="container-menu-item small-display-only" onClick={openTerminal} disabled={!isRunning} title={!isRunning ? 'Container arrêté' : ''}>
              <TerminalIcon size={14} />
              Ouvrir le terminal
              {!isRunning && <span className="menu-hint"> (arrêté)</span>}
            </button>
            <div className="container-menu-divider small-display-only" />
            <button
              className="container-menu-item"
              onClick={() => onAction('checkUpdate', container.id)}
              disabled={isActionRunning}
              title="Vérifier si une mise à jour est disponible"
            >
              <UpdateIcon size={14} />
              Vérifier les mises à jour
            </button>
            <button
              className="container-menu-item"
              onClick={() => onAction('remove', container.id)}
              disabled={isRunning || isActionRunning}
              title={isRunning ? 'Arrêter d\'abord le container' : ''}
            >
              <TrashIcon size={14} />
              Supprimer le container
              {isRunning && <span className="menu-hint"> (en cours)</span>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}