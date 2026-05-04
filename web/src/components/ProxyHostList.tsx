import { useNavigate } from 'react-router-dom';
import type { ProxyHost, ReachabilityResult } from '../api';
import { PencilIcon, TrashIcon, ExternalLinkIcon } from './Icons';
import { ProjectBadge } from './Badges';

interface ProxyHostListProps {
  hosts: ProxyHost[];
  loading?: boolean;
  onEdit: (host: ProxyHost) => void;
  onDelete: (host: ProxyHost) => void;
  onToggle: (host: ProxyHost) => void;
  showProject?: boolean;
  reachability?: Map<string, ReachabilityResult>;
}

function getStatusInfo(host: ProxyHost, reachability?: Map<string, ReachabilityResult>): { className: string; label: string } {
  if (!host.enabled) {
    return { className: 'status-inactive', label: 'Désactivé' };
  }
  const result = reachability?.get(host.upstream);
  if (result === undefined) {
    return { className: 'status-unknown', label: 'Vérification…' };
  }
  if (!result.reachable) {
    return { className: 'status-unreachable', label: result.error === 'Timeout' ? 'Injoignable (timeout)' : 'Injoignable' };
  }
  return { className: 'status-active', label: 'Actif' };
}

export function ProxyHostList({ hosts, loading, onEdit, onDelete, onToggle, showProject = false, reachability }: ProxyHostListProps) {
  if (loading) {
    return <div className="proxy-list-loading"><div className="spinner" /></div>;
  }

  if (hosts.length === 0) {
    return (
      <div className="proxy-list-empty">
        Aucun proxy configuré
      </div>
    );
  }

  return (
    <div className="proxy-host-list">
      {hosts.map(host => {
        const status = getStatusInfo(host, reachability);
        const protocol = host.tls_mode ? 'https' : 'http';
        const proxyUrl = `${protocol}://${host.domain}`;

        return (
          <div key={host.id} className={`proxy-host-item ${!host.enabled ? 'proxy-host-disabled' : ''}`}>
            <div className="proxy-host-info">
              <div className="proxy-host-domain">
                <span className={`proxy-host-status-dot ${status.className}`} title={status.label} />
                <a
                  href={proxyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proxy-host-domain-text"
                >
                  {host.domain}
                </a>
                <a
                  href={proxyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proxy-host-external-link"
                  title="Ouvrir dans un nouvel onglet"
                >
                  <ExternalLinkIcon size={14} />
                </a>
                {host.tls_mode ? <span className="proxy-badge proxy-badge-tls">TLS</span> : ''}
                {host.basic_auth_user ? <span className="proxy-badge proxy-badge-auth">Auth</span> : ''}
                {host.local_only ? <span className="proxy-badge proxy-badge-local">Local</span> : ''}
              </div>
              <div className="proxy-host-upstream">
                <span className="proxy-upstream-arrow">&rarr;</span>
                <span>{host.upstream}</span>
              </div>
              {showProject && host.project_id && host.project_name && (
                <ProxyProjectBadge projectId={host.project_id} projectName={host.project_name} />
              )}
            </div>
            <div className="proxy-host-actions">
              <button
                type="button"
                className={`toggle ${host.enabled ? 'toggle-active' : ''}`}
                onClick={() => onToggle(host)}
                title={host.enabled ? 'Actif — cliquer pour désactiver' : 'Inactif — cliquer pour activer'}
              >
                <span className="toggle-handle" />
              </button>
              <button
                className="btn btn-sm btn-secondary btn-icon"
                onClick={() => onEdit(host)}
                title="Modifier"
              >
                <PencilIcon size={14} />
              </button>
              <button
                className="btn btn-sm btn-danger btn-icon"
                onClick={() => onDelete(host)}
                title="Supprimer"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProxyProjectBadge({ projectId, projectName }: { projectId: number; projectName: string }) {
  const navigate = useNavigate();
  return (
    <ProjectBadge
      project={projectName}
      onClick={() => navigate(`/projects?project=${projectId}&tab=proxy`)}
      style={{ maxWidth: '200px', width: 'min-content' }}
    />
  );
}