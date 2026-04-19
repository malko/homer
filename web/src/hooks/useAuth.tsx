import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, type AuthStatus } from '../api';

interface AuthContextType {
  status: AuthStatus | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  setupFederation: (peerUrl: string, username: string, password: string, adoptCa?: boolean) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      setError(null);
      const token = localStorage.getItem('token');
      console.log('[Auth] checkStatus - Token from localStorage:', token);
      const newStatus = await api.auth.status();
      console.log('[Auth] checkStatus - Response:', newStatus);
      setStatus(newStatus);
      
      if (!newStatus.authenticated) {
        console.log('[Auth] Not authenticated, removing token');
        localStorage.removeItem('token');
      }
    } catch (err) {
      console.log('[Auth] checkStatus - Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to server');
      setStatus({ needsSetup: true, mustChangePassword: false, authenticated: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const login = async (username: string, password: string) => {
    const response = await api.auth.login(username, password);
    console.log('[Auth] Login response:', response);
    console.log('[Auth] Token:', response.token);
    localStorage.setItem('token', response.token);
    console.log('[Auth] Token saved to localStorage:', localStorage.getItem('token'));
    setStatus({
      needsSetup: false,
      mustChangePassword: response.mustChangePassword,
      authenticated: true,
      username: response.username,
    });
  };

  const setup = async (username: string, password: string) => {
    const response = await api.auth.setup(username, password);
    localStorage.setItem('token', response.token);
    setStatus({
      needsSetup: false,
      mustChangePassword: false,
      authenticated: true,
      username: response.username,
    });
  };

  const setupFederation = async (peerUrl: string, username: string, password: string, adoptCa = false) => {
    const response = await api.auth.setupFederation(peerUrl, username, password, adoptCa);
    localStorage.setItem('token', response.token);
    setStatus({
      needsSetup: false,
      mustChangePassword: false,
      authenticated: true,
      username: response.username,
    });
  };

  const changePassword = async (newPassword: string) => {
    await api.auth.changePassword(newPassword);
    setStatus((prev) => prev ? { ...prev, mustChangePassword: false } : null);
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {}
    localStorage.removeItem('token');
    setStatus({
      needsSetup: false,
      mustChangePassword: false,
      authenticated: false,
    });
  };

  return (
    <AuthContext.Provider value={{ status, loading, error, login, setup, setupFederation, changePassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
