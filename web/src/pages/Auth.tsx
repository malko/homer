import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import bannerImage from '@assets/HOMER-banner.png';

export function SetupPage() {
  const { setup, setupFederation, error: globalError } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'local' | 'federation'>('local');

  // Local account state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Federation join state
  const [fedPeerUrl, setFedPeerUrl] = useState('');
  const [fedUsername, setFedUsername] = useState('');
  const [fedPassword, setFedPassword] = useState('');
  const [fedAdoptCa, setFedAdoptCa] = useState(true);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLocalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      await setup(username, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFederationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await setupFederation(fedPeerUrl.trim(), fedUsername.trim(), fedPassword, fedAdoptCa);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join federation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <img src={bannerImage} alt="" className="auth-banner" />
        <h1 className="auth-title">Welcome</h1>

        {globalError && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.375rem', fontSize: '0.875rem', color: 'var(--color-danger)' }}>
            {globalError}
          </div>
        )}

        {mode === 'local' ? (
          <>
            <p className="auth-subtitle">Create your admin account to get started</p>
            <form onSubmit={handleLocalSubmit}>
              <div className="input-group">
                <label className="input-label">Username</label>
                <input type="text" className={`input ${error ? 'input-error' : ''}`} value={username}
                  onChange={(e) => setUsername(e.target.value)} placeholder="admin" minLength={3} required />
              </div>
              <div className="input-group">
                <label className="input-label">Password</label>
                <input type="password" className={`input ${error ? 'input-error' : ''}`} value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={8} required />
              </div>
              <div className="input-group">
                <label className="input-label">Confirm Password</label>
                <input type="password" className={`input ${error ? 'input-error' : ''}`} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" minLength={8} required />
              </div>
              {error && <p className="error-text">{error}</p>}
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                  {loading ? 'Creating Account...' : 'Create Account'}
                </button>
              </div>
            </form>
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => { setMode('federation'); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Join an existing federation instead
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="auth-subtitle">Sign in with an account from an existing HOMER instance</p>
            <form onSubmit={handleFederationSubmit}>
              <div className="input-group">
                <label className="input-label">Remote instance URL</label>
                <input type="url" className={`input ${error ? 'input-error' : ''}`} value={fedPeerUrl}
                  onChange={(e) => setFedPeerUrl(e.target.value)} placeholder="https://homer-a.local" required />
              </div>
              <div className="input-group">
                <label className="input-label">Username</label>
                <input type="text" className={`input ${error ? 'input-error' : ''}`} value={fedUsername}
                  onChange={(e) => setFedUsername(e.target.value)} placeholder="admin" required />
              </div>
              <div className="input-group">
                <label className="input-label">Password</label>
                <input type="password" className={`input ${error ? 'input-error' : ''}`} value={fedPassword}
                  onChange={(e) => setFedPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={fedAdoptCa} onChange={e => setFedAdoptCa(e.target.checked)} />
                Use remote instance's certificate authority (shared CA for the whole homelab)
              </label>
              {error && <p className="error-text">{error}</p>}
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                  {loading ? 'Joining...' : 'Join Federation'}
                </button>
              </div>
            </form>
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => { setMode('local'); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Create a local account instead
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <img src={bannerImage} alt="" className="auth-banner" />
        <h1 className="auth-title">Sign In</h1>
        <p className="auth-subtitle">Enter your credentials to continue</p>
        
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Username</label>
            <input
              type="text"
              className={`input ${error ? 'input-error' : ''}`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
            />
          </div>

          <div className="input-group">
            <label className="input-label">Password</label>
            <input
              type="password"
              className={`input ${error ? 'input-error' : ''}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ChangePasswordPage() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await changePassword(newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <img src={bannerImage} alt="" className="auth-banner" />
        <h1 className="auth-title">Change Password</h1>
        <p className="auth-subtitle">You must change your password before continuing</p>
        
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">New Password</label>
            <input
              type="password"
              className={`input ${error ? 'input-error' : ''}`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </div>

          <div className="input-group">
            <label className="input-label">Confirm New Password</label>
            <input
              type="password"
              className={`input ${error ? 'input-error' : ''}`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? 'Changing Password...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
