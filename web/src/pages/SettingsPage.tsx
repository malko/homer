import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import type { ProxyHost, ProxyHostInput, SystemSettings } from '../api';
import { useProxyHosts } from '../hooks/useProxyHosts';
import { AppHeader } from '../components/AppHeader';
import { ProxyHostForm } from '../components/ProxyHostForm';
import { ProxyHostList } from '../components/ProxyHostList';
import { JsonEditor } from '../components/JsonEditor';
import '../styles/settings.css';
import '../styles/proxy.css';

type SettingsTab = 'general' | 'proxy' | 'caddy';

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="code-block">
      <pre>{children}</pre>
      <button className="code-block-copy" onClick={handleCopy} title="Copier">
        {copied ? '✓' : '⎘'}
      </button>
    </div>
  );
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="settings-page">
      <AppHeader />

      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'settings-tab-active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          Général
        </button>
        <button
          className={`settings-tab ${activeTab === 'proxy' ? 'settings-tab-active' : ''}`}
          onClick={() => setActiveTab('proxy')}
        >
          Proxy Hosts
        </button>
        <button
          className={`settings-tab ${activeTab === 'caddy' ? 'settings-tab-active' : ''}`}
          onClick={() => setActiveTab('caddy')}
        >
          Caddy
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'proxy' && <ProxyHostsSettings />}
        {activeTab === 'caddy' && <CaddySettings />}
      </div>
    </div>
  );
}

// ─── General Settings ────────────────────────────────────────────────────────

