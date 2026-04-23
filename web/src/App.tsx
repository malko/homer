import { useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider, applyInstanceTheme } from './hooks/useTheme';
import { ProjectUpdatesProvider, useProjectUpdates } from './hooks/useProjectUpdates';
import { PeerProvider, usePeer } from './hooks/usePeer';
import { MobileSidebarProvider } from './hooks/useMobileSidebar';
import { SetupPage, LoginPage, ChangePasswordPage } from './pages/Auth';
import { ProjectsPage } from './pages/Projects';
import { TerminalPage } from './pages/TerminalPage';
import { LogsPage } from './pages/LogsPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { MonitorPage } from './pages/MonitorPage';
import { VolumesPage } from './pages/VolumesPage';
import { NetworksPage } from './pages/NetworksPage';
import { ImagesPage } from './pages/ImagesPage';
import { AllContainersPage } from './pages/AllContainersPage';
import { ProxyPage } from './pages/ProxyPage';
import { AccountPage, showBrowserNotification } from './pages/AccountPage';
import { UpdateBanner } from './components/UpdateBanner';
import { useWebSocket } from './hooks/useWebSocket';
import { NavSidebar } from './components/NavSidebar';
import { UpdatesModal } from './components/UpdatesModal';
import { AppHeader } from './components/AppHeader';
import './styles/updates.css';
import './styles/instances.css';

function PeerThemeSync() {
  const { activePeer } = usePeer();
  useEffect(() => {
    const instanceId = activePeer ? activePeer.uuid : 'local';
    applyInstanceTheme(instanceId);
  }, [activePeer?.uuid]);
  return null;
}

function NotificationManager() {
  const handler = useCallback((msg: { type: string; [key: string]: unknown }) => {
    if (document.hasFocus()) return;
    if (msg.type === 'pairing_request') {
      showBrowserNotification('HOMER', 'Nouvelle demande d\'appairage reçue');
    } else if (msg.type === 'update_pull_done') {
      showBrowserNotification('HOMER', 'Mise à jour téléchargée, redémarrage en cours…');
    } else if (msg.type === 'containers_updated') {
      showBrowserNotification('HOMER', 'Containers mis à jour');
    }
  }, []);
  useWebSocket(handler);
  return null;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { activePeer } = usePeer();
  return (
    <div className="app-layout-with-nav">
      <PeerThemeSync />
      <NavSidebar />
      <div key={activePeer?.uuid ?? 'local'} className="app-layout-content">
        {children}
      </div>
    </div>
  );
}

function ProtectedRoute({ children, noLayout }: { children: React.ReactNode; noLayout?: boolean }) {
  const { status, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    );
  }

  if (!status?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  if (status.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  if (noLayout) return <>{children}</>;
  return <AppLayout>{children}</AppLayout>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { status, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    );
  }

  if (!status?.authenticated) {
    return <>{children}</>;
  }

  if (status.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <Navigate to="/" replace />;
}

function InitialRoute() {
  const { status, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    );
  }

  if (status?.authenticated) {
    return <Navigate to="/home" replace />;
  }

  if (status?.needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { status } = useAuth();

  return (
    <>
      {status?.authenticated && !status?.mustChangePassword && <UpdateBanner />}
      {status?.authenticated && !status?.mustChangePassword && <NotificationManager />}
      <UpdatesModal />
      <Routes>
      <Route path="/" element={<InitialRoute />} />
      <Route
        path="/login"
        element={
          <AuthRoute>
            <LoginPage />
          </AuthRoute>
        }
      />
      <Route
        path="/setup"
        element={
          status?.needsSetup ? (
            <SetupPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/change-password"
        element={
          status?.mustChangePassword ? (
            <ChangePasswordPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
<Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/containers"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/federation"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/monitor"
        element={
          <ProtectedRoute>
            <MonitorPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/volumes"
        element={
          <ProtectedRoute>
            <VolumesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/networks"
        element={
          <ProtectedRoute>
            <NetworksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/images"
        element={
          <ProtectedRoute>
            <ImagesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/containers"
        element={
          <ProtectedRoute>
            <AllContainersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/proxy"
        element={
          <ProtectedRoute>
            <ProxyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/terminal"
        element={
          <ProtectedRoute noLayout>
            <TerminalPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/logs"
        element={
          <ProtectedRoute noLayout>
            <LogsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/instances"
        element={<Navigate to="/settings/federation" replace />}
      />
      <Route
        path="/settings/system-containers"
        element={<Navigate to="/settings/containers" replace />}
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <ProjectsPage />
          </ProtectedRoute>
        }
      />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <PeerProvider>
            <ProjectUpdatesProvider>
              <MobileSidebarProvider>
                <AppRoutes />
              </MobileSidebarProvider>
            </ProjectUpdatesProvider>
          </PeerProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
