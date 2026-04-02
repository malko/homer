import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SetupPage, LoginPage, ChangePasswordPage } from './pages/Auth';
import { ProjectsPage } from './pages/Projects';
import { TerminalPage } from './pages/TerminalPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { UpdateBanner } from './components/UpdateBanner';
import { NavSidebar } from './components/NavSidebar';

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-layout-with-nav">
      <NavSidebar />
      <div className="app-layout-content">{children}</div>
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
        path="/terminal"
        element={
          <ProtectedRoute noLayout>
            <TerminalPage />
          </ProtectedRoute>
        }
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
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