function GeneralSettings() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api.system.getSettings().then(data => {
      setSettings(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveSettings = async (updates: Partial<SystemSettings>) => {
    setSaving(true);
    setMessage(null);
    try {
      await api.system.saveSettings(updates);
      setSettings(prev => prev ? { ...prev, ...updates } : null);
      setMessage('Paramètres enregistrés');
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Les mots de passe ne correspondent pas');
      return;
    }

    setChangingPassword(true);
    try {
      await api.auth.changePassword(newPassword, currentPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) return <div className="settings-section"><div className="spinner" /></div>;
  if (!settings) return null;

  return (
    <div className="settings-section">
      <h2>Paramètres généraux</h2>

      <div className="settings-card">
        <h3>Domaine par défaut</h3>
        <div className="settings-field">
          <label htmlFor="domain-suffix">Suffixe de domaine</label>
          <input
            id="domain-suffix"
            type="text"
            className="input"
            value={settings.domainSuffix}
            onChange={e => setSettings({ ...settings, domainSuffix: e.target.value })}
            onBlur={() => saveSettings({ domainSuffix: settings.domainSuffix })}
            placeholder=".homelab.local"
          />
          <span className="form-help">Les nouveaux proxies utiliseront ce suffixe par défaut (ex: monapp.homelab.local)</span>
        </div>

        <div className="settings-field">
          <label htmlFor="extra-hostname">Hostname externe (optionnel)</label>
          <input
            id="extra-hostname"
            type="text"
            className="input"
            value={settings.extraHostname}
            onChange={e => setSettings({ ...settings, extraHostname: e.target.value })}
            onBlur={() => saveSettings({ extraHostname: settings.extraHostname })}
            placeholder="homer.example.com"
          />
          <span className="form-help">Hostname public avec certificat Let's Encrypt</span>
        </div>
      </div>

      <div className="settings-card">
        <h3>Mises à jour</h3>
        <div className="toggle-row">
          <label className="toggle-label">
            <span>Mises à jour automatiques</span>
            <span className="form-help">Vérifier et appliquer les mises à jour automatiquement</span>
          </label>
          <button
            type="button"
            className={`toggle ${settings.autoUpdate ? 'toggle-active' : ''}`}
            onClick={() => saveSettings({ autoUpdate: !settings.autoUpdate })}
            disabled={saving}
          >
            <span className="toggle-handle" />
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3>Mot de passe administrateur</h3>
        <form className="password-form" onSubmit={handlePasswordChange}>
          <input
            type="password"
            className="input"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="Mot de passe actuel"
          />
          <input
            type="password"
            className="input"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Nouveau mot de passe (min. 8 caractères)"
          />
          <input
            type="password"
            className="input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirmer le nouveau mot de passe"
          />
          {passwordError && <div className="proxy-form-error">{passwordError}</div>}
          {passwordSuccess && <div style={{ color: 'var(--color-success)', fontSize: '0.8125rem' }}>Mot de passe modifié avec succès</div>}
          <div className="password-form-actions">
            <button type="submit" className="btn btn-primary" disabled={changingPassword}>
              {changingPassword ? 'Modification...' : 'Changer le mot de passe'}
            </button>
          </div>
        </form>
      </div>

      {message && (
        <div style={{ color: 'var(--color-success)', fontSize: '0.8125rem', textAlign: 'center', marginTop: '0.5rem' }}>
          {message}
        </div>
      )}
    </div>
  );
}

// ─── Proxy Hosts Settings ────────────────────────────────────────────────────

function ProxyHostsSettings() {
  const { hosts, loading, createHost, updateHost, deleteHost, toggleHost, refetch } = useProxyHosts();
  const [editingHost, setEditingHost] = useState<ProxyHost | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [domainSuffix, setDomainSuffix] = useState('');
  const [certError, setCertError] = useState<string | null>(null);
  const [certDownloading, setCertDownloading] = useState(false);

  const downloadCACert = async () => {
    setCertError(null);
    setCertDownloading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/proxy/root-ca', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCertError(body.error || 'Certificat non disponible');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'homer-root-ca.crt';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setCertError('Erreur réseau lors du téléchargement');
    } finally {
      setCertDownloading(false);
    }
  };

  useEffect(() => {
    api.system.getSettings().then(s => setDomainSuffix(s.domainSuffix || ''));
  }, []);

  const handleSave = async (data: ProxyHostInput) => {
    if (editingHost) {
      await updateHost(editingHost.id, data);
    } else {
      await createHost(data);
    }
    setShowForm(false);
    setEditingHost(null);
  };

  const handleEdit = (host: ProxyHost) => {
    setEditingHost(host);
    setShowForm(true);
  };

  const handleDelete = async (host: ProxyHost) => {
    if (confirm(`Supprimer le proxy pour ${host.domain} ?`)) {
      await deleteHost(host.id);
    }
  };

  const handleToggle = async (host: ProxyHost) => {
    await toggleHost(host.id);
  };

  return (
    <div className="settings-section">
      <div className="proxy-tab-header">
        <h2>Proxy Hosts</h2>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => { setEditingHost(null); setShowForm(true); }}>
            + Ajouter un proxy
          </button>
        )}
      </div>

      <div className="settings-card ca-cert-card">
        <h3>Autorité de certification locale</h3>
        <p className="form-help">
          Caddy génère un certificat CA local pour les proxies en mode TLS interne.
          Importez-le dans le magasin de confiance de votre système pour éviter les avertissements de sécurité.
        </p>
        <button
          className="btn btn-secondary ca-cert-download-btn"
          onClick={downloadCACert}
          disabled={certDownloading}
        >
          {certDownloading ? 'Téléchargement...' : 'Télécharger le certificat CA'}
        </button>
        {certError && <p className="ca-cert-error">{certError}</p>}
        <details className="ca-instructions">
          <summary>Instructions d'installation</summary>
          <div className="ca-instructions-content">
            <p className="ca-instructions-section-title">Magasin système</p>
            <div className="ca-instructions-os">
              <strong>Linux (Debian / Ubuntu)</strong>
              <CodeBlock>{`sudo cp homer-root-ca.crt /usr/local/share/ca-certificates/homer-root-ca.crt\nsudo update-ca-certificates`}</CodeBlock>
            </div>
            <div className="ca-instructions-os">
              <strong>Linux (Fedora / RHEL / Arch)</strong>
              <CodeBlock>{`sudo cp homer-root-ca.crt /etc/pki/ca-trust/source/anchors/homer-root-ca.crt\nsudo update-ca-trust`}</CodeBlock>
            </div>
            <div className="ca-instructions-os">
              <strong>macOS</strong>
              <CodeBlock>{`sudo security add-trusted-cert -d -r trustRoot \\\n  -k /Library/Keychains/System.keychain homer-root-ca.crt`}</CodeBlock>
            </div>
            <div className="ca-instructions-os">
              <strong>Windows</strong>
              <CodeBlock>{`certutil -addstore -f "ROOT" homer-root-ca.crt`}</CodeBlock>
            </div>

            <p className="ca-instructions-section-title">Navigateurs</p>
            <div className="ca-instructions-os">
              <strong>Chrome / Edge / Brave (Windows & macOS)</strong>
              <p className="form-help">Ces navigateurs utilisent le magasin système — l'installation système ci-dessus suffit.</p>
            </div>
            <div className="ca-instructions-os">
              <strong>Chrome / Chromium (Linux)</strong>
              <CodeBlock>{`certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Caddy CA" -i homer-root-ca.crt`}</CodeBlock>
            </div>
            <div className="ca-instructions-os">
              <strong>Firefox (tous OS)</strong>
              <p className="form-help">Firefox maintient son propre magasin. Ouvrez <code>about:preferences#privacy</code>, section <em>Certificats</em> → <em>Afficher les certificats</em> → onglet <em>Autorités</em> → <em>Importer</em>. Cochez "Faire confiance pour identifier des sites web".</p>
            </div>
            <div className="ca-instructions-os">
              <strong>Safari (macOS)</strong>
              <p className="form-help">Safari utilise le magasin système. Double-cliquez sur le fichier pour l'ouvrir dans Trousseaux d'accès, puis dans l'app Trousseaux faites un double-clic sur le certificat → <em>Faire confiance</em> → "Toujours approuver".</p>
            </div>

            <p className="ca-instructions-note form-help">
              Après installation, redémarrez votre navigateur pour que les changements prennent effet.
            </p>
          </div>
        </details>
      </div>

      {showForm && (
        <div className="settings-card">
          <ProxyHostForm
            proxyHost={editingHost || undefined}
            domainSuffix={domainSuffix}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingHost(null); }}
          />
        </div>
      )}

      <ProxyHostList
        hosts={hosts}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggle={handleToggle}
        showProject
      />
    </div>
  );
}

