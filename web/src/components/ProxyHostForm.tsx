import { useState, useMemo, useRef, useEffect } from 'react';
import type { Container, ProxyHost, ProxyHostInput } from '../api';
import { InfoTooltip } from './InfoTooltip';

type UpstreamType = 'container' | 'url';

function UpstreamCombobox({ value, onChange, suggestions, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  suggestions: Array<{ label: string; value: string }>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (suggestions.length === 0) {
    return (
      <input
        id="proxy-upstream"
        type="text"
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
      />
    );
  }

  return (
    <div className="upstream-combobox" ref={wrapperRef}>
      <input
        id="proxy-upstream"
        type="text"
        className="input"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        required
        autoComplete="off"
      />
      <button
        type="button"
        className="upstream-combobox-toggle"
        onClick={() => setOpen(!open)}
        tabIndex={-1}
      >
        ▾
      </button>
      {open && (
        <div className="upstream-combobox-dropdown">
          {suggestions
            .filter(s => !value || s.value.toLowerCase().includes(value.toLowerCase()))
            .map(s => (
            <div
              key={s.value}
              className={`upstream-combobox-option ${s.value === value ? 'selected' : ''}`}
              onMouseDown={() => { onChange(s.value); setOpen(false); }}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ProxyHostFormProps {
  proxyHost?: ProxyHost;
  projectId?: number;
  domainSuffix?: string;
  containers?: Container[];
  onSave: (data: ProxyHostInput) => Promise<void>;
  onCancel: () => void;
}

export function ProxyHostForm({ proxyHost, projectId, domainSuffix = '', containers = [], onSave, onCancel }: ProxyHostFormProps) {
  const isEdit = !!proxyHost;

  // Build upstream suggestions from containers
  const upstreamSuggestions = useMemo(() => {
    const suggestions: Array<{ label: string; value: string }> = [];
    for (const c of containers) {
      const name = c.service || c.name;
      if (c.ports && c.ports.length > 0) {
        for (const port of c.ports) {
          suggestions.push({ label: `${name}:${port}`, value: `${name}:${port}` });
        }
      } else {
        suggestions.push({ label: `${name}`, value: name });
      }
    }
    return suggestions;
  }, [containers]);

  // Default domain: first service name + domainSuffix (only for new proxies)
  const defaultDomain = useMemo(() => {
    if (isEdit) return proxyHost.domain;
    if (!domainSuffix || containers.length === 0) return '';
    const firstName = containers[0]?.service || containers[0]?.name || '';
    return firstName ? `${firstName}${domainSuffix}` : '';
  }, [isEdit, proxyHost, domainSuffix, containers]);

  const [domain, setDomain] = useState(proxyHost?.domain || defaultDomain);
  const [upstreamType, setUpstreamType] = useState<UpstreamType>(
    proxyHost?.upstream?.startsWith('http://') || proxyHost?.upstream?.startsWith('https://') ? 'url' : 'container'
  );
  const [upstream, setUpstream] = useState(proxyHost?.upstream || '');
  const [tlsMode, setTlsMode] = useState<'internal' | 'acme'>(proxyHost?.tls_mode || 'internal');
  const [basicAuthEnabled, setBasicAuthEnabled] = useState(!!proxyHost?.basic_auth_user);
  const [basicAuthUser, setBasicAuthUser] = useState(proxyHost?.basic_auth_user || '');
  const [basicAuthPassword, setBasicAuthPassword] = useState('');
  const [localOnly, setLocalOnly] = useState(proxyHost?.local_only || false);
  const [enabled, setEnabled] = useState(proxyHost?.enabled !== false);
  const [showOnOverview, setShowOnOverview] = useState(proxyHost?.show_on_overview !== false);
  const [showOnHome, setShowOnHome] = useState(proxyHost?.show_on_home || false);
  const [mdnsEnabled, setMdnsEnabled] = useState(proxyHost?.mdns_enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocalDomain = domain.endsWith('.local');

  useEffect(() => {
    if (isLocalDomain) {
      setMdnsEnabled(true);
      setTlsMode('internal');
      setLocalOnly(true);
    } else {
      setMdnsEnabled(false);
    }
  }, [isLocalDomain]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || !upstream.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const data: ProxyHostInput = {
        domain: domain.trim(),
        upstream: upstream.trim(),
        project_id: projectId ?? proxyHost?.project_id ?? null,
        tls_mode: tlsMode,
        local_only: localOnly,
        enabled,
        show_on_overview: showOnOverview,
        show_on_home: showOnHome,
        mdns_enabled: mdnsEnabled,
      };

      if (basicAuthEnabled && basicAuthUser.trim()) {
        data.basic_auth_user = basicAuthUser.trim();
        if (basicAuthPassword) {
          data.basic_auth_password = basicAuthPassword;
        }
      } else {
        data.basic_auth_user = null;
        data.basic_auth_password = null;
      }

      await onSave(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save proxy host');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="proxy-host-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="proxy-domain" className="label-with-tooltip">
          Domaine
          <InfoTooltip title="À propos des domaines">
            <p>Un domaine en <code>.local</code> active automatiquement :</p>
            <ul>
              <li>la résolution mDNS (découverte automatique sur le réseau local)</li>
              <li>le certificat TLS interne Caddy</li>
              <li>l'accès restreint au réseau local</li>
            </ul>
            <p className="margin-top-sm">Note : les sous-domaines ne fonctionnent pas avec la résolution mDNS.</p>
            <p>Pour les autres domaines, les sous-domaines sont autorisés. Configurez votre DNS (AdGuard pour le LAN ou un registrar pour l'extérieur).</p>
          </InfoTooltip>
        </label>
        <div className="input-with-hint">
          <input
            id="proxy-domain"
            type="text"
            className="input"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            placeholder={`app${domainSuffix || '.homelab.local'}`}
            required
          />
          {domainSuffix && !domain.includes('.') && domain.trim() && (
            <span className="input-hint">{domain.trim()}{domainSuffix}</span>
          )}
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="proxy-upstream-type" className="label-with-tooltip">
          Type d'upstream
          <InfoTooltip title="À propos des types d'upstream">
            <p><strong>Container (homer-services)</strong> : Utilise le nom du service Docker sur le réseau <code>homer-services</code>. Pratique pour les services du même host.</p>
            <p><strong>URL (service externe)</strong> : Permet de cibler n'importe quel service via son URL complète (<code>http://</code> ou <code>https://</code>). Utile pour les services sur d'autres machines ou avec HTTPS.</p>
          </InfoTooltip>
        </label>
        <div className="radio-group">
          <label className="radio-label">
            <input
              type="radio"
              name="upstream-type"
              value="container"
              checked={upstreamType === 'container'}
              onChange={() => setUpstreamType('container')}
            />
            Container (homer-services)
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="upstream-type"
              value="url"
              checked={upstreamType === 'url'}
              onChange={() => setUpstreamType('url')}
            />
            URL (service externe)
          </label>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="proxy-upstream">Upstream</label>
        {upstreamType === 'container' ? (
          <UpstreamCombobox
            value={upstream}
            onChange={setUpstream}
            suggestions={upstreamSuggestions}
            placeholder="container-name:8080"
          />
        ) : (
          <input
            id="proxy-upstream"
            type="text"
            className="input"
            value={upstream}
            onChange={e => setUpstream(e.target.value)}
            placeholder="http://192.168.1.100:8080"
            required
          />
        )}
        <span className="form-help">
          {upstreamType === 'container'
            ? 'Nom du service:port ou host.docker.internal:port'
            : 'URL complète avec protocole (http:// ou https://)'}
        </span>
      </div>

      <div className="form-group">
        <label htmlFor="proxy-tls" title={isLocalDomain ? "TLS interne forcé pour les domaines .local" : undefined}>
          TLS
        </label>
        <select
          id="proxy-tls"
          className={`input ${isLocalDomain ? 'input-disabled' : ''}`}
          value={tlsMode}
          onChange={e => setTlsMode(e.target.value as 'internal' | 'acme')}
          disabled={isLocalDomain}
          title={isLocalDomain ? "TLS interne forcé pour les domaines .local" : undefined}
        >
          <option value="internal">CA locale (certificat interne Caddy)</option>
          <option value="acme">Let's Encrypt (ACME)</option>
        </select>
      </div>

      <div className="form-group">
        <div className="toggle-row">
          <label className="toggle-label">
            <span>Basic Auth</span>
          </label>
          <button
            type="button"
            className={`toggle ${basicAuthEnabled ? 'toggle-active' : ''}`}
            onClick={() => setBasicAuthEnabled(!basicAuthEnabled)}
          >
            <span className="toggle-handle" />
          </button>
        </div>
        {basicAuthEnabled && (
          <div className="proxy-auth-fields">
            <input
              type="text"
              className="input"
              value={basicAuthUser}
              onChange={e => setBasicAuthUser(e.target.value)}
              placeholder="Utilisateur"
            />
            <input
              type="password"
              className="input"
              value={basicAuthPassword}
              onChange={e => setBasicAuthPassword(e.target.value)}
              placeholder={isEdit ? 'Nouveau mot de passe (laisser vide pour garder)' : 'Mot de passe'}
            />
          </div>
        )}
      </div>

      <div className="form-group">
        <div className="toggle-row">
          <label className="toggle-label">
            <span>Actif</span>
          </label>
          <button
            type="button"
            className={`toggle ${enabled ? 'toggle-active' : ''}`}
            onClick={() => setEnabled(!enabled)}
          >
            <span className="toggle-handle" />
          </button>
        </div>
      </div>

      <div className="form-group">
        <div className="toggle-row">
          <label className="toggle-label" title={isLocalDomain ? "Accès local forcé pour les domaines .local" : undefined}>
            <span>Accès local uniquement</span>
            <span className="form-help">
              Restreint aux réseaux privés (192.168.x.x, 10.x.x.x, 172.16.x.x)
            </span>
          </label>
          <button
            type="button"
            className={`toggle ${localOnly ? 'toggle-active' : ''} ${isLocalDomain ? 'toggle-disabled' : ''}`}
            onClick={() => !isLocalDomain && setLocalOnly(!localOnly)}
            disabled={isLocalDomain}
            title={isLocalDomain ? "Accès local forcé pour les domaines .local" : undefined}
          >
            <span className="toggle-handle" />
          </button>
        </div>
      </div>

      {isLocalDomain && (
        <div className="form-note">
          mDNS activé automatiquement pour les domaines .local
        </div>
      )}

      {projectId && (
        <div className="form-group">
          <div className="toggle-row">
            <label className="toggle-label">
              <span>Afficher dans l'overview</span>
              <span className="form-help">Lien visible dans l'onglet Overview du projet</span>
            </label>
            <button
              type="button"
              className={`toggle ${showOnOverview ? 'toggle-active' : ''}`}
              onClick={() => setShowOnOverview(!showOnOverview)}
            >
              <span className="toggle-handle" />
            </button>
          </div>
        </div>
      )}

      <div className="form-group">
        <div className="toggle-row">
          <label className="toggle-label">
            <span>Afficher sur l'accueil</span>
            <span className="form-help">Tuile visible sur la page d'accueil</span>
          </label>
          <button
            type="button"
            className={`toggle ${showOnHome ? 'toggle-active' : ''}`}
            onClick={() => setShowOnHome(!showOnHome)}
          >
            <span className="toggle-handle" />
          </button>
        </div>
      </div>

      {error && <div className="proxy-form-error">{error}</div>}

      <div className="proxy-form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !domain.trim() || !upstream.trim()}>
          {saving ? 'Enregistrement...' : isEdit ? 'Modifier' : 'Créer'}
        </button>
      </div>
    </form>
  );
}
