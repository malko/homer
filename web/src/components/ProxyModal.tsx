import type { ProxyHost, ProxyHostInput, Container } from '../api';
import { ProxyHostForm } from './ProxyHostForm';

interface ProxyModalProps {
  proxyHost?: ProxyHost;
  projectId?: number;
  domainSuffix?: string;
  containers?: Container[];
  show: boolean;
  onSave: (data: ProxyHostInput) => Promise<void>;
  onCancel: () => void;
}

export function ProxyModal({ proxyHost, projectId, domainSuffix, containers, show, onSave, onCancel }: ProxyModalProps) {
  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal proxy-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{proxyHost ? 'Modifier le proxy' : 'Nouveau proxy'}</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <ProxyHostForm
            proxyHost={proxyHost}
            projectId={projectId}
            domainSuffix={domainSuffix}
            containers={containers}
            onSave={async (data) => { await onSave(data); }}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  );
}
