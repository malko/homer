import type { ProxyHost } from '../api';

interface ProxyHostListProps {
  hosts: ProxyHost[];
  loading?: boolean;
  onEdit: (host: ProxyHost) => void;
  onDelete: (host: ProxyHost) => void;
  onToggle: (host: ProxyHost) => void;
  showProject?: boolean;
}

export function ProxyHostList({ hosts, loading, onEdit, onDelete, onToggle, showProject = false }: ProxyHostListProps) {
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
      {hosts.map(host => (
        <div key={host.id} className={`proxy-host-item ${!host.enabled ? 'proxy-host-disabled' : ''}`}>
          <div className="proxy-host-info">
            <div className="proxy-host-domain">
              <span className={`proxy-host-status-dot ${host.enabled ? 'status-active' : 'status-inactive'}`} />
              <span className="proxy-host-domain-text">{host.domain}</span>
              {host.tls_mode === 'acme' && <span className="proxy-badge proxy-badge-tls">LE</span>}
              {host.basic_auth_user && <span className="proxy-badge proxy-badge-auth">Auth</span>}
              {host.local_only && <span className="proxy-badge proxy-badge-local">Local</span>}
            </div>
            <div className="proxy-host-upstream">
              <span className="proxy-upstream-arrow">&rarr;</span>
              <span>{host.upstream}</span>
            </div>
            {showProject && host.project_id && (
              <div className="proxy-host-project">
                Projet #{host.project_id}
              </div>
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
              className="btn btn-sm btn-secondary"
              onClick={() => onEdit(host)}
              title="Modifier"
            >
              Modifier
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => onDelete(host)}
              title="Supprimer"
            >
              Supprimer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
