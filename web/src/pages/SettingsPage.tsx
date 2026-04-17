import { useState, useEffect } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, Container, SystemSettings } from '../api';
import { ContainerRow } from '../components/ContainerRow';
import '../styles/settings.css';

type SettingsTab = 'general' | 'containers';

interface SettingsPageProps {
  initialTab?: SettingsTab;
}

export function SettingsPage({ initialTab }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'general');

  return (
    <div className="settings-page">
      <AppHeader title="Paramètres" />
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'settings-tab-active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          Général
        </button>
        <button
          className={`settings-tab ${activeTab === 'containers' ? 'settings-tab-active' : ''}`}
          onClick={() => setActiveTab('containers')}
        >
          Containers
        </button>
      </div>

      <div className={`settings-content${activeTab === 'containers' ? ' settings-content--fill' : ''}`}>
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'containers' && <ContainersSettings />}
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

        <div className="settings-field">
          <label htmlFor="cert-lifetime">Durée de vie des certificats internes</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              id="cert-lifetime"
              type="number"
              className="input"
              style={{ maxWidth: '100px' }}
              min={60}
              max={43200}
              value={settings.certLifetime}
              onChange={e => setSettings({ ...settings, certLifetime: parseInt(e.target.value) || 10080 })}
              onBlur={() => saveSettings({ certLifetime: settings.certLifetime })}
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>minutes</span>
          </div>
          <span className="form-help">Durée de validité des certificats TLS générés par Caddy pour le réseau local (défaut: 7 jours). Recharge Caddy requise.</span>
        </div>
      </div>

      <div className="settings-card">
        <h3>Mises à jour des containers</h3>
        <div className="settings-field">
          <label htmlFor="update-interval">Intervalle de vérification</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              id="update-interval"
              type="number"
              className="input"
              style={{ maxWidth: '100px' }}
              min={30}
              max={10080}
              value={settings.updateCheckInterval}
              onChange={e => setSettings({ ...settings, updateCheckInterval: parseInt(e.target.value) || 360 })}
              onBlur={() => saveSettings({ updateCheckInterval: settings.updateCheckInterval })}
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>minutes</span>
          </div>
          <span className="form-help">Fréquence à laquelle les images Docker sont comparées au registre (min. 30 min). Redémarrage requis pour prendre effet.</span>
        </div>
        <div className="toggle-row" style={{ marginTop: '0.75rem' }}>
          <label className="toggle-label">
            <span>Mises à jour app automatiques</span>
            <span className="form-help">Installer automatiquement les nouvelles versions de HOMER</span>
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

// ─── System Containers Settings ───────────────────────────────────────────────

function ContainersSettings() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.system.getContainers().then(data => {
      setContainers(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'remove' | 'checkUpdate', containerId: string) => {
    try {
      if (action === 'remove' || action === 'checkUpdate') return;
      await api.containers[action](containerId);
      const updated = await api.system.getContainers();
      setContainers(updated);
    } catch {}
  };

  if (loading) return <div className="settings-section"><div className="spinner" /></div>;

  return (
    <div style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>System Containers</h2>
      </div>
      {containers.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No system containers found.</p>
      ) : (
        <div className="resource-list">
          {containers.map(c => (
            <ContainerRow
              key={c.id}
              container={c}
              showPorts
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