// ─── Caddy Settings ──────────────────────────────────────────────────────────

function CaddySettings() {
  const [caddyStatus, setCaddyStatus] = useState<{ running: boolean; error?: string } | null>(null);
  const [viewMode, setViewMode] = useState<'generated' | 'running'>('generated');
  const [generatedConfig, setGeneratedConfig] = useState<string>('');
  const [runningConfig, setRunningConfig] = useState<string>('');
  const [editableConfig, setEditableConfig] = useState<string>('');
  const [isValid, setIsValid] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [status, configData] = await Promise.all([
        api.proxy.getStatus(),
        api.proxy.getConfig(),
      ]);
      setCaddyStatus(status);
      const gen = JSON.stringify(configData.generated, null, 2);
      const run = configData.running ? JSON.stringify(configData.running, null, 2) : '// Caddy non accessible';
      setGeneratedConfig(gen);
      setRunningConfig(run);
      setEditableConfig(viewMode === 'generated' ? gen : run);
    } catch {
      setCaddyStatus({ running: false, error: 'Cannot fetch status' });
    }
  }, [viewMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setEditableConfig(viewMode === 'generated' ? generatedConfig : runningConfig);
  }, [viewMode, generatedConfig, runningConfig]);

  const handlePush = async () => {
    if (!isValid) return;
    setPushing(true);
    setPushMessage(null);
    try {
      const config = JSON.parse(editableConfig);
      const result = await api.proxy.pushConfig(config, false);
      setPushMessage(result.success ? 'Configuration appliquée' : `Erreur: ${result.error}`);
      if (result.success) fetchData();
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setPushing(false);
      setTimeout(() => setPushMessage(null), 3000);
    }
  };

  const handleReload = async () => {
    setPushing(true);
    setPushMessage(null);
    try {
      const result = await api.proxy.reload();
      setPushMessage(result.success ? 'Configuration regénérée et appliquée' : `Erreur: ${result.error}`);
      fetchData();
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setPushing(false);
      setTimeout(() => setPushMessage(null), 3000);
    }
  };

  return (
    <div className="settings-section">
      <div className="caddy-tab-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0 }}>Configuration Caddy</h2>
          <div className="caddy-status">
            <span className={`caddy-status-dot ${caddyStatus?.running ? 'caddy-running' : 'caddy-stopped'}`} />
            <span>{caddyStatus?.running ? 'En ligne' : 'Hors ligne'}</span>
          </div>
        </div>
        <div className="caddy-view-toggle">
          <button
            className={viewMode === 'generated' ? 'active' : ''}
            onClick={() => setViewMode('generated')}
          >
            Générée
          </button>
          <button
            className={viewMode === 'running' ? 'active' : ''}
            onClick={() => setViewMode('running')}
          >
            Active
          </button>
        </div>
      </div>

      <div className="settings-card" style={{ padding: 0, overflow: 'hidden' }}>
        <JsonEditor
          value={editableConfig}
          onChange={setEditableConfig}
          onValidate={(valid) => setIsValid(valid)}
          minHeight="400px"
        />
      </div>

      <div className="caddy-config-actions">
        <button className="btn btn-primary" onClick={handlePush} disabled={pushing || !isValid}>
          {pushing ? 'Application...' : 'Appliquer cette config'}
        </button>
        <button className="btn btn-secondary" onClick={handleReload} disabled={pushing}>
          Regénérer depuis la DB
        </button>
        {pushMessage && (
          <span style={{ fontSize: '0.8125rem', color: pushMessage.includes('Erreur') ? 'var(--color-danger)' : 'var(--color-success)', alignSelf: 'center' }}>
            {pushMessage}
          </span>
        )}
      </div>
    </div>
  );
}
