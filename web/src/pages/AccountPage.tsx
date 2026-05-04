import { useState, useEffect } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, ApiError, LocalInstanceInfo, PeerInstance } from '../api';
import { useTheme, THEME_DEFINITIONS, ThemeId, getThemeForInstance, setThemeForInstance } from '../hooks/useTheme';
import '../styles/settings.css';
import '../styles/account.css';

// ─── Account Page ─────────────────────────────────────────────────────────────

export function AccountPage() {
  return (
    <div className="settings-page">
      <AppHeader title="Mon compte" />
      <div className="settings-content">
        <div className="settings-section">
          <h2>Mon compte</h2>
          <PasswordSection />
          <ThemeSection />
          <NotificationsSection />
        </div>
      </div>
    </div>
  );
}

// ─── Password ─────────────────────────────────────────────────────────────────

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setSaving(true);
    try {
      await api.auth.changePassword(newPassword, currentPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-card">
      <h3>Mot de passe administrateur</h3>
      <form className="password-form" onSubmit={handleSubmit}>
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
        {error && <div className="proxy-form-error">{error}</div>}
        {success && <div style={{ color: 'var(--color-success)', fontSize: '0.8125rem' }}>Mot de passe modifié avec succès</div>}
        <div className="password-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Modification...' : 'Changer le mot de passe'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME_FAMILIES = Array.from(new Set(THEME_DEFINITIONS.map(t => t.family)));

function ThemeSelect({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <select
      className="input"
      value={value}
      onChange={e => onChange(e.target.value as ThemeId)}
    >
      {THEME_FAMILIES.map(family => (
        <optgroup key={family} label={family.charAt(0).toUpperCase() + family.slice(1).replace('-', ' ')}>
          {THEME_DEFINITIONS.filter(t => t.family === family).map(theme => (
            <option key={theme.id} value={theme.id}>{theme.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ThemeSection() {
  const { setThemeId } = useTheme();
  const [applyAll, setApplyAll] = useState(false);
  const [localInstance, setLocalInstance] = useState<LocalInstanceInfo | null>(null);
  const [peers, setPeers] = useState<PeerInstance[]>([]);
  const [localTheme, setLocalTheme] = useState<ThemeId>('homer-dark');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.instances.self().then(setLocalInstance).catch(() => {});
    api.instances.list().then(r => setPeers(r.peers)).catch(() => {});
    getThemeForInstance('local').then(theme => {
      setLocalTheme(theme);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleApplyAll = (checked: boolean) => {
    setApplyAll(checked);
    if (checked) {
      getThemeForInstance('local').then(theme => {
        peers.forEach(p => setThemeForInstance(p.uuid, theme));
      });
    }
  };

  const handleLocalThemeChange = (id: ThemeId) => {
    setLocalTheme(id);
    setThemeForInstance('local', id);
    setThemeId(id);
    if (applyAll) {
      peers.forEach(p => setThemeForInstance(p.uuid, id));
    }
  };

  return (
    <div className="settings-card">
      <h3>Thème</h3>
      <p className="form-help" style={{ marginBottom: '1rem' }}>
        Choisissez un thème pour chaque instance. Le thème s'applique automatiquement lors du changement d'instance ().
      </p>

      <div className="account-theme-section">
        <div className="account-theme-section-header">
          <strong>{localInstance?.friendlyName ?? localInstance?.name ?? 'Instance locale'}</strong>
          {localInstance?.name && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
              {localInstance.name}
            </span>
          )}
        </div>
        <ThemeSelect value={localTheme} onChange={handleLocalThemeChange} />
      </div>

      {peers.length > 0 && (
        <>
          <label className="account-apply-all">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={e => handleApplyAll(e.target.checked)}
            />
            <span>Appliquer le même thème à toutes les instances</span>
          </label>

          {!applyAll && peers.map(peer => (
            <PeerThemeSection key={peer.uuid} peer={peer} />
          ))}
        </>
      )}
    </div>
  );
}

function PeerThemeSection({ peer }: { peer: PeerInstance }) {
  const [selected, setSelected] = useState<ThemeId>('homer-dark');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getThemeForInstance(peer.uuid).then(theme => {
      setSelected(theme);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [peer.uuid]);

  const handleChange = (id: ThemeId) => {
    setSelected(id);
    setThemeForInstance(peer.uuid, id);
  };

  let displayName = peer.name;
  if (peer.url) {
    try {
      const url = new URL(peer.url);
      displayName = url.hostname;
    } catch {}
  }

  return (
    <div className="account-theme-section">
      <div className="account-theme-section-header">
        <strong>{displayName}</strong>
        {displayName !== peer.name && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
            {peer.name}
          </span>
        )}
      </div>
      <ThemeSelect value={selected} onChange={handleChange} />
    </div>
  );
}

// ─── Notifications Web ───────────────────────────────────────────────────────

const NOTIF_PREF_KEY = 'homer-notifications-enabled';

export function areNotificationsEnabled(): boolean {
  return localStorage.getItem(NOTIF_PREF_KEY) === 'true' && Notification.permission === 'granted';
}

export function showBrowserNotification(title: string, body: string, url?: string) {
  if (!areNotificationsEnabled()) return;
  const n = new Notification(title, { body, icon: '/assets/bigicon.png' });
  if (url) n.onclick = () => { window.focus(); n.close(); };
}

function NotificationsSection() {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [enabled, setEnabled] = useState(() => areNotificationsEnabled());
  const [loading, setLoading] = useState(false);

  const supported = 'Notification' in window;

  const handleEnable = async () => {
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm === 'granted') {
        localStorage.setItem(NOTIF_PREF_KEY, 'true');
        setEnabled(true);
        new Notification('HOMER', { body: 'Notifications activées.', icon: '/assets/bigicon.png' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = () => {
    localStorage.setItem(NOTIF_PREF_KEY, 'false');
    setEnabled(false);
  };

  if (!supported) {
    return (
      <div className="settings-card">
        <h3>Notifications web</h3>
        <p className="form-help">Votre navigateur ne supporte pas l'API Notification.</p>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <h3>Notifications web</h3>
      <p className="form-help" style={{ marginBottom: '1rem' }}>
        Recevez des notifications de navigateur pour les événements HOMER (mises à jour disponibles, redémarrages, etc.) même quand l'onglet est en arrière-plan.
      </p>

      {permission === 'denied' && (
        <div className="message message--error" style={{ marginBottom: '0.75rem' }}>
          Les notifications sont bloquées dans les paramètres de votre navigateur pour ce site. Modifiez les permissions pour les autoriser.
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <div className={`account-notif-indicator${enabled ? ' account-notif-indicator--active' : ''}`} />
        <span style={{ fontSize: '0.875rem' }}>
          {enabled ? 'Notifications activées' : 'Notifications désactivées'}
        </span>
        {enabled ? (
          <button className="btn btn-danger btn-sm" onClick={handleDisable}>
            Désactiver
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleEnable}
            disabled={loading || permission === 'denied'}
          >
            {loading ? '...' : 'Activer les notifications'}
          </button>
        )}
      </div>
    </div>
  );
}
